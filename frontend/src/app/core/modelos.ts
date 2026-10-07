// Tipos das respostas da API (mesmos nomes de campo da base sintética).

export type Gerenciador = 'JUDICIAL' | 'DOCUMENTO' | 'EXTRAJUDICIAL';
export type Caixa = 'A_RECEBER' | 'NO_SETOR' | 'ENVIADO_NAO_RECEBIDO' | 'BAIXADO';
export type StatusPrazo = 'VENCIDO' | 'VENCE_HOJE' | 'CRITICO' | 'ATENCAO' | 'NO_PRAZO' | 'CUMPRIDO' | 'CUMPRIDO_COM_ATRASO';
export type Prioridade = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA';
export type Perfil = 'MEMBRO' | 'CHEFE' | 'SERVIDOR';
export type TipoAcao = 'RECEBER' | 'DESIGNAR' | 'INCLUIR_MARCADOR' | 'DAR_CIENCIA' | 'ASSINAR' | 'MOVIMENTAR' | 'ARQUIVAR';

export interface Usuario {
  idUsuario: string;
  nome: string;
  perfil: Perfil;
  cargo?: string;
  siglaSetor: string;
}

export interface Me {
  usuario: Usuario;
  setor: { siglaSetor: string; nome: string; tipoSetor: string; oficio: string; gerenciadores: Gerenciador[] };
  dataReferencia: string;
}

export interface Expediente {
  idExpediente: string;
  gerenciador: Gerenciador;
  siglaSetor: string;
  caixa: Caixa;
  situacao: string;
  acaoPendente?: string;
  etiqueta: string;
  numeroReferencia?: string;
  classe?: string;
  descricaoClasse?: string;
  tema?: string;
  assunto?: string;
  resumo?: string;
  orgaoOrigem?: string;
  tipoEntrada?: string;
  setorOrigem?: string;
  setorDestino?: string;
  dataAutuacao?: string;
  dataChegada?: string;
  dataRecebimento?: string;
  dataUltimaMovimentacao?: string;
  diasNoSetor?: number;
  tempoParadoDias?: number;
  tipoPrazo?: string;
  dataPrazo?: string;
  diasRestantes?: number;
  statusPrazo?: StatusPrazo;
  prioridade?: Prioridade;
  pontuacaoPrioridade?: number;
  urgente?: boolean;
  motivoUrgencia?: string;
  reuPreso?: boolean;
  idoso?: boolean;
  novaIntimacao?: boolean;
  novo?: boolean;
  idResponsavel?: string;
  nomeResponsavel?: string;
  tipoResponsabilidade?: 'TITULAR' | 'DESIGNADO';
  nivelSigilo?: number;
  sigiloso?: boolean;
  favorito?: boolean;
  marcadores?: string;
  qtdAnotacoes?: number;
  qtdMinutasPendentes?: number;
  risco?: number | null;
  conteudoRestrito?: boolean;
}

export interface Pagina<T> {
  total: number;
  pagina: number;
  tamanho: number;
  itens: T[];
}

export interface RespostaPainel extends Pagina<Expediente> {
  contadoresCaixa: Record<'A_RECEBER' | 'NO_SETOR' | 'ENVIADO_NAO_RECEBIDO', number>;
}

export interface Parcela {
  motivo: string;
  pontos: number;
}

export interface Movimentacao {
  idMovimentacao: string;
  dataHora: string;
  tipoMovimentacao: string;
  nomeUsuario: string;
  setorOrigem: string;
  setorDestino: string;
  descricao: string;
}

export interface DetalheExpediente {
  expediente: Expediente;
  composicaoPrioridade: { parcelas: Parcela[]; total: number };
  movimentacoes: Movimentacao[];
  prazos: { idPrazo: string; tipoPrazo: string; dataInicio: string; dataPrazo: string; duracaoDias: number; situacao: string; dataEncerramento?: string; diasAtraso: number }[];
  designacoes: { idDesignacao: string; nomeDesignado: string; nomeDesignador: string; dataDesignacao: string; prazoDevolucao: string; situacao: string; statusDevolucao: string; dataFim?: string }[];
  anotacoes: { idAnotacao: string; nomeUsuario: string; dataHora: string; texto: string }[];
  marcadores: { idRotulo: string; descricao: string; cor: string }[];
}

