// Ações em lote (RF11, RF12, RN4, RN5): validação por item (prévia) e efeito de cada ação.
// Funções puras: o serviço fornece os dados relacionados e grava o resultado.

import { z } from 'zod';
import { ErroValidacao } from './erros.js';
import { exigirPerfil } from './acesso.js';
import { dataLocal, isoLocal, somarDias, diferencaDias } from './regras.js';
import type { Caixa, Entidade, Expediente, Usuario } from './tipos.js';

export const TIPOS_ACAO = ['RECEBER', 'DESIGNAR', 'INCLUIR_MARCADOR', 'DAR_CIENCIA', 'ASSINAR', 'MOVIMENTAR', 'ARQUIVAR'] as const;
export type TipoAcao = (typeof TIPOS_ACAO)[number];
export const MAX_ITENS_LOTE = 200;
export const PRAZO_DEVOLUCAO_PADRAO_DIAS = 5;

const ID = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Identificador inválido.');
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD.');

/** Esquema do corpo de /lotes e /lotes/previa. */
export const esquemaPedidoLote = z.object({
  tipoAcao: z.enum(TIPOS_ACAO, { error: 'Ação desconhecida.' }),
  ids: z.array(ID, { error: 'Selecione ao menos um expediente.' })
    .min(1, 'Selecione ao menos um expediente.')
    .max(MAX_ITENS_LOTE, `O lote aceita no máximo ${MAX_ITENS_LOTE} expedientes.`),
  parametros: z.object({
    idUsuarioDesignado: ID.optional(),
    distribuir: z.boolean().optional(),
    prazoDevolucao: DATA.optional(),
    idRotulo: ID.optional(),
    setorDestino: z.string().trim().regex(/^[\p{L}\p{N} /().-]{2,60}$/u, 'Informe o setor de destino (2 a 60 caracteres).').optional(),
    motivo: z.string().trim().max(200, 'Motivo muito longo.').optional(),
  }).strict().default({}),
}).strict();

export type PedidoLote = z.infer<typeof esquemaPedidoLote>;

export interface ParametrosLote {
  idUsuarioDesignado?: string;
  distribuir?: boolean;
  prazoDevolucao?: string;
  idRotulo?: string;
  setorDestino?: string;
  motivo?: string;
}

export interface ContextoItem {
  usuario: Usuario;
  parametros: ParametrosLote;
  destinatario?: Usuario;
  marcador?: Entidade;
}

export interface ContextoAplicacao extends ContextoItem {
  agora: Date;
  gerarId: (prefixo: string) => string;
  designacoesAtivas?: Entidade[];
}

const CAIXA_EXIGIDA: Record<TipoAcao, Caixa> = {
  RECEBER: 'A_RECEBER', DESIGNAR: 'NO_SETOR', INCLUIR_MARCADOR: 'NO_SETOR', DAR_CIENCIA: 'NO_SETOR',
  ASSINAR: 'NO_SETOR', MOVIMENTAR: 'NO_SETOR', ARQUIVAR: 'NO_SETOR',
};
const NOME_CAIXA: Record<string, string> = {
  A_RECEBER: 'A receber', NO_SETOR: 'No setor', ENVIADO_NAO_RECEBIDO: 'Enviados não recebidos', BAIXADO: 'Baixados',
};
const ROTULO_ACAO: Record<TipoAcao, string> = {
  RECEBER: 'receber', DESIGNAR: 'designar', INCLUIR_MARCADOR: 'incluir marcador', DAR_CIENCIA: 'dar ciência',
  ASSINAR: 'assinar', MOVIMENTAR: 'movimentar', ARQUIVAR: 'arquivar',
};
const ACAO_APOS_RECEBER: Record<string, string> = { JUDICIAL: 'Analisar intimação', DOCUMENTO: 'Analisar documento', EXTRAJUDICIAL: 'Despachar' };
const ACAO_APOS_ASSINAR: Record<string, string> = { JUDICIAL: 'Movimentar', DOCUMENTO: 'Encaminhar', EXTRAJUDICIAL: 'Movimentar' };

