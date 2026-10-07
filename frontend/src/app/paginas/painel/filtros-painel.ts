// Conversão entre o formulário de filtros da tela e os critérios JSON da API (formato de filtros_salvos).

import type { Criterios } from '../../core/modelos';

export interface FormularioFiltros {
  statusPrazo: string[];
  prioridade: string[];
  idResponsavel: string;
  assunto: string;
  classe: string;
  tema: string;
  situacao: string;
  marcador: string;
  chegadaDe: string;
  chegadaAte: string;
  prazoDe: string;
  prazoAte: string;
  tempoParadoMin: number | null;
  riscoMin: number | null;
  urgente: boolean;
  reuPreso: boolean;
  idoso: boolean;
  novaIntimacao: boolean;
  sigiloso: boolean;
  favorito: boolean;
  novo: boolean;
  designadoAMim: boolean;
  requerAcao: boolean;
  /** Critérios que a tela não edita (vindos de filtro salvo), preservados como estão. */
  extras: Criterios;
}

export const SINALIZACOES = [
  ['urgente', 'Urgente'], ['reuPreso', 'Réu preso'], ['idoso', 'Idoso'], ['novaIntimacao', 'Nova intimação'],
  ['sigiloso', 'Sigiloso'], ['favorito', 'Favorito'], ['novo', 'Novo (24h)'], ['designadoAMim', 'Designado a mim'],
  ['requerAcao', 'Exige ação'],
] as const;

type Sinalizacao = (typeof SINALIZACOES)[number][0];

export function formularioVazio(): FormularioFiltros {
  return {
    statusPrazo: [], prioridade: [], idResponsavel: '', assunto: '', classe: '', tema: '', situacao: '', marcador: '',
    chegadaDe: '', chegadaAte: '', prazoDe: '', prazoAte: '', tempoParadoMin: null, riscoMin: null,
    urgente: false, reuPreso: false, idoso: false, novaIntimacao: false, sigiloso: false, favorito: false, novo: false,
    designadoAMim: false, requerAcao: false, extras: {},
  };
}

const LISTAS = ['statusPrazo', 'prioridade'] as const;
const UNICOS = { idResponsavel: 'idResponsavel', assunto: 'assunto', classe: 'classe', tema: 'tema', situacao: 'situacao', marcador: 'marcadores' } as const;
const INTERVALOS = { chegadaDe: 'dataChegadaMin', chegadaAte: 'dataChegadaMax', prazoDe: 'dataPrazoMin', prazoAte: 'dataPrazoMax' } as const;
const BOOLEANOS: Sinalizacao[] = ['urgente', 'reuPreso', 'idoso', 'novaIntimacao', 'sigiloso', 'favorito', 'novo', 'requerAcao'];

export function paraCriterios(f: FormularioFiltros): Criterios {
  const c: Criterios = { ...f.extras };
  for (const campo of LISTAS) if (f[campo].length) c[campo] = [...f[campo]];
  for (const [campo, chave] of Object.entries(UNICOS) as [keyof typeof UNICOS, string][]) if (f[campo]) c[chave] = [f[campo]];
  for (const [campo, chave] of Object.entries(INTERVALOS) as [keyof typeof INTERVALOS, string][]) if (f[campo]) c[chave] = f[campo];
  if (f.tempoParadoMin !== null && f.tempoParadoMin !== undefined && !Number.isNaN(f.tempoParadoMin)) c['tempoParadoDiasMin'] = f.tempoParadoMin;
  if (f.riscoMin !== null && f.riscoMin !== undefined && !Number.isNaN(f.riscoMin)) c['riscoMin'] = f.riscoMin;
  for (const campo of BOOLEANOS) if (f[campo]) c[campo] = true;
  if (f.designadoAMim) {
    c['idResponsavel'] = '$USUARIO';
    c['tipoResponsabilidade'] = 'DESIGNADO';
  }
  return c;
}

const primeiro = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : v === undefined ? '' : String(v));

export function deCriterios(criterios: Criterios): FormularioFiltros {
  const f = formularioVazio();
  const resto: Criterios = { ...criterios };
  for (const campo of LISTAS) {
    if (resto[campo] !== undefined) {
      const v = resto[campo];
      f[campo] = (Array.isArray(v) ? v : [v]).map(String);
      delete resto[campo];
    }
  }
  if (resto['idResponsavel'] === '$USUARIO' && resto['tipoResponsabilidade'] === 'DESIGNADO') {
    f.designadoAMim = true;
    delete resto['idResponsavel'];
    delete resto['tipoResponsabilidade'];
  }
  for (const [campo, chave] of Object.entries(UNICOS) as [keyof typeof UNICOS, string][]) {
    const v = resto[chave];
    // Só trata como campo da tela se for um único valor; listas maiores ficam em "extras".
    if (v !== undefined && (!Array.isArray(v) || v.length === 1) && primeiro(v) !== '$USUARIO') {
      f[campo] = primeiro(v);
      delete resto[chave];
    }
  }
  for (const [campo, chave] of Object.entries(INTERVALOS) as [keyof typeof INTERVALOS, string][]) {
    if (typeof resto[chave] === 'string') {
      f[campo] = String(resto[chave]).slice(0, 10);
      delete resto[chave];
    }
  }
  if (typeof resto['tempoParadoDiasMin'] === 'number') {
    f.tempoParadoMin = resto['tempoParadoDiasMin'] as number;
    delete resto['tempoParadoDiasMin'];
  }
  if (typeof resto['riscoMin'] === 'number') {
    f.riscoMin = resto['riscoMin'] as number;
    delete resto['riscoMin'];
  }
  for (const campo of BOOLEANOS) {
    if (resto[campo] === true) {
      f[campo] = true;
      delete resto[campo];
    }
  }
  f.extras = resto;
  return f;
}

/** Quantos filtros estão ativos (para o rótulo do botão). */
export function contarFiltros(f: FormularioFiltros): number {
  return Object.keys(paraCriterios(f)).length - (f.designadoAMim ? 1 : 0);
}
