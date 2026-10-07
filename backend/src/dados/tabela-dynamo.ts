// Tabela DynamoDB com a mesma interface da TabelaMemoria.
// Consultas sempre por chave (Query com begins_with, parametrizada); nunca Scan.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { ATRIBUTOS_INDICE, type Consulta, type Operacao, type Tabela } from './tabela.js';
import type { Entidade } from '../dominio/tipos.js';

const LIMITE_TRANSACAO = 100;
const LIMITE_BATCH = 25;

export class TabelaDynamo implements Tabela {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly nome: string,
    cliente = new DynamoDBClient({}),
  ) {
    this.doc = DynamoDBDocumentClient.from(cliente, { marshallOptions: { removeUndefinedValues: true } });
  }

  async obter(pk: string, sk: string): Promise<Entidade | null> {
    const { Item } = await this.doc.send(new GetCommand({ TableName: this.nome, Key: { PK: pk, SK: sk } }));
    return (Item as Entidade | undefined) ?? null;
  }

  async consultar({ indice, pk, prefixo = '', decrescente = false, limite }: Consulta): Promise<Entidade[]> {
    const [atributoPk, atributoSk] = indice ? ATRIBUTOS_INDICE[indice] : ['PK', 'SK'];
    const itens: Entidade[] = [];
    let inicio: Record<string, unknown> | undefined;
    do {
      const resposta: QueryCommandOutput = await this.doc.send(new QueryCommand({
        TableName: this.nome,
        IndexName: indice,
        KeyConditionExpression: prefixo ? '#pk = :pk AND begins_with(#sk, :prefixo)' : '#pk = :pk',
        ExpressionAttributeNames: prefixo ? { '#pk': atributoPk, '#sk': atributoSk } : { '#pk': atributoPk },
        ExpressionAttributeValues: prefixo ? { ':pk': pk, ':prefixo': prefixo } : { ':pk': pk },
        ScanIndexForward: !decrescente,
        ExclusiveStartKey: inicio,
        Limit: limite ? Math.min(limite - itens.length, 1000) : undefined,
      }));
      itens.push(...((resposta.Items ?? []) as Entidade[]));
      inicio = resposta.LastEvaluatedKey;
    } while (inicio && (!limite || itens.length < limite));
    return itens;
  }

  /** Até 100 operações: transação (tudo ou nada). Acima disso: BatchWrite em blocos de 25, com novas tentativas. */
  async gravar(operacoes: Operacao[]): Promise<void> {
    if (!operacoes.length) return;
    if (operacoes.length <= LIMITE_TRANSACAO) {
      await this.doc.send(new TransactWriteCommand({
        TransactItems: operacoes.map((op) => ('put' in op
          ? { Put: { TableName: this.nome, Item: op.put } }
          : { Delete: { TableName: this.nome, Key: { PK: op.delete.PK, SK: op.delete.SK } } })),
      }));
      return;
    }
    for (let i = 0; i < operacoes.length; i += LIMITE_BATCH) {
      let pedidos = operacoes.slice(i, i + LIMITE_BATCH).map((op) => ('put' in op
        ? { PutRequest: { Item: op.put } }
        : { DeleteRequest: { Key: { PK: op.delete.PK, SK: op.delete.SK } } }));
      for (let tentativa = 0; pedidos.length && tentativa < 5; tentativa += 1) {
        const resposta = await this.doc.send(new BatchWriteCommand({ RequestItems: { [this.nome]: pedidos } }));
        pedidos = (resposta.UnprocessedItems?.[this.nome] ?? []) as typeof pedidos;
        if (pedidos.length) await new Promise((r) => setTimeout(r, 100 * 2 ** tentativa));
      }
      if (pedidos.length) throw new Error('Não foi possível gravar todos os itens no DynamoDB.');
    }
  }
}