/** Lê o corpo (zod) e lança 400 com a primeira mensagem de erro. */
export function lerPedidoLote(corpo: unknown): PedidoLote {
  const lido = esquemaPedidoLote.safeParse(corpo);
  if (!lido.success) throw new ErroValidacao(lido.error.issues[0]?.message ?? 'Pedido de lote inválido.');
  return lido.data;
}

/**
 * Valida o lote como um todo (perfil e parâmetros obrigatórios por ação). Lança 400/403.
 * Devolve os parâmetros normalizados.
 */
export function validarLote(pedido: PedidoLote, usuario: Usuario, agora: Date): ParametrosLote {
  const parametros = pedido.parametros ?? {};
  const p: ParametrosLote = {};
  switch (pedido.tipoAcao) {
    case 'DESIGNAR': {
      exigirPerfil(usuario, ['MEMBRO', 'CHEFE'], 'designar');
      if (parametros.distribuir === true) p.distribuir = true;
      else if (parametros.idUsuarioDesignado) p.idUsuarioDesignado = parametros.idUsuarioDesignado;
      else throw new ErroValidacao('Informe a pessoa designada ou escolha a distribuição balanceada.');
      const hoje = dataLocal(agora);
      p.prazoDevolucao = parametros.prazoDevolucao ?? somarDias(hoje, PRAZO_DEVOLUCAO_PADRAO_DIAS);
      if (p.prazoDevolucao < hoje) throw new ErroValidacao('O prazo de devolução deve ser uma data a partir de hoje.');
      break;
    }
    case 'INCLUIR_MARCADOR':
      if (!parametros.idRotulo) throw new ErroValidacao('Escolha o marcador.');
      p.idRotulo = parametros.idRotulo;
      break;
    case 'ASSINAR':
      exigirPerfil(usuario, ['MEMBRO'], 'assinar');
      break;
    case 'MOVIMENTAR':
      if (!parametros.setorDestino) throw new ErroValidacao('Informe o setor de destino (2 a 60 caracteres).');
      p.setorDestino = parametros.setorDestino.toUpperCase();
      break;
    case 'ARQUIVAR':
      if (parametros.motivo) p.motivo = parametros.motivo;
      break;
    default:
      break;
  }
  return p;
}

/** Motivo para ignorar o expediente na ação, ou null se ela se aplica. */
export function motivoIgnorar(tipoAcao: TipoAcao, expediente: Expediente | null | undefined, contexto: ContextoItem): string | null {
  if (!expediente) return 'Expediente não encontrado.';
  if (expediente.siglaSetor !== contexto.usuario.siglaSetor) return 'Expediente de outro setor.';
  const exigida = CAIXA_EXIGIDA[tipoAcao];
  if (expediente.caixa !== exigida) {
    return `Está em "${NOME_CAIXA[expediente.caixa] ?? expediente.caixa}"; só é possível ${ROTULO_ACAO[tipoAcao]} da caixa "${NOME_CAIXA[exigida]}".`;
  }
  switch (tipoAcao) {
    case 'DESIGNAR': {
      const destino = contexto.destinatario;
      if (!destino) return 'Pessoa designada não encontrada.';
      if (destino.siglaSetor !== expediente.siglaSetor || destino.ativo === false) return 'A pessoa designada não é usuária ativa do setor.';
      if (expediente.idResponsavel === destino.idUsuario && expediente.tipoResponsabilidade === 'DESIGNADO') {
        return `Já está designado a ${destino.nome}.`;
      }
      return null;
    }
    case 'INCLUIR_MARCADOR': {
      const marcador = contexto.marcador;
      if (!marcador || marcador.siglaSetor !== expediente.siglaSetor) return 'Marcador não encontrado no setor.';
      if (marcador.gerenciador !== expediente.gerenciador) return `O marcador "${marcador.descricao}" é de outro gerenciador.`;
      const atuais = String(expediente.marcadores ?? '').split(';').filter(Boolean);
      if (atuais.includes(marcador.descricao)) return `Já tem o marcador "${marcador.descricao}".`;
      return null;
    }
    case 'DAR_CIENCIA':
      if (expediente.gerenciador !== 'JUDICIAL') return 'Ciência só se aplica a processos judiciais.';
      if (!expediente.novaIntimacao && expediente.situacao !== 'AGUARDANDO_CIENCIA') return 'Não há intimação pendente de ciência.';
      return null;
    case 'ASSINAR':
      return expediente.situacao === 'AGUARDANDO_ASSINATURA' ? null : 'Não está aguardando assinatura.';
    case 'MOVIMENTAR':
      return contexto.parametros.setorDestino === expediente.siglaSetor ? 'O destino é o próprio setor.' : null;
    case 'ARQUIVAR':
      if (Number(expediente.qtdMinutasPendentes ?? 0) > 0) {
        return `Tem ${expediente.qtdMinutasPendentes} minuta(s) pendente(s); não é possível arquivar.`;
      }
      return null;
    default:
      return null;
  }
}

