// Contexto entregue a cada handler: dependências e dados já autenticados.

import type { Repositorio } from '../dados/repositorio.js';
import type { Setor, Usuario } from '../dominio/tipos.js';
import type { PublicadorEventos } from '../eventos/eventos.js';
import type { Ia } from '../servicos/ia.js';
import type { Arquivo } from './http.js';

export interface Contexto {
  repo: Repositorio;
  eventos: PublicadorEventos;
  /** Modelo de linguagem (Bedrock ou modo demonstração). */
  ia: Ia;
  agora: Date;
  usuario: Usuario;
  setor: Setor;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  corpo: unknown;
}

/** Resposta com status diferente de 200. */
export interface ComStatus {
  comStatus: true;
  status: number;
  corpo?: unknown;
}

export const criado = (corpo: unknown): ComStatus => ({ comStatus: true, status: 201, corpo });
export const semConteudo = (): ComStatus => ({ comStatus: true, status: 204 });

/** Resultado de handler: objeto JSON (200), ComStatus ou Arquivo. */
export type Resultado = unknown | ComStatus | Arquivo;

export type Handler = (ctx: Contexto) => Promise<Resultado>;
