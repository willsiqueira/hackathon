// Lambda acionada pela regra do EventBridge: transforma eventos de domínio em notificações (RF15).

import type { EventBridgeEvent } from 'aws-lambda';
import { Repositorio } from '../dados/repositorio.js';
import { TabelaDynamo } from '../dados/tabela-dynamo.js';
import { processarEventos } from '../eventos/notificador.js';
import type { EventoDominio } from '../eventos/eventos.js';
import { variavelObrigatoria } from '../config.js';

const repo = new Repositorio(new TabelaDynamo(variavelObrigatoria('TABELA')));

export async function handler(evento: EventBridgeEvent<string, EventoDominio>): Promise<{ notificacoes: number }> {
  const notificacoes = await processarEventos(repo, [evento.detail]);
  console.log(JSON.stringify({ nivel: 'INFO', evento: evento['detail-type'], notificacoes }));
  return { notificacoes };
}
