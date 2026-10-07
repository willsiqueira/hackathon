import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AutenticacaoService, type UsuarioDemo } from '../../core/autenticacao.service';
import { iniciais, PERFIS_DEMO, perfilPorEmail, perfilPorId, type PerfilDemo } from './perfis-demo';

const PERFIL: Record<string, string> = { MEMBRO: 'Membro', CHEFE: 'Chefe de gabinete', SERVIDOR: 'Servidor' };
const PERFIL_PADRAO = 'GABSUB3-DVT-U02';

@Component({
  selector: 'app-entrar',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .entrar { background: #ebe9e2; }
    .moldura { max-width: 64rem; background: #fff; border: 1px solid #e3e1da; border-radius: .75rem; overflow: hidden; }
    .marca-painel { background: #1b3470; color: #fff; }
    .marca { color: #dbe3f5; letter-spacing: .14em; font-weight: 700; font-size: .8rem; }
    .chamada { color: #dbe3f5; }
    .vantagens { list-style: none; padding: 0; }
    .vantagens li { display: flex; gap: .6rem; align-items: baseline; margin-bottom: .6rem; }
    .vantagens li::before { content: ''; flex: none; width: .55rem; height: .55rem; border-radius: 50%; background: #f9a825; transform: translateY(-.05rem); }
    .selo-sintetico { display: inline-block; background: #2b4a8f; color: #fff; border-radius: 999px; padding: .3rem .8rem; font-size: .8rem; }
    fieldset legend { font-size: 1rem; font-weight: 600; }
    .cartao-perfil {
      display: flex; flex-direction: column; align-items: center; text-align: center; height: 100%;
      background: #fff; border: 2px solid #d9d6cd; border-radius: .5rem; padding: .85rem .5rem; cursor: pointer; color: #15171c;
    }
    .cartao-perfil:hover { border-color: #5a73ad; }
    .btn-check:checked + .cartao-perfil { border-color: #1b3470; border-width: 3px; background: #e8edf8; }
    .btn-check:focus-visible + .cartao-perfil { outline: 3px solid #f9a825; outline-offset: 2px; box-shadow: 0 0 0 5px #1b3470; }
    .avatar { width: 2.6rem; height: 2.6rem; border-radius: 50%; display: grid; place-items: center; font-weight: 700; background: #e8edf8; color: #1b3470; margin-bottom: .4rem; }
    .btn-check:checked + .cartao-perfil .avatar { background: #1b3470; color: #fff; }
    .perfil-nome { font-weight: 700; }
    .perfil-foco { font-size: .8rem; color: #4a4f5a; }
    .selecionado { font-size: .75rem; font-weight: 600; color: #1b3470; margin-top: .3rem; }
    .rodape { color: #4a4f5a; font-size: .8rem; }
    /* Celular: cartão em linha (avatar à esquerda), para caber os três perfis sem rolar muito. */
    @media (max-width: 575.98px) {
      .cartao-perfil { display: grid; grid-template-columns: auto 1fr; column-gap: .75rem; text-align: left; align-items: center; padding: .6rem .75rem; }
      .avatar { grid-row: span 4; margin-bottom: 0; }
      .selecionado { margin-top: 0; }
    }
  `,
  template: `
    <main id="conteudo" class="entrar min-vh-100 d-flex align-items-center justify-content-center p-3">
      <div class="moldura row g-0 w-100 shadow-sm">
        <section class="marca-painel col-lg-5 p-4 p-lg-5 d-flex flex-column" aria-labelledby="titulo-produto">
          <p class="marca mb-2">ÚNICO</p>
          <h1 id="titulo-produto" class="h2 fw-bold mb-2">Painel do gabinete</h1>
          <p class="chamada mb-4">Judicial, Documento e Extrajudicial num só lugar, na ordem do que vence primeiro.</p>
          <ul class="vantagens d-none d-lg-block mb-4">
            <li>Fila por prazo e prioridade, com selos que dizem a situação em texto</li>
            <li>"Por que esta prioridade": a conta de cada processo</li>
            <li>Ações em lote com prévia, motivo dos ignorados e desfazer</li>
          </ul>
          <p class="mt-auto mb-0"><span class="selo-sintetico">Dados 100% sintéticos</span></p>
        </section>

        <section class="col-lg-7 p-4 p-lg-5" aria-labelledby="titulo-entrar">
          <h2 id="titulo-entrar" class="h4 fw-bold mb-3">Entrar</h2>

          @if (erro()) {
            <div class="alert alert-danger" role="alert">{{ erro() }}</div>
          }

          <form (ngSubmit)="entrar()" novalidate>
            <fieldset class="mb-4">
              <legend class="mb-2">Com qual perfil você quer ver o painel?</legend>
              <div class="row row-cols-1 row-cols-sm-3 g-2">
                @for (p of perfis; track p.idUsuario) {
                  <div class="col">
                    <input type="radio" class="btn-check" name="perfil" [id]="'perfil-' + p.perfil" [value]="p.idUsuario"
                      [checked]="escolhido()?.idUsuario === p.idUsuario" (change)="escolher(p)"
                      [attr.aria-describedby]="'foco-' + p.perfil">
                    <label class="cartao-perfil" [for]="'perfil-' + p.perfil">
                      <span class="avatar" aria-hidden="true">{{ iniciais(p.nome) }}</span>
                      <span class="perfil-nome">{{ p.rotulo }}</span>
                      <span>{{ p.nome }}</span>
                      <span class="perfil-foco" [id]="'foco-' + p.perfil">{{ p.foco }}</span>
                      @if (escolhido()?.idUsuario === p.idUsuario) {
                        <span class="selecionado">✓ Selecionado</span>
                      }
                    </label>
                  </div>
                }
              </div>
            </fieldset>

            @if (auth.modo() === 'cognito') {
              <div class="mb-3">
                <label for="email" class="form-label">E-mail</label>
                <input id="email" name="email" type="email" class="form-control" autocomplete="username" required
                  aria-describedby="ajuda-email" [ngModel]="email()" (ngModelChange)="aoMudarEmail($event)">
                <div id="ajuda-email" class="form-text">Preenchido ao escolher um perfil. Também aceita outro usuário fictício.</div>
              </div>
              <div class="mb-3">
                <label for="senha" class="form-label">Senha</label>
                <div class="input-group">
                  <input id="senha" name="senha" class="form-control" autocomplete="current-password" required
                    [type]="senhaVisivel() ? 'text' : 'password'" aria-describedby="aviso-caps"
                    [(ngModel)]="senha" (keyup)="verificarCaps($event)" (keydown)="verificarCaps($event)">
                  <button type="button" class="btn btn-outline-secondary" aria-controls="senha"
                    [attr.aria-pressed]="senhaVisivel()" (click)="senhaVisivel.set(!senhaVisivel())">
                    {{ senhaVisivel() ? 'Ocultar' : 'Mostrar' }}<span class="visually-hidden"> senha</span>
                  </button>
                </div>
                <div id="aviso-caps" class="form-text" aria-live="polite">
                  @if (capsLigado()) { <strong>Caps Lock está ativado.</strong> }
                </div>
              </div>
            } @else {
              <div class="mb-3">
                <label for="usuario" class="form-label">Ou escolha outro usuário fictício</label>
                <select id="usuario" name="usuario" class="form-select" required aria-describedby="ajuda-usuario"
                  [ngModel]="idUsuario()" (ngModelChange)="aoMudarUsuario($event)">
                  @for (grupo of grupos(); track grupo.setor) {
                    <optgroup [label]="grupo.setor">
                      @for (u of grupo.usuarios; track u.idUsuario) {
                        <option [value]="u.idUsuario">{{ u.nome }} — {{ perfil(u.perfil) }}</option>
                      }
                    </optgroup>
                  }
                </select>
                <div id="ajuda-usuario" class="form-text">Modo local de desenvolvimento: sem senha. Na AWS o login é pelo Cognito.</div>
              </div>
            }

            <button type="submit" class="btn btn-primary btn-lg w-100" [disabled]="enviando() || !podeEnviar()">
              {{ enviando() ? 'Entrando…' : rotuloBotao() }}
            </button>
          </form>

          <p class="rodape mt-4 mb-0">Hackathon MPF &amp; AWS 2026 · Protótipo com dados fictícios. Nenhum dado real é usado.</p>
        </section>
      </div>
    </main>
  `,
})
export class Entrar implements OnInit {
  protected readonly auth = inject(AutenticacaoService);
  private readonly router = inject(Router);
  protected readonly perfis = PERFIS_DEMO;
  protected readonly iniciais = iniciais;
  protected readonly erro = signal('');
  protected readonly enviando = signal(false);
  protected readonly grupos = signal<{ setor: string; usuarios: UsuarioDemo[] }[]>([]);
  protected readonly escolhido = signal<PerfilDemo | undefined>(perfilPorId(PERFIL_PADRAO));
  protected readonly idUsuario = signal(PERFIL_PADRAO);
  protected readonly email = signal(perfilPorId(PERFIL_PADRAO)?.email ?? '');
  protected readonly senhaVisivel = signal(false);
  protected readonly capsLigado = signal(false);
  protected senha = '';

  protected readonly rotuloBotao = computed(() => {
    const p = this.escolhido();
    return p ? `Entrar como ${p.rotulo.toLowerCase()}` : 'Entrar';
  });

  protected readonly podeEnviar = computed(() => (this.auth.modo() === 'cognito' ? !!this.email().trim() : !!this.idUsuario()));

  protected perfil(codigo: string): string {
    return PERFIL[codigo] ?? codigo;
  }

  async ngOnInit(): Promise<void> {
    if (this.auth.token()) {
      void this.router.navigate(['/inicio']);
      return;
    }
    if (this.auth.modo() === 'local') {
      try {
        const usuarios = await this.auth.usuariosDemo();
        const setores = [...new Set(usuarios.map((u) => u.siglaSetor))];
        this.grupos.set(setores.map((setor) => ({ setor, usuarios: usuarios.filter((u) => u.siglaSetor === setor) })));
      } catch {
        this.erro.set('Servidor local indisponível. Rode "npm start" em backend/.');
      }
    }
  }

  /**
   * Cartão escolhido: preenche o e-mail (Cognito) ou o usuário (local). O foco fica no cartão, para as setas
   * continuarem navegando entre os perfis (padrão de grupo de radio).
   */
  protected escolher(p: PerfilDemo): void {
    this.escolhido.set(p);
    this.email.set(p.email);
    this.idUsuario.set(p.idUsuario);
    this.erro.set('');
  }

  protected aoMudarEmail(valor: string): void {
    this.email.set(valor);
    this.escolhido.set(perfilPorEmail(valor));
  }

  protected aoMudarUsuario(valor: string): void {
    this.idUsuario.set(valor);
    this.escolhido.set(perfilPorId(valor));
  }

  protected verificarCaps(evento: KeyboardEvent): void {
    if (typeof evento.getModifierState === 'function') this.capsLigado.set(evento.getModifierState('CapsLock'));
  }

  private async concluir(acao: () => Promise<void>): Promise<void> {
    this.erro.set('');
    this.enviando.set(true);
    try {
      await acao();
      await this.router.navigate(['/inicio']);
    } catch (e) {
      this.erro.set(e instanceof Error ? e.message : 'Não foi possível entrar.');
    } finally {
      this.enviando.set(false);
    }
  }

  protected entrar(): Promise<void> {
    if (this.auth.modo() !== 'cognito') return this.concluir(() => this.auth.entrarLocal(this.idUsuario()));
    if (!this.email().trim() || !this.senha) {
      this.erro.set('Informe e-mail e senha.');
      return Promise.resolve();
    }
    return this.concluir(() => this.auth.entrarCognito(this.email().trim(), this.senha));
  }
}
