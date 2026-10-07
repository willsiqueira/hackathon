// Painel, exportação, detalhe, fila e calendário de prazos.

import { interpretarOrdenacao, validarCriterios } from '../../dominio/criterios.js';
import { garantirMesmoSetor, paraExportacao, paraUsuario, podeVerConteudo } from '../../dominio/acesso.js';
import { comporPrioridade, compararFila, isoLocal } from '../../dominio/regras.js';
import { ErroNaoEncontrado, ErroValidacao } from '../../dominio/erros.js';
import { ativosVisiveis, montarPainel, validarCaixa, validarGerenciador } from '../../servicos/painel.js';
import { arquivo, identificador, inteiro, jsonDaQuery } from '../http.js';
import { gerarCsv, gerarIcs, type ColunaCsv } from '../formatos.js';
import type { Contexto } from '../contexto.js';
import type { Entidade } from '../../dominio/tipos.js';

const TAMANHOS_PAGINA = [10, 25, 50, 100];

const COLUNAS_EXPORTACAO: ColunaCsv[] = [
  ['etiqueta', 'Etiqueta'], ['gerenciador', 'Gerenciador'], ['caixa', 'Caixa'], ['numeroReferencia', 'Número'],
  ['classe', 'Classe'], ['assunto', 'Assunto'], ['situacao', 'Situação'], ['acaoPendente', 'Ação pendente'],
  ['dataChegada', 'Chegada'], ['dataPrazo', 'Prazo'], ['diasRestantes', 'Dias restantes'], ['statusPrazo', 'Situação do prazo'],
  ['prioridade', 'Prioridade'], ['pontuacaoPrioridade', 'Pontuação'], ['nomeResponsavel', 'Responsável'],
  ['tempoParadoDias', 'Dias parado'], ['risco', 'Risco'],
].map(([campo, titulo]) => ({ campo, titulo }));

const COLUNAS_HISTORICO: ColunaCsv[] = [
  ['dataHora', 'Data e hora'], ['tipoMovimentacao', 'Tipo'], ['nomeUsuario', 'Quem'], ['setorOrigem', 'De'],
  ['setorDestino', 'Para'], ['descricao', 'Descrição'],
].map(([campo, titulo]) => ({ campo, titulo }));

function lerFiltros(ctx: Contexto) {
  const { query, setor } = ctx;
  const brutos = jsonDaQuery(query.criterios, 'criterios');
  if (brutos !== undefined && (typeof brutos !== 'object' || brutos === null || Array.isArray(brutos))) {
    throw new ErroValidacao('criterios deve ser um objeto JSON.');
  }
  const criterios = validarCriterios({ ...(brutos as object | undefined), ...(query.q ? { q: query.q } : {}) });
  return {
    gerenciador: validarGerenciador(query.gerenciador, setor),
    caixa: validarCaixa(query.caixa),
    criterios,
    ordenacao: interpretarOrdenacao(query.ordenacao),
  };
}

export async function listar(ctx: Contexto) {
  const filtros = lerFiltros(ctx);
  const tamanho = inteiro(ctx.query.tamanho, { padrao: 25, min: 10, max: 100, nome: 'tamanho' });
  if (!TAMANHOS_PAGINA.includes(tamanho)) throw new ErroValidacao(`tamanho deve ser um de ${TAMANHOS_PAGINA.join(', ')}.`);
  const pagina = inteiro(ctx.query.pagina, { padrao: 1, min: 1, max: 100000, nome: 'pagina' });
  const ativos = await ativosVisiveis(ctx.repo, ctx.usuario, ctx.agora, filtros.gerenciador);
  const { todos: _todos, ...painel } = montarPainel(ativos, ctx.usuario, { ...filtros, pagina, tamanho });
  return painel;
}

export async function exportar(ctx: Contexto) {
  const filtros = lerFiltros(ctx);
  const ativos = await ativosVisiveis(ctx.repo, ctx.usuario, ctx.agora, filtros.gerenciador);
  const { todos } = montarPainel(ativos, ctx.usuario, { ...filtros, pagina: 1, tamanho: 1 });
  return arquivo({
    tipo: 'text/csv',
    nome: `expedientes-${ctx.usuario.siglaSetor}-${isoLocal(ctx.agora).slice(0, 10)}.csv`,
    conteudo: gerarCsv(todos.map(paraExportacao), COLUNAS_EXPORTACAO),
  });
}

