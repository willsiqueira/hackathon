import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AutenticacaoService, type UsuarioDemo } from '../../core/autenticacao.service';

const PERFIL: Record<string, string> = { MEMBRO: 'Membro', CHEFE: 'Chefe de gabinete', SERVIDOR: 'Servidor' };

@Component({
  selector: 'app-entrar',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="min-vh-100 d-flex align-items-center justify-content-center p-3" id="conteudo">
      <div class="cartao shadow-sm w-100" style="max-width: 30rem">
        <p class="marca text-primary mb-1" style="letter-spacing: .14em; font-weight: 700">ÚNICO</p>
        <h1 class="titulo-pagina h3 mb-1">Painel do gabinete</h1>
        <p class="text-secondary small mb-4">Protótipo do hackathon com dados fictícios. Nenhum dado real é usado.</p>

        @if (erro()) {
          <div class="alert alert-danger" role="alert">{{ erro() }}</div>
        }

        @if (auth.modo() === 'cognito') {
          <form (ngSubmit)="entrarCognito()" novalidate>
            <div class="mb-3">
              <label for="email" class="form-label">E-mail</label>
              <input id="email" name="email" type="email" class="form-control" autocomplete="username" required [(ngModel)]="email">
            </div>
            <div class="mb-3">
              <label for="senha" class="form-label">Senha</label>
              <input id="senha" name="senha" type="password" class="form-control" autocomplete="current-password" required [(ngModel)]="senha">
            </div>
            <button type="submit" class="btn btn-primary w-100" [disabled]="enviando()">{{ enviando() ? 'Entrando…' : 'Entrar' }}</button>
          </form>
        } @else {
          <form (ngSubmit)="entrarLocal()" novalidate>
            <div class="mb-3">
              <label for="usuario" class="form-label">Usuário fictício</label>
              <select id="usuario" name="usuario" class="form-select" required [(ngModel)]="idUsuario" aria-describedby="ajuda-usuario">
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
            <button type="submit" class="btn btn-primary w-100" [disabled]="enviando() || !idUsuario">{{ enviando() ? 'Entrando…' : 'Entrar' }}</button>
          </form>
        }
      </div>
    </main>
  `,
})
export class Entrar implements OnInit {
  protected readonly auth = inject(AutenticacaoService);
  private readonly router = inject(Router);
  protected readonly erro = signal('');
  protected readonly enviando = signal(false);
  protected readonly grupos = signal<{ setor: string; usuarios: UsuarioDemo[] }[]>([]);
  protected idUsuario = 'GABSUB3-DVT-U02';
  protected email = '';
  protected senha = '';

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

  protected entrarLocal(): Promise<void> {
    return this.concluir(() => this.auth.entrarLocal(this.idUsuario));
  }

  protected entrarCognito(): Promise<void> {
    if (!this.email || !this.senha) {
      this.erro.set('Informe e-mail e senha.');
      return Promise.resolve();
    }
    return this.concluir(() => this.auth.entrarCognito(this.email.trim(), this.senha));
  }
}
