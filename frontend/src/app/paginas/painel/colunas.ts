// Colunas disponíveis no painel (RF05). "etiqueta" é fixa: identifica a linha.

export interface Coluna {
  campo: string;
  titulo: string;
  ordenavel: boolean;
  /** Esconde em telas pequenas (a informação continua no detalhe). */
  secundaria?: boolean;
}

export const COLUNAS: Coluna[] = [
  { campo: 'etiqueta', titulo: 'Expediente', ordenavel: true },
  { campo: 'gerenciador', titulo: 'Gerenciador', ordenavel: true, secundaria: true },
  { campo: 'caixa', titulo: 'Caixa', ordenavel: true, secundaria: true },
  { campo: 'numeroReferencia', titulo: 'Número', ordenavel: true, secundaria: true },
  { campo: 'classe', titulo: 'Classe', ordenavel: true, secundaria: true },
  { campo: 'assunto', titulo: 'Assunto', ordenavel: true },
  { campo: 'situacao', titulo: 'Situação', ordenavel: true, secundaria: true },
  { campo: 'acaoPendente', titulo: 'Ação pendente', ordenavel: true, secundaria: true },
  { campo: 'dataChegada', titulo: 'Chegada', ordenavel: true, secundaria: true },
  { campo: 'dataPrazo', titulo: 'Prazo', ordenavel: true },
  { campo: 'statusPrazo', titulo: 'Situação do prazo', ordenavel: true },
  { campo: 'prioridade', titulo: 'Prioridade', ordenavel: false },
  { campo: 'pontuacaoPrioridade', titulo: 'Pontos', ordenavel: true, secundaria: true },
  { campo: 'risco', titulo: 'Risco', ordenavel: true, secundaria: true },
  { campo: 'nomeResponsavel', titulo: 'Responsável', ordenavel: true, secundaria: true },
  { campo: 'marcadores', titulo: 'Marcadores', ordenavel: false, secundaria: true },
  { campo: 'tempoParadoDias', titulo: 'Parado (dias)', ordenavel: true, secundaria: true },
];

export const COLUNAS_PADRAO = [
  'etiqueta', 'gerenciador', 'assunto', 'acaoPendente', 'dataPrazo', 'statusPrazo', 'prioridade', 'nomeResponsavel', 'tempoParadoDias',
];

/** Normaliza a lista salva: só colunas conhecidas, sem repetição, com "etiqueta" primeiro. */
export function normalizarColunas(lista: string[] | undefined): string[] {
  const conhecidas = new Set(COLUNAS.map((c) => c.campo));
  const validas = (lista ?? []).filter((c, i, todas) => conhecidas.has(c) && todas.indexOf(c) === i && c !== 'etiqueta');
  return validas.length ? ['etiqueta', ...validas] : [...COLUNAS_PADRAO];
}
