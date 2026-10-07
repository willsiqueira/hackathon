// Filtros (mesmo formato JSON de filtros_salvos.criterios), busca textual e ordenação.
//   {"statusPrazo": ["VENCIDO", "CRITICO"]}   lista = "um destes"
//   {"urgente": true}                         valor simples = igualdade
//   {"tempoParadoDiasMin": 30}                sufixo Min = maior ou igual; Max = menor ou igual
//   {"idResponsavel": "$USUARIO"}              substituído pelo usuário autenticado
//   {"q": "texto"}                            busca em etiqueta, referência, assunto, resumo, classe, responsável

import { z } from 'zod';
import { compararFila } from './regras.js';
import { ErroValidacao } from './erros.js';
import type { Expediente } from './tipos.js';

export const CAMPOS_EXPEDIENTE = Object.freeze([
  'idExpediente', 'gerenciador', 'siglaSetor', 'caixa', 'situacao', 'acaoPendente', 'requerAcao', 'etiqueta',
  'numeroReferencia', 'classe', 'descricaoClasse', 'tema', 'assunto', 'resumo', 'orgaoOrigem', 'tipoEntrada',
  'setorOrigem', 'setorDestino', 'dataAutuacao', 'dataChegada', 'dataRecebimento', 'dataUltimaMovimentacao',
  'diasNoSetor', 'tempoParadoDias', 'tipoPrazo', 'dataInicioPrazo', 'dataPrazo', 'duracaoPrazoDias', 'diasRestantes',
  'statusPrazo', 'prioridade', 'pontuacaoPrioridade', 'urgente', 'motivoUrgencia', 'reuPreso', 'idoso',
  'novaIntimacao', 'novo', 'idResponsavel', 'nomeResponsavel', 'tipoResponsabilidade', 'oficioResponsavel',
  'designado', 'eletronico', 'nivelSigilo', 'sigiloso', 'favorito', 'marcadores', 'qtdMarcadores', 'qtdAnotacoes',
  'qtdMinutasPendentes', 'qtdMovimentacoes', 'risco',
] as const);

const CAMPOS = new Set<string>(CAMPOS_EXPEDIENTE);
const CAMPOS_BUSCA = ['etiqueta', 'numeroReferencia', 'assunto', 'resumo', 'descricaoClasse', 'classe', 'nomeResponsavel'];

const escalar = z.union([z.string().max(200), z.number().finite(), z.boolean()]);
const esquemaCriterios = z.record(z.string().max(60), z.union([escalar, z.array(escalar).max(50)]));

export type Criterios = Record<string, string | number | boolean | Array<string | number | boolean>>;
export interface Ordenacao {
  campo: string;
  direcao: 'asc' | 'desc';
}

function campoBase(chave: string): string {
  return chave.endsWith('Min') || chave.endsWith('Max') ? chave.slice(0, -3) : chave;
}

/** Valida e normaliza critérios vindos da tela ou de um filtro salvo. Lança ErroValidacao. */
export function validarCriterios(criterios: unknown): Criterios {
  if (criterios === undefined || criterios === null) return {};
  const lido = esquemaCriterios.safeParse(criterios);
  if (!lido.success) throw new ErroValidacao('Critérios inválidos: use valores simples ou listas de valores simples.');
  const resultado: Criterios = {};
  for (const [chave, valor] of Object.entries(lido.data)) {
    if (chave === 'q') {
      if (typeof valor !== 'string') throw new ErroValidacao('Texto de busca inválido.');
      if (valor.trim()) resultado.q = valor.trim();
      continue;
    }
    if (!CAMPOS.has(campoBase(chave))) throw new ErroValidacao(`Filtro desconhecido: ${chave}.`);
    if (Array.isArray(valor)) {
      if (valor.length) resultado[chave] = valor;
    } else if (valor !== '') {
      resultado[chave] = valor;
    }
  }
  return resultado;
}

function normalizarTexto(texto: unknown): string {
  return String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function comparavel(valor: unknown): unknown {
  // Datas ISO completas são comparadas pelo dia, para que "até 07/10" inclua o dia inteiro.
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)) return valor.slice(0, 10);
  return valor;
}

function atende(expediente: Expediente, chave: string, valor: Criterios[string], idUsuario?: string): boolean {
  const resolver = (v: unknown) => (v === '$USUARIO' ? idUsuario : v);
  if (chave.endsWith('Min') || chave.endsWith('Max')) {
    const atual = expediente[campoBase(chave)];
    if (atual === null || atual === undefined) return false;
    const a = comparavel(atual) as string | number;
    const v = comparavel(valor) as string | number;
    return chave.endsWith('Min') ? a >= v : a <= v;
  }
  const atual = expediente[chave];
  if (chave === 'marcadores') {
    const lista = String(atual ?? '').split(';').filter(Boolean);
    const procurados = Array.isArray(valor) ? valor : [valor];
    return procurados.some((m) => lista.includes(String(m)));
  }
  if (Array.isArray(valor)) return valor.map(resolver).some((v) => String(v) === String(atual));
  return String(resolver(valor)) === String(atual);
}

/** Aplica critérios já validados. */
export function filtrar<T extends Expediente>(expedientes: T[], criterios: Criterios, usuario?: { idUsuario?: string }): T[] {
  const entradas = Object.entries(criterios).filter(([chave]) => chave !== 'q');
  const termos = typeof criterios.q === 'string' ? normalizarTexto(criterios.q).split(/\s+/).filter(Boolean) : [];
  return expedientes.filter((e) => {
    if (!entradas.every(([chave, valor]) => atende(e, chave, valor, usuario?.idUsuario))) return false;
    if (!termos.length) return true;
    const alvo = normalizarTexto(CAMPOS_BUSCA.map((c) => e[c]).join(' '));
    return termos.every((t) => alvo.includes(t));
  });
}

/** "campo:asc|desc" ou "fila" (RN3). Lança ErroValidacao para campo desconhecido. */
export function interpretarOrdenacao(texto?: string): Ordenacao {
  if (!texto || texto === 'fila') return { campo: 'fila', direcao: 'asc' };
  const [campo, direcao = 'asc'] = String(texto).split(':');
  if (!CAMPOS.has(campo) || (direcao !== 'asc' && direcao !== 'desc')) {
    throw new ErroValidacao(`Ordenação inválida: ${texto}.`);
  }
  return { campo, direcao };
}

const vazio = (v: unknown) => v === null || v === undefined || v === '';

/** Ordena uma cópia. Nulos sempre no fim; empates seguem a ordem da fila. */
export function ordenar<T extends Expediente>(expedientes: T[], { campo, direcao }: Ordenacao): T[] {
  const copia = [...expedientes];
  if (campo === 'fila') return copia.sort(compararFila);
  const sinal = direcao === 'desc' ? -1 : 1;
  return copia.sort((a, b) => {
    const va = a[campo];
    const vb = b[campo];
    if (vazio(va) || vazio(vb)) {
      if (vazio(va) && vazio(vb)) return compararFila(a, b);
      return vazio(va) ? 1 : -1;
    }
    let resultado: number;
    if (typeof va === 'number' && typeof vb === 'number') resultado = va - vb;
    else if (typeof va === 'boolean') resultado = Number(va) - Number(vb);
    else resultado = String(va).localeCompare(String(vb), 'pt-BR');
    return resultado !== 0 ? sinal * resultado : compararFila(a, b);
  });
}

/** Página 1-based. */
export function paginar<T>(lista: T[], pagina: number, tamanho: number): T[] {
  const inicio = (pagina - 1) * tamanho;
  return lista.slice(inicio, inicio + tamanho);
}
