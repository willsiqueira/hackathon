// Tipos das entidades, com os mesmos nomes de campo da base sintética (docs/hackathon-expedientes/seed/saida).

export type Gerenciador = 'JUDICIAL' | 'DOCUMENTO' | 'EXTRAJUDICIAL';
export type Caixa = 'A_RECEBER' | 'NO_SETOR' | 'ENVIADO_NAO_RECEBIDO' | 'BAIXADO';
export type StatusPrazo =
  | 'VENCIDO' | 'VENCE_HOJE' | 'CRITICO' | 'ATENCAO' | 'NO_PRAZO' | 'CUMPRIDO' | 'CUMPRIDO_COM_ATRASO';
export type Prioridade = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA';
export type Perfil = 'MEMBRO' | 'CHEFE' | 'SERVIDOR';

/** Item genérico da tabela (atributos livres). */
export type Entidade = Record<string, any>;

export interface Usuario extends Entidade {
  idUsuario: string;
  nome: string;
  siglaSetor: string;
  perfil: Perfil;
  cargo?: string;
  email?: string;
  ativo?: boolean;
}

export interface Setor extends Entidade {
  siglaSetor: string;
  nome: string;
  gerenciadores: string;
}

export interface Expediente extends Entidade {
  idExpediente: string;
  gerenciador: Gerenciador;
  siglaSetor: string;
  caixa: Caixa;
  situacao: string;
  etiqueta: string;
  dataPrazo?: string;
  dataChegada?: string;
  dataUltimaMovimentacao?: string;
  diasRestantes?: number;
  statusPrazo?: StatusPrazo;
  pontuacaoPrioridade?: number;
  prioridade?: Prioridade;
  tempoParadoDias?: number;
  diasNoSetor?: number;
  novo?: boolean;
  urgente?: boolean;
  novaIntimacao?: boolean;
  requerAcao?: boolean;
  idResponsavel?: string;
  nomeResponsavel?: string;
  tipoResponsabilidade?: 'TITULAR' | 'DESIGNADO';
  nivelSigilo?: number;
  sigiloso?: boolean;
  qtdMinutasPendentes?: number;
  marcadores?: string;
  risco?: number | null;
  conteudoRestrito?: boolean;
  versao?: number;
}

export interface Parcela {
  motivo: string;
  pontos: number;
}