async function detalheAutorizado(ctx: Contexto) {
  const id = identificador(ctx.params.id, 'Expediente');
  const detalhe = await ctx.repo.obterDetalhe(id, ctx.agora);
  if (!detalhe) throw new ErroNaoEncontrado('Expediente não encontrado.');
  garantirMesmoSetor(ctx.usuario, detalhe.expediente);
  return detalhe;
}

const porCampo = (campo: string) => (a: Entidade, b: Entidade) => String(a[campo]).localeCompare(String(b[campo]));

export async function detalhar(ctx: Contexto) {
  const detalhe = await detalheAutorizado(ctx);
  const visivel = podeVerConteudo(ctx.usuario, detalhe.expediente);
  const movimentacoes = detalhe.movimentacoes.sort(porCampo('dataHora'))
    .map((m) => (visivel ? m : { ...m, descricao: 'Descrição restrita (sigiloso)' }));
  return {
    expediente: paraUsuario(ctx.usuario, detalhe.expediente),
    composicaoPrioridade: comporPrioridade(detalhe.expediente),
    movimentacoes,
    prazos: detalhe.prazos.sort(porCampo('dataInicio')),
    designacoes: detalhe.designacoes.sort(porCampo('dataDesignacao')),
    anotacoes: visivel ? detalhe.anotacoes.sort(porCampo('dataHora')) : [],
    marcadores: detalhe.marcadores,
  };
}

/** Histórico (RF13) em CSV. Em sigiloso, as descrições saem mascaradas para qualquer perfil. */
export async function exportarHistorico(ctx: Contexto) {
  const detalhe = await detalheAutorizado(ctx);
  const sigiloso = paraExportacao(detalhe.expediente).conteudoRestrito;
  const tipo = ctx.query.tipo;
  const linhas = detalhe.movimentacoes
    .filter((m) => !tipo || m.tipoMovimentacao === tipo)
    .sort(porCampo('dataHora'))
    .map((m) => (sigiloso ? { ...m, descricao: 'Descrição restrita (sigiloso)' } : m));
  return arquivo({
    tipo: 'text/csv',
    nome: `historico-${detalhe.expediente.etiqueta}.csv`,
    conteudo: gerarCsv(linhas, COLUNAS_HISTORICO),
  });
}

/** Fila na ordem do GSI2 (prazo e prioridade), só o que exige ação. */
export async function fila(ctx: Contexto) {
  const gerenciador = validarGerenciador(ctx.query.gerenciador, ctx.setor);
  const meus = ctx.query.meus === 'true';
  let itens = (await ctx.repo.listarFila(ctx.usuario.siglaSetor, ctx.agora)).map((e) => paraUsuario(ctx.usuario, e));
  if (gerenciador) itens = itens.filter((e) => e.gerenciador === gerenciador);
  if (meus) itens = itens.filter((e) => e.idResponsavel === ctx.usuario.idUsuario);
  itens.sort(compararFila);
  return { total: itens.length, itens: itens.slice(0, 500) };
}

export async function calendarioIcs(ctx: Contexto) {
  const gerenciador = validarGerenciador(ctx.query.gerenciador, ctx.setor);
  const antecedenciaDias = inteiro(ctx.query.antecedencia, { padrao: 1, min: 0, max: 30, nome: 'antecedencia' });
  const ativos = await ctx.repo.listarAtivos(ctx.usuario.siglaSetor, ctx.agora, gerenciador);
  const comAcao = ativos.filter((e) => e.requerAcao && (e.diasRestantes ?? -1) >= 0).map(paraExportacao);
  return arquivo({
    tipo: 'text/calendar',
    nome: `prazos-${ctx.usuario.siglaSetor}.ics`,
    conteudo: gerarIcs(comAcao, { antecedenciaDias, carimbo: ctx.agora.toISOString() }),
  });
}
