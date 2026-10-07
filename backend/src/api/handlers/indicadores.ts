// Indicadores (F10, RF17): estoque, vencidos, cumprimento de prazos, fluxo e produtividade.

import { dataLocal, somarDias } from '../../dominio/regras.js';
import { ativosVisiveis, contadores, validarGerenciador } from '../../servicos/painel.js';
import { ErroValidacao } from '../../dominio/erros.js';
import type { Contexto } from '../contexto.js';
import type { Entidade, Expediente } from '../../dominio/tipos.js';

const PERIODOS = [7, 30, 60, 90];
const CAMPOS_ESTOQUE = ['entradas', 'recebimentos', 'saidas', 'aReceber', 'noSetor', 'vencidos'];
const CAMPOS_PRODUTIVIDADE = [
  'recebimentos', 'designacoes', 'marcadores', 'anotacoes', 'minutas', 'assinaturas', 'prorrogacoes', 'envios', 'arquivamentos', 'totalAcoes',
];

function somarPor(lista: Entidade[], chave: string, campos: string[]): Map<string, Record<string, number>> {
  const mapa = new Map<string, Record<string, number>>();
  for (const item of lista) {
    const k = String(item[chave]);
    if (!mapa.has(k)) mapa.set(k, Object.fromEntries(campos.map((c) => [c, 0])));
    const alvo = mapa.get(k) as Record<string, number>;
    for (const c of campos) alvo[c] += Number(item[c] ?? 0);
  }
  return mapa;
}

function contarPor(lista: Expediente[], campo: string) {
  const mapa: Record<string, number> = {};
  for (const e of lista) mapa[String(e[campo])] = (mapa[String(e[campo])] ?? 0) + 1;
  return Object.entries(mapa).map(([chave, quantidade]) => ({ chave, quantidade })).sort((a, b) => b.quantidade - a.quantidade);
}

export async function indicadores(ctx: Contexto) {
  const { repo, usuario, agora, setor } = ctx;
  const gerenciador = validarGerenciador(ctx.query.gerenciador, setor);
  const dias = Number(ctx.query.dias ?? 30);
  if (!PERIODOS.includes(dias)) throw new ErroValidacao(`dias deve ser um de ${PERIODOS.join(', ')}.`);
  const hoje = dataLocal(agora);
  const desde = somarDias(hoje, -(dias - 1));
  const doGerenciador = (r: Entidade) => !gerenciador || r.gerenciador === gerenciador;

  const [ativos, estoque, produtividade] = await Promise.all([
    ativosVisiveis(repo, usuario, agora, gerenciador),
    repo.listarEstoque(usuario.siglaSetor),
    repo.listarProdutividade(usuario.siglaSetor, desde),
  ]);

  const porDia = somarPor(estoque.filter((r) => r.data >= desde && doGerenciador(r)), 'data', CAMPOS_ESTOQUE);
  type Linha = { data: string } & Record<string, number>;
  const serie = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([data, v]) => Object.assign({ data }, v) as Linha);

  const prod = produtividade.filter(doGerenciador);
  const noPrazo = prod.reduce((s, r) => s + Number(r.prazosCumpridosNoPrazo ?? 0), 0);
  const comAtraso = prod.reduce((s, r) => s + Number(r.prazosCumpridosComAtraso ?? 0), 0);
  const comAcao = ativos.filter((e) => e.requerAcao);
  const c = contadores(ativos, usuario);

  // Produtividade individual só para quem gere a equipe.
  let porPessoa: Entidade[] | null = null;
  if (usuario.perfil === 'MEMBRO' || usuario.perfil === 'CHEFE') {
    const nomes = new Map(prod.map((r) => [r.idUsuario, r.nomeUsuario]));
    porPessoa = [...somarPor(prod, 'idUsuario', CAMPOS_PRODUTIVIDADE).entries()]
      .map(([idUsuario, v]) => Object.assign({ idUsuario, nome: nomes.get(idUsuario) }, v) as Entidade)
      .sort((a, b) => b.totalAcoes - a.totalAcoes);
  }

  return {
    periodo: { dias, desde, ate: hoje, gerenciador: gerenciador ?? 'TODOS' },
    kpis: {
      estoque: c.aReceber + c.noSetor,
      aReceber: c.aReceber,
      noSetor: c.noSetor,
      vencidos: c.vencidos,
      venceHoje: c.venceHoje,
      urgentes: c.urgentes,
      parados30dias: c.parados30dias,
      entradas: serie.reduce((s, d) => s + d.entradas, 0),
      saidas: serie.reduce((s, d) => s + d.saidas, 0),
      prazosCumpridosNoPrazo: noPrazo,
      prazosCumpridosComAtraso: comAtraso,
      percentualCumprimento: noPrazo + comAtraso ? Math.round((1000 * noPrazo) / (noPrazo + comAtraso)) / 10 : null,
    },
    serie,
    prazosPorSituacao: contarPor(comAcao, 'statusPrazo'),
    pendenciasPorAssunto: contarPor(comAcao.filter((e) => !e.conteudoRestrito), 'assunto').slice(0, 10),
    produtividade: porPessoa,
  };
}
