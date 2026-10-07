// Utilitários de requisição e resposta, comuns à Lambda e ao servidor local.

import type { z } from 'zod';
import { ErroNegocio, ErroValidacao } from '../dominio/erros.js';

export const MAX_CORPO_BYTES = 100 * 1024;

export interface Resposta {
  status: number;
  cabecalhos: Record<string, string>;
  corpo: string;
}

const CABECALHOS_SEGURANCA = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(status: number, corpo: unknown): Resposta {
  return {
    status,
    cabecalhos: { 'Content-Type': 'application/json; charset=utf-8', ...CABECALHOS_SEGURANCA },
    corpo: JSON.stringify(corpo),
  };
}

/** Resposta de arquivo (CSV, ICS). Marcada para o roteador não envolver em JSON. */
export interface Arquivo {
  arquivo: true;
  tipo: string;
  nome: string;
  conteudo: string;
}

export function arquivo(dados: Omit<Arquivo, 'arquivo'>): Arquivo {
  return { arquivo: true, ...dados };
}

export function respostaArquivo({ tipo, nome, conteudo }: Arquivo): Resposta {
  return {
    status: 200,
    cabecalhos: {
      'Content-Type': `${tipo}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="${nome.replace(/[^\w.-]/g, '_')}"`,
      ...CABECALHOS_SEGURANCA,
    },
    corpo: conteudo,
  };
}

/** Log estruturado de erro inesperado: só nome, mensagem e pilha (nunca corpo da requisição ou dados do expediente). */
export function registrarErro(erro: unknown): void {
  const e = erro instanceof Error ? erro : new Error(String(erro));
  console.error(JSON.stringify({ nivel: 'ERRO', tipo: e.name, mensagem: e.message, pilha: e.stack?.split('\n').slice(0, 5) }));
}

export function respostaDeErro(erro: unknown, registrar: (e: unknown) => void = registrarErro): Resposta {
  if (erro instanceof ErroNegocio) return json(erro.status, { erro: erro.codigo, mensagem: erro.message });
  registrar(erro);
  return json(500, { erro: 'ERRO_INTERNO', mensagem: 'Erro inesperado. Tente de novo.' });
}

export function lerCorpoJson(texto: string | null | undefined): unknown {
  if (texto === undefined || texto === null || texto === '') return undefined;
  if (Buffer.byteLength(texto) > MAX_CORPO_BYTES) throw new ErroValidacao('Corpo da requisição muito grande.');
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErroValidacao('JSON inválido.');
  }
}

/** Valida com zod e lança 400 com a primeira mensagem. */
export function validar<T extends z.ZodType>(esquema: T, valor: unknown): z.infer<T> {
  const lido = esquema.safeParse(valor);
  if (!lido.success) {
    const problema = lido.error.issues[0];
    const campo = problema?.path?.length ? `${problema.path.join('.')}: ` : '';
    throw new ErroValidacao(`${campo}${problema?.message ?? 'Entrada inválida.'}`);
  }
  return lido.data;
}

export function inteiro(valor: string | undefined, opcoes: { padrao: number; min: number; max: number; nome: string }): number {
  if (valor === undefined || valor === '') return opcoes.padrao;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < opcoes.min || numero > opcoes.max) {
    throw new ErroValidacao(`${opcoes.nome} deve ser um inteiro entre ${opcoes.min} e ${opcoes.max}.`);
  }
  return numero;
}

export function jsonDaQuery(valor: string | undefined, nome: string): unknown {
  if (!valor) return undefined;
  if (valor.length > 4000) throw new ErroValidacao(`${nome} muito longo.`);
  try {
    return JSON.parse(valor);
  } catch {
    throw new ErroValidacao(`${nome} deve ser JSON válido.`);
  }
}

export function identificador(valor: unknown, nome = 'Identificador'): string {
  if (typeof valor !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(valor)) throw new ErroValidacao(`${nome} inválido.`);
  return valor;
}
