// Regras de prazo e prioridade (RN1, RN2, RN3) e risco de vencimento (RF08).
// Funções puras: recebem a data de referência explicitamente, para serem testáveis.

import type { Caixa, Expediente, Parcela, Prioridade, StatusPrazo } from './tipos.js';

const FUSO_MS = -3 * 60 * 60 * 1000; // Brasília, sem horário de verão
const DIA_MS = 24 * 60 * 60 * 1000;

export const PONTOS_PRAZO: Readonly<Record<string, number>> = Object.freeze({
  VENCIDO: 50, VENCE_HOJE: 45, CRITICO: 35, ATENCAO: 20, NO_PRAZO: 5,
});
export const PONTOS = Object.freeze({ URGENTE: 30, NOVA_INTIMACAO: 10, PARADO: 10, AGUARDANDO_ASSINATURA: 5 });
export const LIMITE_PARADO_DIAS = 30;
export const CAIXAS_ATIVAS: readonly Caixa[] = Object.freeze(['A_RECEBER', 'NO_SETOR', 'ENVIADO_NAO_RECEBIDO']);
export const CAIXAS_COM_ACAO: readonly Caixa[] = Object.freeze(['A_RECEBER', 'NO_SETOR']);

const ROTULO_PRAZO: Record<string, string> = {
  VENCIDO: 'Prazo vencido',
  VENCE_HOJE: 'Vence hoje',
  CRITICO: 'Vence em até 3 dias',
  ATENCAO: 'Vence em até 7 dias',
  NO_PRAZO: 'No prazo',
};

/** 'AAAA-MM-DD' do instante no fuso de Brasília. */
export function dataLocal(instante: Date | string): string {
  const data = instante instanceof Date ? instante : new Date(instante);
  return new Date(data.getTime() + FUSO_MS).toISOString().slice(0, 10);
}

/** ISO 8601 com fuso −03:00, no mesmo formato da base (sem milissegundos). */
export function isoLocal(instante: Date | string): string {
  const data = instante instanceof Date ? instante : new Date(instante);
  return `${new Date(data.getTime() + FUSO_MS).toISOString().slice(0, 19)}-03:00`;
}