export interface Contadores {
  aReceber: number;
  noSetor: number;
  enviadosNaoRecebidos: number;
  vencidos: number;
  venceHoje: number;
  criticos: number;
  atencao: number;
  urgentes: number;
  prioridadeCritica: number;
  novos24h: number;
  parados30dias: number;
  designados: number;
  designadosAMim: number;
}

export interface Notificacao {
  idNotificacao: string;
  idExpediente: string;
  etiqueta: string;
  gerenciador: Gerenciador;
  tipoNotificacao: string;
  severidade: 'CRITICO' | 'ATENCAO' | 'INFO';
  titulo: string;
  mensagem: string;
  dataHora: string;
  lida: boolean;
}

export interface Informe {
  idNoticia: number;
  titulo: string;
  categoria: string;
  conteudo: string;
  destaque: boolean;
}

export interface Widget {
  id: 'contadores' | 'proximo' | 'prazos' | 'alertas' | 'informes' | 'filtros';
  visivel: boolean;
}

export interface Inicio {
  dataReferencia: string;
  contadores: Record<string, Contadores>;
  proximoExpediente: Expediente | null;
  proximosPrazos: Expediente[];
  vencidos: Expediente[];
  alertas: { naoLidas: number; itens: Notificacao[] };
  informes: Informe[];
  widgets: Widget[];
}

export interface ItemCatalogo {
  codigo: string;
  descricao: string;
  ordem: number;
  cor: string;
}

export type Catalogos = Record<string, ItemCatalogo[]>;

export interface PessoaSetor {
  idUsuario: string;
  nome: string;
  perfil: Perfil;
  cargo?: string;
  ativo?: boolean;
}

export interface Marcador {
  idRotulo: string;
  gerenciador: Gerenciador;
  descricao: string;
  cor: string;
}

export type Criterios = Record<string, string | number | boolean | (string | number | boolean)[]>;

export interface FiltroSalvo {
  idFiltro: string;
  idUsuario: string;
  nome: string;
  criterios: Criterios;
  ordenacao: string;
  padrao: boolean;
  compartilhadoComSetor: boolean;
  nomeAutor?: string;
}

export interface ParametrosLote {
  idUsuarioDesignado?: string;
  distribuir?: boolean;
  prazoDevolucao?: string;
  idRotulo?: string;
  setorDestino?: string;
  motivo?: string;
}

export interface ItemLote {
  idExpediente: string;
  etiqueta?: string;
  gerenciador?: Gerenciador;
  caixa?: Caixa;
  mudanca?: string;
  motivo?: string;
}

export interface PreviaLote {
  tipoAcao: TipoAcao;
  aplicaveis: ItemLote[];
  ignorados: ItemLote[];
}

export interface ResultadoLote {
  idLote: string;
  tipoAcao: TipoAcao;
  aplicados: ItemLote[];
  ignorados: ItemLote[];
  resultado: 'SUCESSO' | 'PARCIAL';
}

export interface RegistroLote {
  idLote: string;
  nomeUsuario: string;
  idUsuario: string;
  tipoAcao: TipoAcao;
  parametros: string;
  dataHora: string;
  qtdExpedientes: number;
  qtdSucesso: number;
  qtdFalhas: number;
  resultado: string;
  desfeito?: boolean;
}

export interface Carga {
  idUsuario: string;
  nome: string;
  designacoesAtivas: number;
  devolucoesVencidas: number;
  acoes30dias: number;
  carga: number;
  capacidade: number;
  indice: number;
}

export interface Preferencias {
  contexto: string;
  colunasVisiveis?: string[];
  ordenacao?: string;
  itensPorPagina?: number;
  densidade?: 'CONFORTAVEL' | 'COMPACTA';
  widgets?: Widget[];
}

export interface Indicadores {
  periodo: { dias: number; desde: string; ate: string; gerenciador: string };
  kpis: Record<string, number | null>;
  serie: { data: string; entradas: number; saidas: number; aReceber: number; noSetor: number; vencidos: number; recebimentos: number }[];
  prazosPorSituacao: { chave: string; quantidade: number }[];
  pendenciasPorAssunto: { chave: string; quantidade: number }[];
  produtividade: ({ idUsuario: string; nome: string } & Record<string, number | string>)[] | null;
}

export interface ResumoDiario {
  assunto: string;
  texto: string;
  vencidos: number;
  vencemHoje: number;
  novos24h: number;
  devolucoesVencidas: number;
}
