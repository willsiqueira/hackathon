// Tabela em memória com a mesma semântica de chaves do DynamoDB (PK/SK, GSI1, GSI2).
// Usada no servidor local e nos testes. Os itens são copiados na entrada e na saída.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { ATRIBUTOS_INDICE, type Consulta, type NomeIndice, type Operacao, type Tabela } from './tabela.js';
import type { Entidade } from '../dominio/tipos.js';

const SEP = '\u0000';
type Particao = 'base' | NomeIndice;

export class TabelaMemoria implements Tabela {
  private readonly itens = new Map<string, Entidade>();
  private readonly particoes: Record<Particao, Map<string, Set<string>>> = {
    base: new Map(), GSI1: new Map(), GSI2: new Map(),
  };

  private static chave(pk: string, sk: string): string {
    return `${pk}${SEP}${sk}`;
  }

  private indexar(chave: string, item: Entidade, adicionar: boolean): void {
    const registrar = (mapa: Map<string, Set<string>>, pk: unknown) => {
      if (typeof pk !== 'string') return;
      let conjunto = mapa.get(pk);
      if (!conjunto) mapa.set(pk, (conjunto = new Set()));
      if (adicionar) conjunto.add(chave);
      else conjunto.delete(chave);
    };
    registrar(this.particoes.base, item.PK);
    for (const [nome, [pk, sk]] of Object.entries(ATRIBUTOS_INDICE) as [NomeIndice, [string, string]][]) {
      if (item[pk] !== undefined && item[sk] !== undefined) registrar(this.particoes[nome], item[pk]);
    }
  }

  private inserir(item: Entidade): void {
    if (typeof item.PK !== 'string' || typeof item.SK !== 'string') throw new Error('Item sem PK/SK.');
    const chave = TabelaMemoria.chave(item.PK, item.SK);
    const anterior = this.itens.get(chave);
    if (anterior) this.indexar(chave, anterior, false);
    const copia = structuredClone(item);
    this.itens.set(chave, copia);
    this.indexar(chave, copia, true);
  }

  private remover(pk: string, sk: string): void {
    const chave = TabelaMemoria.chave(pk, sk);
    const anterior = this.itens.get(chave);
    if (!anterior) return;
    this.indexar(chave, anterior, false);
    this.itens.delete(chave);
  }

  async obter(pk: string, sk: string): Promise<Entidade | null> {
    const item = this.itens.get(TabelaMemoria.chave(pk, sk));
    return item ? structuredClone(item) : null;
  }

  async consultar({ indice, pk, prefixo = '', decrescente = false, limite }: Consulta): Promise<Entidade[]> {
    const atributoSk = indice ? ATRIBUTOS_INDICE[indice][1] : 'SK';
    const conjunto = this.particoes[indice ?? 'base'].get(pk);
    if (!conjunto) return [];
    const encontrados: Entidade[] = [];
    for (const chave of conjunto) {
      const item = this.itens.get(chave) as Entidade;
      const sk = item[atributoSk];
      if (typeof sk === 'string' && sk.startsWith(prefixo)) encontrados.push(item);
    }
    encontrados.sort((a, b) => (a[atributoSk] < b[atributoSk] ? -1 : a[atributoSk] > b[atributoSk] ? 1 : 0));
    if (decrescente) encontrados.reverse();
    const fatia = limite ? encontrados.slice(0, limite) : encontrados;
    return fatia.map((item) => structuredClone(item));
  }

  async gravar(operacoes: Operacao[]): Promise<void> {
    for (const op of operacoes) {
      if ('put' in op) this.inserir(op.put);
      else this.remover(op.delete.PK, op.delete.SK);
    }
  }

  get tamanho(): number {
    return this.itens.size;
  }
}

type ValorDynamo = { S: string } | { N: string } | { BOOL: boolean } | { NULL: true } | { M: Record<string, ValorDynamo> } | { L: ValorDynamo[] };

/** Converte um valor em DynamoDB JSON (S, N, BOOL, NULL, M, L) para JavaScript. */
export function desserializar(valor: ValorDynamo): unknown {
  if ('S' in valor) return valor.S;
  if ('N' in valor) return Number(valor.N);
  if ('BOOL' in valor) return valor.BOOL;
  if ('NULL' in valor) return null;
  if ('M' in valor) return Object.fromEntries(Object.entries(valor.M).map(([k, v]) => [k, desserializar(v)]));
  if ('L' in valor) return valor.L.map(desserializar);
  throw new Error(`Tipo DynamoDB não suportado: ${JSON.stringify(valor)}`);
}

/** Carrega o itens.json (uma linha por item, formato DynamoDB JSON do Import from S3). */
export async function carregarItensJson(tabela: TabelaMemoria, caminho: string): Promise<TabelaMemoria> {
  const linhas = createInterface({ input: createReadStream(caminho, 'utf8'), crlfDelay: Infinity });
  let lote: Operacao[] = [];
  for await (const linha of linhas) {
    if (!linha.trim()) continue;
    const { Item } = JSON.parse(linha) as { Item: Record<string, ValorDynamo> };
    lote.push({ put: Object.fromEntries(Object.entries(Item).map(([k, v]) => [k, desserializar(v)])) });
    if (lote.length === 1000) {
      await tabela.gravar(lote);
      lote = [];
    }
  }
  if (lote.length) await tabela.gravar(lote);
  return tabela;
}
