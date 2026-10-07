// Interface mínima de acesso à tabela única. Implementada em memória (local/testes) e sobre o DynamoDB.

import type { Entidade } from '../dominio/tipos.js';

export type NomeIndice = 'GSI1' | 'GSI2';

export interface Consulta {
  indice?: NomeIndice;
  pk: string;
  prefixo?: string;
  decrescente?: boolean;
  limite?: number;
}

export type Operacao = { put: Entidade } | { delete: { PK: string; SK: string } };

export interface Tabela {
  obter(pk: string, sk: string): Promise<Entidade | null>;
  /** Consulta por chave de partição e prefixo da chave de ordenação (nunca Scan). */
  consultar(consulta: Consulta): Promise<Entidade[]>;
  /** Grava as operações juntas (transação quando possível). */
  gravar(operacoes: Operacao[]): Promise<void>;
}

export const ATRIBUTOS_INDICE: Record<NomeIndice, [string, string]> = {
  GSI1: ['GSI1PK', 'GSI1SK'],
  GSI2: ['GSI2PK', 'GSI2SK'],
};
