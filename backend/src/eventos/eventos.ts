// Eventos de domínio publicados pela API e consumidos de forma desacoplada (EventBridge na AWS).
// Os eventos levam só identificadores e metadados: nunca assunto, resumo ou outro conteúdo de expediente.

export const ORIGEM_EVENTOS = 'lex-gabinete.expedientes';

export interface ExpedienteDesignado {
  tipo: 'ExpedienteDesignado';
  idDesignacao: string;
  idExpediente: string;
  etiqueta: string;
  gerenciador: string;
  siglaSetor: string;
  idUsuarioDesignado: string;
  idUsuarioDesignador: string;
  nomeDesignador: string;
  prazoDevolucao: string;
  dataHora: string;
}

export interface LoteExecutado {
  tipo: 'LoteExecutado';
  idLote: string;
  siglaSetor: string;
  idUsuario: string;
  tipoAcao: string;
  qtdSucesso: number;
  qtdFalhas: number;
  dataHora: string;
}

export type EventoDominio = ExpedienteDesignado | LoteExecutado;

export interface PublicadorEventos {
  publicar(eventos: EventoDominio[]): Promise<void>;
}

/** Publicador que descarta (para quem não precisa de eventos). */
export const publicadorNulo: PublicadorEventos = { publicar: async () => {} };
