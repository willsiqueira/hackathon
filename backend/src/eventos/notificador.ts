// Consumidor dos eventos de domínio: gera as notificações (RF15) fora do caminho da requisição.
// Idempotente: o id da notificação deriva do evento, então reentregas sobrescrevem o mesmo item.

import type { Repositorio } from '../dados/repositorio.js';
import type { Entidade } from '../dominio/tipos.js';
import type { EventoDominio } from './eventos.js';

export function notificacoesDoEvento(evento: EventoDominio): Entidade[] {
  switch (evento.tipo) {
    case 'ExpedienteDesignado':
      if (evento.idUsuarioDesignado === evento.idUsuarioDesignador) return [];
      return [{
        entidade: 'notificacoes',
        idNotificacao: `NOT-${evento.idDesignacao}`,
        idUsuario: evento.idUsuarioDesignado,
        siglaSetor: evento.siglaSetor,
        idExpediente: evento.idExpediente,
        etiqueta: evento.etiqueta,
        gerenciador: evento.gerenciador,
        tipoNotificacao: 'DESIGNACAO',
        severidade: 'INFO',
        titulo: 'Expediente designado a você',
        mensagem: `${evento.nomeDesignador} designou ${evento.etiqueta} a você, com devolução até ${evento.prazoDevolucao}.`,
        dataHora: evento.dataHora,
        lida: false,
        link: `/expedientes/${evento.idExpediente}`,
      }];
    case 'LoteExecutado':
      return [];
    default:
      return [];
  }
}

export async function processarEventos(repo: Repositorio, eventos: EventoDominio[]): Promise<number> {
  const notificacoes = eventos.flatMap(notificacoesDoEvento);
  if (notificacoes.length) await repo.salvar(notificacoes);
  return notificacoes.length;
}

/** Publicador do modo local e dos testes: entrega os eventos ao notificador no mesmo processo. */
export function publicadorEmProcesso(repo: Repositorio) {
  return {
    async publicar(eventos: EventoDominio[]): Promise<void> {
      await processarEventos(repo, eventos);
    },
  };
}
