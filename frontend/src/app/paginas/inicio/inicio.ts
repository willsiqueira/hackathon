import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AutenticacaoService } from '../../core/autenticacao.service';
import { AvisosService } from '../../core/avisos.service';
import { CatalogoService } from '../../core/catalogo.service';
import { mensagemDeErro } from '../../core/interceptadores';
import type { Contadores, Criterios, FiltroSalvo, Inicio, ResumoDiaIa, Widget } from '../../core/modelos';
import { SeloGerenciador, SeloPrazo, SeloPrioridade } from '../../compartilhado/selos';
import { dataBr, dataHoraBr, dataPorExtenso } from '../../compartilhado/formatos';
import { AVISO_PRIVACIDADE_RESUMO, mensagemFalhaIa, rotuloOrigemIa } from '../../compartilhado/ia';

interface Atalho {
  chave: keyof Contadores;
  rotulo: string;
  caixa?: string;
  criterios?: Criterios;
  destaque?: boolean;
}

/** Cada contador abre o painel com o filtro correspondente (RF18). */
export const ATALHOS: Atalho[] = [
  { chave: 'vencidos', rotulo: 'Vencidos', criterios: { statusPrazo: ['VENCIDO'], requerAcao: true }, destaque: true },
  { chave: 'venceHoje', rotulo: 'Vencem hoje', criterios: { statusPrazo: ['VENCE_HOJE'], requerAcao: true }, destaque: true },
  { chave: 'criticos', rotulo: 'Até 3 dias', criterios: { statusPrazo: ['CRITICO'], requerAcao: true } },
  { chave: 'urgentes', rotulo: 'Urgentes', criterios: { urgente: true, requerAcao: true } },
  { chave: 'aReceber', rotulo: 'A receber', caixa: 'A_RECEBER' },
  { chave: 'noSetor', rotulo: 'No setor', caixa: 'NO_SETOR' },
  { chave: 'enviadosNaoRecebidos', rotulo: 'Enviados não recebidos', caixa: 'ENVIADO_NAO_RECEBIDO' },
  { chave: 'designadosAMim', rotulo: 'Designados a mim', criterios: { idResponsavel: '$USUARIO', tipoResponsabilidade: 'DESIGNADO' } },
  { chave: 'novos24h', rotulo: 'Novos em 24h', criterios: { novo: true } },
];

export const NOMES_WIDGET: Record<Widget['id'], string> = {
  contadores: 'Contadores', resumoIa: 'Resumo do dia (IA)', proximo: 'Próximo processo', prazos: 'Próximos prazos',
  alertas: 'Alertas não lidos', informes: 'Informes', filtros: 'Filtros salvos',
};