/** Descrição curta da mudança, para a prévia. */
export function descreverMudanca(tipoAcao: TipoAcao, expediente: Expediente, contexto: ContextoItem): string {
  switch (tipoAcao) {
    case 'RECEBER': return 'A receber → No setor';
    case 'DESIGNAR': return `${expediente.nomeResponsavel ?? '—'} → ${contexto.destinatario?.nome} (devolução até ${contexto.parametros.prazoDevolucao})`;
    case 'INCLUIR_MARCADOR': return `Incluir marcador "${contexto.marcador?.descricao}"`;
    case 'DAR_CIENCIA': return 'Dar ciência da intimação';
    case 'ASSINAR': return 'Aguardando assinatura → Pronto para envio';
    case 'MOVIMENTAR': return `No setor → Enviado para ${contexto.parametros.setorDestino}`;
    case 'ARQUIVAR': return 'No setor → Baixado (arquivado)';
    default: return tipoAcao;
  }
}

function movimentacao(e: Expediente, ctx: ContextoAplicacao, tipoMovimentacao: string, descricao: string, destino = e.siglaSetor): Entidade {
  return {
    entidade: 'movimentacoes',
    idMovimentacao: ctx.gerarId('MOV'),
    idExpediente: e.idExpediente,
    etiqueta: e.etiqueta,
    gerenciador: e.gerenciador,
    siglaSetor: e.siglaSetor,
    dataHora: isoLocal(ctx.agora),
    tipoMovimentacao,
    idUsuario: ctx.usuario.idUsuario,
    nomeUsuario: ctx.usuario.nome,
    setorOrigem: e.siglaSetor,
    setorDestino: destino,
    descricao,
  };
}

function encerrarDesignacoes(ativas: Entidade[], ctx: ContextoAplicacao): Entidade[] {
  const hoje = dataLocal(ctx.agora);
  return ativas.map((d) => ({
    ...d,
    situacao: 'ENCERRADA',
    statusDevolucao: d.prazoDevolucao >= hoje ? 'DEVOLVIDA_NO_PRAZO' : 'DEVOLVIDA_COM_ATRASO',
    dataFim: isoLocal(ctx.agora),
  }));
}

/**
 * Aplica a ação a um expediente válido (motivoIgnorar === null).
 * Devolve o expediente alterado e as entidades novas ou alteradas a gravar.
 */
