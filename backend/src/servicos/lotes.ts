// Orquestra prévia, execução e desfazer de lotes (RF11, RF12) e publica os eventos de domínio.

import { randomBytes } from 'node:crypto';
import {
  aplicarAcao, descreverMudanca, motivoIgnorar, validarLote, type ContextoItem, type PedidoLote, type TipoAcao,
} from '../dominio/lote.js';
import { calcularCargas, distribuir, JANELA_PRODUTIVIDADE_DIAS, type Carga } from '../dominio/designacao.js';
import { dataLocal, isoLocal, somarDias } from '../dominio/regras.js';
import { paraUsuario } from '../dominio/acesso.js';
import { ErroConflito, ErroNaoEncontrado, ErroProibido } from '../dominio/erros.js';
import { paraItem } from '../dados/chaves.js';
import type { Repositorio } from '../dados/repositorio.js';
import type { Operacao } from '../dados/tabela.js';
import type { Entidade, Expediente, Usuario } from '../dominio/tipos.js';
import type { EventoDominio, PublicadorEventos } from '../eventos/eventos.js';

export function gerarId(prefixo: string): string {
  return `${prefixo}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

/** Carga atual das pessoas do setor (usada na sugestão e na distribuição). */
export async function cargasDoSetor(repo: Repositorio, usuario: Usuario, agora: Date): Promise<Carga[]> {
  const hoje = dataLocal(agora);
  const pessoas = await repo.listarUsuariosDoSetor(usuario.siglaSetor);
  const designacoes = (await Promise.all(pessoas.map((p) => repo.designacoesAtivasDoUsuario(p.idUsuario)))).flat();
  const produtividade = await repo.listarProdutividade(usuario.siglaSetor, somarDias(hoje, -JANELA_PRODUTIVIDADE_DIAS));
  return calcularCargas(pessoas, designacoes, produtividade, hoje);
}

interface ItemResumo {
  idExpediente: string;
  etiqueta?: string;
  gerenciador?: string;
  caixa?: string;
  situacao?: string;
}

interface ItemAplicavel extends ItemResumo {
  mudanca: string;
  expediente: Expediente;
  contexto: ContextoItem;
}

/** Resolve os dados de que cada item precisa e devolve a análise item a item. */
async function analisar(repo: Repositorio, usuario: Usuario, pedido: PedidoLote, agora: Date) {
  const parametros = validarLote(pedido, usuario, agora);
  const ids = [...new Set(pedido.ids)];
  const expedientes = await Promise.all(ids.map((id) => repo.obterExpediente(id, agora)));

  let marcador: Entidade | undefined;
  if (pedido.tipoAcao === 'INCLUIR_MARCADOR') {
    marcador = (await repo.listarMarcadores(usuario.siglaSetor)).find((m) => m.idRotulo === parametros.idRotulo);
  }
  const pessoas = new Map<string, Usuario>();
  let destinos: Record<string, string> = {};
  if (pedido.tipoAcao === 'DESIGNAR') {
    for (const p of await repo.listarUsuariosDoSetor(usuario.siglaSetor)) pessoas.set(p.idUsuario, p);
    if (parametros.distribuir) {
      const candidatos = expedientes
        .filter((e): e is Expediente => !!e && e.caixa === 'NO_SETOR' && e.siglaSetor === usuario.siglaSetor);
      const atuais = Object.fromEntries(candidatos
        .filter((e) => e.tipoResponsabilidade === 'DESIGNADO')
        .map((e) => [e.idExpediente, e.idResponsavel]));
      destinos = distribuir(candidatos.map((e) => e.idExpediente), await cargasDoSetor(repo, usuario, agora), atuais);
    }
  }

  const aplicaveis: ItemAplicavel[] = [];
  const ignorados: (ItemResumo & { motivo: string })[] = [];
  ids.forEach((id, i) => {
    const expediente = expedientes[i];
    const idDestino = parametros.distribuir ? destinos[id] : parametros.idUsuarioDesignado;
    const contexto: ContextoItem = { usuario, parametros, marcador, destinatario: idDestino ? pessoas.get(idDestino) : undefined };
    const motivo = motivoIgnorar(pedido.tipoAcao, expediente, contexto);
    // Expediente de outro setor ou inexistente: não revela dados, só o identificador recebido.
    let resumo: ItemResumo = { idExpediente: id };
    if (expediente && expediente.siglaSetor === usuario.siglaSetor) {
      const visivel = paraUsuario(usuario, expediente);
      resumo = { idExpediente: id, etiqueta: visivel.etiqueta, gerenciador: visivel.gerenciador, caixa: visivel.caixa, situacao: visivel.situacao };
    }
    if (motivo || !expediente) ignorados.push({ ...resumo, motivo: motivo ?? 'Expediente não encontrado.' });
    else aplicaveis.push({ ...resumo, mudanca: descreverMudanca(pedido.tipoAcao, expediente, contexto), expediente, contexto });
  });
  return { parametros, aplicaveis, ignorados };
}

const publico = ({ expediente: _e, contexto: _c, ...resto }: ItemAplicavel) => resto;

export async function previa(repo: Repositorio, usuario: Usuario, pedido: PedidoLote, agora: Date) {
  const { aplicaveis, ignorados } = await analisar(repo, usuario, pedido, agora);
  return { tipoAcao: pedido.tipoAcao, aplicaveis: aplicaveis.map(publico), ignorados };
}

function parametrosTexto(parametros: object): string {
  return Object.entries(parametros).map(([k, v]) => `${k}=${String(v)}`).join(';');
}

/** Executa o lote: grava cada expediente (transação) e as imagens anteriores para desfazer; publica eventos. */
export async function executar(repo: Repositorio, usuario: Usuario, pedido: PedidoLote, agora: Date, publicador: PublicadorEventos) {
  const { parametros, aplicaveis, ignorados } = await analisar(repo, usuario, pedido, agora);
  const tipoAcao: TipoAcao = pedido.tipoAcao;
  const idLote = gerarId('LOT');
  const imagens: Entidade[] = [];
  const eventos: EventoDominio[] = [];
  for (const item of aplicaveis) {
    const designacoesAtivas = tipoAcao === 'DESIGNAR' || tipoAcao === 'ARQUIVAR'
      ? await repo.designacoesAtivasDoExpediente(item.idExpediente)
      : [];
    const { expediente, gravar } = aplicarAcao(tipoAcao, item.expediente, { ...item.contexto, designacoesAtivas, agora, gerarId });
    const itens = [repo.itemExpediente(expediente, agora), ...gravar.map(paraItem)];
    for (const novo of itens) {
      const antes = await repo.obterItemCru(novo.PK, novo.SK);
      imagens.push({
        entidade: 'desfazer_lote', idLote, sequencia: imagens.length + 1, idExpediente: item.idExpediente,
        PKAlvo: novo.PK, SKAlvo: novo.SK, antes: antes ?? null,
        versaoApos: novo.SK === 'META' ? expediente.versao : null,
      });
    }
    await repo.gravarItens(itens.map((put): Operacao => ({ put })));
    for (const d of gravar.filter((g) => g.entidade === 'designacoes' && g.situacao === 'ATIVA')) {
      eventos.push({
        tipo: 'ExpedienteDesignado', idDesignacao: d.idDesignacao, idExpediente: d.idExpediente, etiqueta: d.etiqueta,
        gerenciador: d.gerenciador, siglaSetor: d.siglaSetor, idUsuarioDesignado: d.idUsuarioDesignado,
        idUsuarioDesignador: d.idUsuarioDesignador, nomeDesignador: d.nomeDesignador, prazoDevolucao: d.prazoDevolucao,
        dataHora: d.dataDesignacao,
      });
    }
  }
  const registro: Entidade = {
    entidade: 'acoes_lote',
    idLote,
    siglaSetor: usuario.siglaSetor,
    idUsuario: usuario.idUsuario,
    nomeUsuario: usuario.nome,
    tipoAcao,
    parametros: parametrosTexto(parametros),
    dataHora: isoLocal(agora),
    qtdExpedientes: aplicaveis.length + ignorados.length,
    qtdSucesso: aplicaveis.length,
    qtdFalhas: ignorados.length,
    resultado: ignorados.length ? 'PARCIAL' : 'SUCESSO',
    gerenciadores: [...new Set(aplicaveis.map((a) => a.gerenciador))].join(';'),
    idsExpedientes: aplicaveis.map((a) => a.idExpediente).join(';'),
    desfeito: false,
  };
  await repo.gravarItens([...imagens, registro].map((e): Operacao => ({ put: paraItem(e) })));
  eventos.push({
    tipo: 'LoteExecutado', idLote, siglaSetor: usuario.siglaSetor, idUsuario: usuario.idUsuario, tipoAcao,
    qtdSucesso: aplicaveis.length, qtdFalhas: ignorados.length, dataHora: registro.dataHora,
  });
  await publicador.publicar(eventos);
  return { idLote, tipoAcao, aplicados: aplicaveis.map(publico), ignorados, resultado: registro.resultado as string };
}

/** Desfaz um lote do próprio usuário. Restaura só os expedientes que não mudaram depois do lote. */
export async function desfazer(repo: Repositorio, usuario: Usuario, idLote: string, agora: Date) {
  const lote = (await repo.listarLotesDoUsuario(usuario.idUsuario)).find((l) => l.idLote === idLote);
  if (!lote) {
    const doSetor = await repo.listarLotesDoSetor(usuario.siglaSetor, 500);
    if (doSetor.some((l) => l.idLote === idLote)) throw new ErroProibido('Só quem executou o lote pode desfazê-lo.');
    throw new ErroNaoEncontrado('Lote não encontrado.');
  }
  if (lote.desfeito) throw new ErroConflito('Este lote já foi desfeito.');
  const imagens = await repo.listarDesfazer(idLote);
  if (!imagens.length) throw new ErroConflito('Este lote não tem dados para desfazer (lote da base de exemplo).');

  const porExpediente = new Map<string, Entidade[]>();
  for (const img of imagens) {
    if (!porExpediente.has(img.idExpediente)) porExpediente.set(img.idExpediente, []);
    porExpediente.get(img.idExpediente)?.push(img);
  }
  const restaurados: { idExpediente: string; etiqueta?: string }[] = [];
  const naoRestaurados: { idExpediente: string; etiqueta?: string; motivo: string }[] = [];
  for (const [idExpediente, lista] of porExpediente) {
    const meta = lista.find((i) => i.SKAlvo === 'META') as Entidade;
    const atual = await repo.obterItemCru(meta.PKAlvo, meta.SKAlvo);
    if (!atual || Number(atual.versao ?? 0) !== meta.versaoApos) {
      naoRestaurados.push({ idExpediente, etiqueta: atual?.etiqueta, motivo: 'Foi alterado depois do lote.' });
      continue;
    }
    await repo.gravarItens(lista.map((i): Operacao => (i.antes ? { put: i.antes } : { delete: { PK: i.PKAlvo, SK: i.SKAlvo } })));
    restaurados.push({ idExpediente, etiqueta: atual.etiqueta });
  }
  await repo.salvar([{ ...lote, entidade: 'acoes_lote', desfeito: true, dataDesfeito: isoLocal(agora), qtdRestaurados: restaurados.length }]);
  return { idLote, restaurados, naoRestaurados };
}