@Component({
  selector: 'app-inicio',
  imports: [RouterLink, SeloPrazo, SeloPrioridade, SeloGerenciador],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inicio.html',
})
export class InicioPagina implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly avisos = inject(AvisosService);
  protected readonly catalogo = inject(CatalogoService);
  protected readonly me = inject(AutenticacaoService).me;

  protected readonly dados = signal<Inicio | null>(null);
  protected readonly filtros = signal<FiltroSalvo[]>([]);
  protected readonly widgets = signal<Widget[]>([]);
  protected readonly personalizando = signal(false);
  protected readonly gerenciadorContadores = signal('TODOS');
  protected readonly atalhos = ATALHOS;
  protected readonly nomesWidget = NOMES_WIDGET;
  protected readonly dataBr = dataBr;
  protected readonly dataHoraBr = dataHoraBr;

  // Resumo do dia com IA: só gera quando o usuário pede (nada de IA vem em /api/inicio).
  protected readonly resumoIa = signal<ResumoDiaIa | null>(null);
  protected readonly gerandoResumo = signal(false);
  protected readonly erroResumo = signal('');
  protected readonly avisoResumo = AVISO_PRIVACIDADE_RESUMO;
  protected readonly rotuloOrigemIa = rotuloOrigemIa;

  protected readonly visiveis = computed(() => this.widgets().filter((w) => w.visivel).map((w) => w.id));
  protected readonly contadores = computed(() => this.dados()?.contadores[this.gerenciadorContadores()] ?? null);
  protected readonly abasContadores = computed(() => ['TODOS', ...(this.me()?.setor.gerenciadores ?? [])]);
  protected readonly hoje = computed(() => (this.dados() ? dataPorExtenso(this.dados()!.dataReferencia) : ''));
  protected readonly resumoDoDia = computed(() => {
    const c = this.dados()?.contadores['TODOS'];
    if (!c) return '';
    return `${c.vencidos} vencidos, ${c.venceHoje} vencem hoje e ${c.aReceber} a receber`;
  });

  async ngOnInit(): Promise<void> {
    try {
      const [dados, filtros] = await Promise.all([this.api.inicio(), this.api.filtros()]);
      this.dados.set(dados);
      this.widgets.set(dados.widgets);
      this.filtros.set([...filtros.meus, ...filtros.compartilhados].slice(0, 8));
      if (this.me()?.setor.gerenciadores.includes('JUDICIAL') && this.me()?.setor.tipoSetor === 'GABINETE') this.gerenciadorContadores.set('JUDICIAL');
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    }
  }

  protected abrir(atalho: Atalho): void {
    const gerenciador = this.gerenciadorContadores();
    void this.router.navigate(['/painel'], {
      queryParams: {
        gerenciador: gerenciador === 'TODOS' ? null : gerenciador,
        caixa: atalho.caixa ?? null,
        criterios: atalho.criterios ? JSON.stringify(atalho.criterios) : null,
      },
    });
  }

  protected async gerarResumo(): Promise<void> {
    if (this.gerandoResumo()) return;
    this.gerandoResumo.set(true);
    this.erroResumo.set('');
    try {
      this.resumoIa.set(await this.api.resumoDiaIa());
      setTimeout(() => document.getElementById('texto-resumo-ia')?.focus(), 0);
    } catch (e) {
      this.erroResumo.set(mensagemFalhaIa(e));
    } finally {
      this.gerandoResumo.set(false);
    }
  }

  protected abrirFiltro(filtro: FiltroSalvo): void {
    void this.router.navigate(['/painel'], { queryParams: { filtro: filtro.idFiltro } });
  }

  protected rotuloAba(codigo: string): string {
    return codigo === 'TODOS' ? 'Todos' : this.catalogo.descricao('GERENCIADOR', codigo);
  }

  // ---------- personalização (RF19) ----------

  protected alternar(id: Widget['id']): void {
    this.widgets.update((lista) => lista.map((w) => (w.id === id ? { ...w, visivel: !w.visivel } : w)));
  }

  protected mover(indice: number, direcao: -1 | 1): void {
    const lista = [...this.widgets()];
    const alvo = indice + direcao;
    if (alvo < 0 || alvo >= lista.length) return;
    [lista[indice], lista[alvo]] = [lista[alvo], lista[indice]];
    this.widgets.set(lista);
    this.avisos.informar(`${NOMES_WIDGET[lista[alvo].id]} agora na posição ${alvo + 1} de ${lista.length}.`);
    queueMicrotask(() => document.getElementById(`mover-${lista[alvo].id}-${direcao < 0 ? 'cima' : 'baixo'}`)?.focus());
  }

  protected async salvarWidgets(): Promise<void> {
    try {
      const pref = await this.api.salvarPreferencias('INICIO', { widgets: this.widgets() });
      this.widgets.set(pref.widgets ?? this.widgets());
      this.personalizando.set(false);
      this.avisos.informar('Tela inicial salva.');
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    }
  }

  protected cancelarPersonalizacao(): void {
    this.widgets.set(this.dados()?.widgets ?? []);
    this.personalizando.set(false);
  }
}