export function aplicarAcao(tipoAcao: TipoAcao, original: Expediente, ctx: ContextoAplicacao): { expediente: Expediente; gravar: Entidade[] } {
  const agoraIso = isoLocal(ctx.agora);
  const e: Expediente = {
    ...original,
    dataUltimaMovimentacao: agoraIso,
    qtdMovimentacoes: Number(original.qtdMovimentacoes ?? 0) + 1,
    versao: Number(original.versao ?? 0) + 1,
  };
  const gravar: Entidade[] = [];
  switch (tipoAcao) {
    case 'RECEBER':
      Object.assign(e, { caixa: 'NO_SETOR', situacao: 'EM_ANALISE', acaoPendente: ACAO_APOS_RECEBER[e.gerenciador], dataRecebimento: agoraIso });
      gravar.push(movimentacao(e, ctx, 'RECEBIMENTO', `Recebido no setor ${e.siglaSetor}`));
      break;
    case 'DESIGNAR': {
      const destino = ctx.destinatario as Usuario;
      const prazo = ctx.parametros.prazoDevolucao as string;
      gravar.push(...encerrarDesignacoes(ctx.designacoesAtivas ?? [], ctx));
      gravar.push({
        entidade: 'designacoes',
        idDesignacao: ctx.gerarId('DES'),
        idExpediente: e.idExpediente,
        etiqueta: e.etiqueta,
        gerenciador: e.gerenciador,
        siglaSetor: e.siglaSetor,
        idUsuarioDesignado: destino.idUsuario,
        nomeDesignado: destino.nome,
        idUsuarioDesignador: ctx.usuario.idUsuario,
        nomeDesignador: ctx.usuario.nome,
        dataDesignacao: agoraIso,
        prazoDevolucao: prazo,
        diasParaDevolucao: diferencaDias(dataLocal(ctx.agora), prazo),
        situacao: 'ATIVA',
        statusDevolucao: 'NO_PRAZO',
      });
      Object.assign(e, { idResponsavel: destino.idUsuario, nomeResponsavel: destino.nome, tipoResponsabilidade: 'DESIGNADO', designado: true });
      gravar.push(movimentacao(e, ctx, 'DESIGNACAO', `Designado a ${destino.nome} até ${prazo}`));
      break;
    }
    case 'INCLUIR_MARCADOR': {
      const m = ctx.marcador as Entidade;
      const lista = String(e.marcadores ?? '').split(';').filter(Boolean);
      lista.push(m.descricao);
      Object.assign(e, { marcadores: lista.join(';'), qtdMarcadores: lista.length });
      gravar.push({
        entidade: 'marcadores_expedientes',
        idRotulo: m.idRotulo,
        descricao: m.descricao,
        cor: m.cor,
        idExpediente: e.idExpediente,
        etiqueta: e.etiqueta,
        gerenciador: e.gerenciador,
        siglaSetor: e.siglaSetor,
        idUsuario: ctx.usuario.idUsuario,
        dataInclusao: agoraIso,
      });
      gravar.push(movimentacao(e, ctx, 'MARCADOR_INCLUIDO', `Marcador "${m.descricao}" incluído`));
      break;
    }
    case 'DAR_CIENCIA':
      Object.assign(e, { novaIntimacao: false, situacao: 'EM_ANALISE', acaoPendente: 'Analisar intimação' });
      gravar.push(movimentacao(e, ctx, 'CIENCIA', 'Ciência da intimação registrada'));
      break;
    case 'ASSINAR':
      Object.assign(e, { situacao: 'PRONTO_PARA_ENVIO', acaoPendente: ACAO_APOS_ASSINAR[e.gerenciador], qtdMinutasPendentes: 0 });
      gravar.push(movimentacao(e, ctx, 'ASSINATURA', 'Manifestação assinada'));
      break;
    case 'MOVIMENTAR': {
      const destino = ctx.parametros.setorDestino as string;
      Object.assign(e, { caixa: 'ENVIADO_NAO_RECEBIDO', situacao: 'ENVIADO', acaoPendente: 'Aguardar recebimento pelo destino', setorDestino: destino });
      gravar.push(movimentacao(e, ctx, 'ENVIO_PELO_SETOR', `Enviado para ${destino}`, destino));
      break;
    }
    case 'ARQUIVAR': {
      gravar.push(...encerrarDesignacoes(ctx.designacoesAtivas ?? [], ctx));
      const atraso = original.diasRestantes !== undefined && original.diasRestantes < 0;
      Object.assign(e, {
        caixa: 'BAIXADO', situacao: 'CONCLUIDO_ARQUIVADO', acaoPendente: 'Nenhuma', requerAcao: false,
        statusPrazo: atraso ? 'CUMPRIDO_COM_ATRASO' : 'CUMPRIDO', pontuacaoPrioridade: 0, prioridade: 'BAIXA', novo: false,
      });
      const motivo = ctx.parametros.motivo ? `: ${ctx.parametros.motivo}` : '';
      gravar.push(movimentacao(e, ctx, 'ARQUIVAMENTO', `Expediente arquivado${motivo}`));
      break;
    }
    default:
      throw new ErroValidacao(`Ação desconhecida: ${String(tipoAcao)}.`);
  }
  return { expediente: e, gravar };
}