/** Soma dias de calendário a uma data 'AAAA-MM-DD'. */
export function somarDias(dataTexto: string, dias: number): string {
  const [a, m, d] = dataTexto.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Dias de calendário entre duas datas 'AAAA-MM-DD' (fim − início). */
export function diferencaDias(inicio: string, fim: string): number {
  const ms = (texto: string) => {
    const [a, m, d] = texto.slice(0, 10).split('-').map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((ms(fim) - ms(inicio)) / DIA_MS);
}

/** Dias inteiros decorridos (arredondado para baixo) entre dois instantes. */
export function diasDecorridos(desde: string | Date, ate: Date): number {
  return Math.floor((ate.getTime() - new Date(desde).getTime()) / DIA_MS);
}

/** RN1: situação do prazo a partir dos dias restantes. */
export function classificarPrazo(diasRestantes: number): StatusPrazo {
  if (diasRestantes < 0) return 'VENCIDO';
  if (diasRestantes === 0) return 'VENCE_HOJE';
  if (diasRestantes <= 3) return 'CRITICO';
  if (diasRestantes <= 7) return 'ATENCAO';
  return 'NO_PRAZO';
}

export function rotuloPrazo(statusPrazo: string): string {
  return ROTULO_PRAZO[statusPrazo] ?? statusPrazo;
}

/**
 * RN2: composição da pontuação. Devolve as parcelas (para explicar a prioridade) e o total.
 * Enviados não recebidos valem metade (divisão inteira); o total é limitado a 100.
 */
export function comporPrioridade(expediente: Partial<Expediente>): { parcelas: Parcela[]; total: number } {
  if (expediente.caixa === 'BAIXADO') return { parcelas: [], total: 0 };
  const parcelas: Parcela[] = [];
  const status = expediente.statusPrazo ?? '';
  if (PONTOS_PRAZO[status] !== undefined) {
    parcelas.push({ motivo: `Prazo: ${rotuloPrazo(status).toLowerCase()}`, pontos: PONTOS_PRAZO[status] });
  }
  if (expediente.urgente) {
    const motivo = expediente.motivoUrgencia && expediente.motivoUrgencia !== 'Nenhum' ? ` (${expediente.motivoUrgencia})` : '';
    parcelas.push({ motivo: `Urgente${motivo}`, pontos: PONTOS.URGENTE });
  }
  if (expediente.novaIntimacao) parcelas.push({ motivo: 'Nova intimação', pontos: PONTOS.NOVA_INTIMACAO });
  const parado = expediente.tempoParadoDias ?? 0;
  if (parado > LIMITE_PARADO_DIAS) parcelas.push({ motivo: `Parado há ${parado} dias`, pontos: PONTOS.PARADO });
  if (expediente.situacao === 'AGUARDANDO_ASSINATURA') {
    parcelas.push({ motivo: 'Aguardando assinatura', pontos: PONTOS.AGUARDANDO_ASSINATURA });
  }
  let total = parcelas.reduce((soma, p) => soma + p.pontos, 0);
  if (expediente.caixa === 'ENVIADO_NAO_RECEBIDO') {
    const metade = Math.floor(total / 2);
    parcelas.push({ motivo: 'Enviado e não recebido: conta metade', pontos: metade - total });
    total = metade;
  }
  return { parcelas, total: Math.min(total, 100) };
}

/** RN2: faixa de prioridade. */
export function nivelPrioridade(pontos: number): Prioridade {
  if (pontos >= 60) return 'CRITICA';
  if (pontos >= 35) return 'ALTA';
  if (pontos >= 20) return 'MEDIA';
  return 'BAIXA';
}

/** RF08: risco de vencimento (0–100), só para prazos não vencidos; null nos demais. */
export function riscoVencimento(tempoParadoDias: number, diasRestantes: number | null | undefined): number | null {
  if (diasRestantes === null || diasRestantes === undefined || diasRestantes < 0) return null;
  return Math.min(100, Math.round((20 * (tempoParadoDias + 1)) / (diasRestantes + 1)));
}

/**
 * Recalcula os campos derivados de um expediente ativo pela data de referência.
 * Não altera o objeto recebido. Baixados são devolvidos como estão (histórico).
 */
export function recalcular<T extends Expediente>(expediente: T, agora: Date): T {
  if (expediente.caixa === 'BAIXADO') return { ...expediente, risco: null };
  const hoje = dataLocal(agora);
  const e: T = { ...expediente };
  if (e.dataPrazo) {
    e.diasRestantes = diferencaDias(hoje, e.dataPrazo);
    e.statusPrazo = classificarPrazo(e.diasRestantes);
  }
  if (e.dataUltimaMovimentacao) e.tempoParadoDias = Math.max(0, diasDecorridos(e.dataUltimaMovimentacao, agora));
  if (e.dataChegada) {
    e.diasNoSetor = Math.max(0, diasDecorridos(e.dataChegada, agora));
    e.novo = agora.getTime() - new Date(e.dataChegada).getTime() <= DIA_MS;
  }
  e.requerAcao = CAIXAS_COM_ACAO.includes(e.caixa);
  e.pontuacaoPrioridade = comporPrioridade(e).total;
  e.prioridade = nivelPrioridade(e.pontuacaoPrioridade);
  e.risco = riscoVencimento(e.tempoParadoDias ?? 0, e.diasRestantes);
  return e;
}

/** RN3: data do prazo crescente; no empate, pontuação decrescente; depois id (estável). */
export function compararFila(a: Partial<Expediente>, b: Partial<Expediente>): number {
  const pa = a.dataPrazo ?? '9999-12-31';
  const pb = b.dataPrazo ?? '9999-12-31';
  if (pa !== pb) return pa < pb ? -1 : 1;
  const diferenca = (b.pontuacaoPrioridade ?? 0) - (a.pontuacaoPrioridade ?? 0);
  if (diferenca !== 0) return diferenca;
  return String(a.idExpediente).localeCompare(String(b.idExpediente));
}

const ABREVIACAO: Record<string, string> = { JUDICIAL: 'JUD', DOCUMENTO: 'DOC', EXTRAJUDICIAL: 'EXT' };

/** Chaves de índice do expediente, no mesmo formato de seed/gerar_seed.py. */
export function chavesIndice(expediente: Expediente): Record<string, string> {
  const abreviacao = ABREVIACAO[expediente.gerenciador];
  const sigla = expediente.siglaSetor;
  const id = expediente.idExpediente;
  const pontos = String(100 - (expediente.pontuacaoPrioridade ?? 0)).padStart(3, '0');
  const baixado = expediente.caixa === 'BAIXADO';
  return {
    GSI1PK: `SETOR#${sigla}`,
    GSI1SK: baixado
      ? `HIST#${abreviacao}#${expediente.dataUltimaMovimentacao}#${id}`
      : `ATIVO#${abreviacao}#${expediente.caixa}#${expediente.dataChegada}#${id}`,
    GSI2PK: baixado ? `SETOR#${sigla}#HIST` : `SETOR#${sigla}`,
    GSI2SK: `PRAZO#${expediente.dataPrazo}#${pontos}#${id}`,
  };
}

export function abreviacaoGerenciador(gerenciador: string): string {
  return ABREVIACAO[gerenciador];
}
