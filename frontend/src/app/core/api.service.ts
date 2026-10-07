import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  Carga, Catalogos, Criterios, DetalheExpediente, Expediente, FiltroSalvo, Indicadores, Inicio, Marcador, Me, Notificacao,
  ParametrosLote, PessoaSetor, Preferencias, PreviaLote, RegistroLote, RespostaBuscaIa, RespostaPainel, ResultadoLote, ResumoDiaIa,
  ResumoDiario, TipoAcao,
} from './modelos';

export interface ConsultaPainel {
  gerenciador?: string;
  caixa?: string;
  q?: string;
  criterios?: Criterios;
  ordenacao?: string;
  pagina?: number;
  tamanho?: number;
}

function parametros(consulta: object): HttpParams {
  let p = new HttpParams();
  for (const [chave, valor] of Object.entries(consulta)) {
    if (valor === undefined || valor === null || valor === '') continue;
    if (chave === 'criterios') {
      if (Object.keys(valor).length) p = p.set(chave, JSON.stringify(valor));
    } else p = p.set(chave, String(valor));
  }
  return p;
}

/** Cliente da API. Todas as rotas exigem o token (interceptor). */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  private get<T>(caminho: string, consulta: object = {}): Promise<T> {
    return firstValueFrom(this.http.get<T>(`/api/${caminho}`, { params: parametros(consulta) }));
  }

  private enviar<T>(metodo: 'POST' | 'PUT' | 'DELETE', caminho: string, corpo?: unknown): Promise<T> {
    return firstValueFrom(this.http.request<T>(metodo, `/api/${caminho}`, { body: corpo }));
  }

  /** Baixa um arquivo autenticado (CSV, ICS) e entrega ao navegador. */
  async baixar(caminho: string, consulta: object, nomeArquivo: string): Promise<void> {
    const blob = await firstValueFrom(this.http.get(`/api/${caminho}`, { params: parametros(consulta), responseType: 'blob' }));
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivo;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  me = () => this.get<Me>('me');
  inicio = () => this.get<Inicio>('inicio');
  catalogos = () => this.get<Catalogos>('catalogos');
  usuarios = () => this.get<PessoaSetor[]>('usuarios');
  marcadores = () => this.get<Marcador[]>('marcadores');
  resumoDiario = () => this.get<ResumoDiario>('resumo-diario');

  painel = (consulta: ConsultaPainel) => this.get<RespostaPainel>('expedientes', consulta);
  detalhe = (id: string) => this.get<DetalheExpediente>(`expedientes/${encodeURIComponent(id)}`);
  fila = (consulta: { gerenciador?: string; meus?: boolean }) => this.get<{ total: number; itens: Expediente[] }>('fila', consulta);

  previaLote = (tipoAcao: TipoAcao, ids: string[], parametrosLote: ParametrosLote) =>
    this.enviar<PreviaLote>('POST', 'lotes/previa', { tipoAcao, ids, parametros: parametrosLote });
  executarLote = (tipoAcao: TipoAcao, ids: string[], parametrosLote: ParametrosLote) =>
    this.enviar<ResultadoLote>('POST', 'lotes', { tipoAcao, ids, parametros: parametrosLote });
  desfazerLote = (idLote: string) =>
    this.enviar<{ restaurados: { idExpediente: string; etiqueta?: string }[]; naoRestaurados: { idExpediente: string; etiqueta?: string; motivo: string }[] }>(
      'POST', `lotes/${encodeURIComponent(idLote)}/desfazer`);
  lotes = () => this.get<{ meus: RegistroLote[]; setor: RegistroLote[] }>('lotes');
  sugestao = (ids: string[] = []) =>
    this.get<{ cargas: Carga[]; sugerido: Carga | null; distribuicao: Record<string, string> }>('designacao/sugestao', { ids: ids.join(',') });

  filtros = () => this.get<{ meus: FiltroSalvo[]; compartilhados: FiltroSalvo[] }>('filtros');
  criarFiltro = (filtro: Omit<FiltroSalvo, 'idFiltro' | 'idUsuario'>) => this.enviar<FiltroSalvo>('POST', 'filtros', filtro);
  excluirFiltro = (id: string) => this.enviar<void>('DELETE', `filtros/${encodeURIComponent(id)}`);

  preferencias = (contexto: string) => this.get<Preferencias>(`preferencias/${contexto}`);
  salvarPreferencias = (contexto: string, pref: Partial<Preferencias>) => this.enviar<Preferencias>('PUT', `preferencias/${contexto}`, pref);

  notificacoes = (consulta: { lida?: string; severidade?: string; pagina?: number; tamanho?: number }) =>
    this.get<{ total: number; naoLidas: number; itens: Notificacao[] }>('notificacoes', consulta);
  marcarLidas = (corpo: { ids: string[]; lida?: boolean } | { todas: true }) =>
    this.enviar<{ atualizadas: number }>('POST', 'notificacoes/lidas', corpo);

  indicadores = (consulta: { gerenciador?: string; dias?: number }) => this.get<Indicadores>('indicadores', consulta);

  /** Texto livre → critérios do painel, para revisão antes de aplicar (Bedrock; nada de expediente vai ao modelo). */
  buscaIa = (texto: string) => this.enviar<RespostaBuscaIa>('POST', 'ia/busca', { texto });
  /** Resumo do dia gerado sob demanda, só com dados minimizados. */
  resumoDiaIa = () => this.enviar<ResumoDiaIa>('POST', 'ia/resumo-dia', {});
}
