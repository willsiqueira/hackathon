import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AutenticacaoService } from '../core/autenticacao.service';
import { AvisosService } from '../core/avisos.service';
import { CatalogoService } from '../core/catalogo.service';
import { ApiService } from '../core/api.service';

const PERFIL: Record<string, string> = { MEMBRO: 'Membro', CHEFE: 'Chefe de gabinete', SERVIDOR: 'Servidor' };

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="pular-conteudo" href="#conteudo" (click)="irParaConteudo($event)">Pular para o conteúdo</a>

    <header class="barra-topo">
      <div class="container-fluid d-flex flex-wrap align-items-center gap-3 py-2 px-3">
        <span class="marca fs-6">ÚNICO</span>
        <span class="setor ps-3 small">{{ me()?.setor?.siglaSetor }} · Painel do gabinete</span>
        <div class="ms-auto d-flex align-items-center gap-3">
          <a routerLink="/alertas" class="text-decoration-none position-relative">
            Alertas
            @if (naoLidas() > 0) {
              <span class="badge rounded-pill text-bg-warning ms-1">{{ naoLidas() }}<span class="visually-hidden"> não lidos</span></span>
            }
          </a>
          <div class="text-end lh-sm d-none d-sm-block">
            <div class="fw-semibold small">{{ me()?.usuario?.nome }}</div>
            <div class="small setor-perfil">{{ perfil() }} · {{ me()?.usuario?.siglaSetor }}</div>
          </div>
          <button type="button" class="btn btn-sm btn-outline-light" (click)="sair()">Sair</button>
        </div>
      </div>
    </header>

    <nav class="menu-principal" aria-label="Seções do painel">
      <div class="container-fluid px-3">
        <ul class="nav flex-nowrap overflow-auto">
          @for (item of menu; track item.rota) {
            <li class="nav-item">
              <a class="nav-link px-3 py-2" [routerLink]="item.rota" routerLinkActive="active" ariaCurrentWhenActive="page">{{ item.texto }}</a>
            </li>
          }
        </ul>
      </div>
    </nav>

    <div class="visually-hidden" aria-live="polite" aria-atomic="true">{{ avisos.status() }}</div>
    <main id="conteudo" tabindex="-1" class="container-fluid px-3 px-lg-4 py-3">
      @if (avisos.erro()) {
        <div class="alert alert-danger d-flex align-items-start gap-2" role="alert">
          <span class="flex-grow-1">{{ avisos.erro() }}</span>
          <button type="button" class="btn-close" aria-label="Fechar mensagem de erro" (click)="avisos.limparErro()"></button>
        </div>
      }
      <router-outlet />
    </main>
    <footer class="container-fluid px-3 pb-3 small text-secondary">
      Protótipo do Hackathon MPF &amp; AWS 2026 · dados 100% fictícios · referência {{ me()?.dataReferencia?.slice(0, 10)?.split('-')?.reverse()?.join('/') }}
    </footer>
  `,
  styles: [`.setor-perfil { color: #dbe3f5; }`],
})
export class Layout {
  private readonly auth = inject(AutenticacaoService);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  protected readonly avisos = inject(AvisosService);
  protected readonly me = this.auth.me;
  protected readonly perfil = computed(() => PERFIL[this.me()?.usuario.perfil ?? ''] ?? '');
  protected readonly naoLidas = signal(0);

  protected readonly menu = [
    { rota: '/inicio', texto: 'Início' },
    { rota: '/painel', texto: 'Expedientes' },
    { rota: '/foco', texto: 'Próximo processo' },
    { rota: '/alertas', texto: 'Alertas' },
    { rota: '/indicadores', texto: 'Indicadores' },
    { rota: '/lotes', texto: 'Lotes' },
  ];

  constructor() {
    void inject(CatalogoService).carregar();
    void this.atualizarAlertas();
    // A cada navegação: limpa o erro anterior, atualiza o contador e leva o foco ao conteúdo.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.avisos.limparErro();
      void this.atualizarAlertas();
      queueMicrotask(() => document.getElementById('conteudo')?.focus({ preventScroll: true }));
    });
    effect(() => {
      if (!this.auth.autenticado()) void this.router.navigate(['/entrar']);
    });
  }

  private async atualizarAlertas(): Promise<void> {
    if (!this.auth.token()) return;
    try {
      this.naoLidas.set((await this.api.notificacoes({ lida: 'false', tamanho: 1 })).naoLidas);
    } catch {
      // contador é secundário
    }
  }

  protected irParaConteudo(evento: Event): void {
    evento.preventDefault();
    document.getElementById('conteudo')?.focus();
  }

  protected sair(): void {
    this.auth.sair();
  }
}
