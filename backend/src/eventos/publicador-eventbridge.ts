// Publica eventos de domínio num barramento do EventBridge (até 10 por chamada).

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ORIGEM_EVENTOS, type EventoDominio, type PublicadorEventos } from './eventos.js';

export class PublicadorEventBridge implements PublicadorEventos {
  constructor(
    private readonly barramento: string,
    private readonly cliente = new EventBridgeClient({}),
  ) {}

  async publicar(eventos: EventoDominio[]): Promise<void> {
    for (let i = 0; i < eventos.length; i += 10) {
      const bloco = eventos.slice(i, i + 10);
      const resposta = await this.cliente.send(new PutEventsCommand({
        Entries: bloco.map((evento) => ({
          EventBusName: this.barramento,
          Source: ORIGEM_EVENTOS,
          DetailType: evento.tipo,
          Detail: JSON.stringify(evento),
        })),
      }));
      if (resposta.FailedEntryCount) {
        // A gravação principal já ocorreu; a falha fica registrada sem dados do expediente.
        console.error(JSON.stringify({ nivel: 'ERRO', mensagem: 'Falha ao publicar eventos', falhas: resposta.FailedEntryCount }));
      }
    }
  }
}
