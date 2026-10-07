import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ConfiguracaoService } from './configuracao.service';
import type { Me } from './modelos';

const CHAVE_TOKEN = 'lex:token';

/** Instante de expiração (ms) do JWT do Cognito; null se não for JWT (token local). */
export function expiracaoJwt(token: string): number | null {
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const dados = JSON.parse(atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')));
    return typeof dados.exp === 'number' ? dados.exp * 1000 : null;
  } catch {
    return null;
  }
}

export interface UsuarioDemo {
  idUsuario: string;
  nome: string;
  perfil: string;
  cargo: string;
  siglaSetor: string;
}

/**
 * Sessão do usuário. O token fica em sessionStorage (some ao fechar a aba).
 * A tela nunca decide setor, perfil ou sigilo: isso vem de /api/me, calculado no backend.
 */
@Injectable({ providedIn: 'root' })
export class AutenticacaoService {
  private readonly router = inject(Router);
  private readonly configuracao = inject(ConfiguracaoService);
  private readonly tokenAtual = signal<string | null>(sessionStorage.getItem(CHAVE_TOKEN));
  private readonly perfilAtual = signal<Me | null>(null);

  readonly me = this.perfilAtual.asReadonly();
  readonly autenticado = computed(() => this.tokenAtual() !== null);
  readonly modo = computed(() => this.configuracao.valor().modoAutenticacao);

  token(): string | null {
    const token = this.tokenAtual();
    if (!token) return null;
    const expira = expiracaoJwt(token);
    if (expira !== null && expira < Date.now()) {
      this.limpar();
      return null;
    }
    return token;
  }

  async usuariosDemo(): Promise<UsuarioDemo[]> {
    const resposta = await fetch('/api/auth/local/usuarios');
    if (!resposta.ok) throw new Error('Não foi possível listar os usuários de demonstração.');
    return resposta.json();
  }

  async entrarLocal(idUsuario: string): Promise<void> {
    const resposta = await fetch('/api/auth/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idUsuario }),
    });
    if (!resposta.ok) throw new Error('Usuário inválido.');
    const { token } = await resposta.json();
    this.guardar(token);
  }

  /** USER_PASSWORD_AUTH direto no Cognito; o ID token leva custom:idUsuario para o autorizador da API. */
  async entrarCognito(email: string, senha: string): Promise<void> {
    const { regiao, userPoolClientId } = this.configuracao.valor();
    const resposta = await fetch(`https://cognito-idp.${regiao}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
      },
      body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: userPoolClientId, AuthParameters: { USERNAME: email, PASSWORD: senha } }),
    });
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok || !corpo.AuthenticationResult?.IdToken) {
      throw new Error(corpo.ChallengeName ? 'Sua conta exige troca de senha. Procure o administrador.' : 'E-mail ou senha incorretos.');
    }
    this.guardar(corpo.AuthenticationResult.IdToken);
  }

  definirMe(me: Me | null): void {
    this.perfilAtual.set(me);
  }

  sair(): void {
    this.limpar();
    void this.router.navigate(['/entrar']);
  }

  private guardar(token: string): void {
    sessionStorage.setItem(CHAVE_TOKEN, token);
    this.tokenAtual.set(token);
  }

  private limpar(): void {
    sessionStorage.removeItem(CHAVE_TOKEN);
    this.tokenAtual.set(null);
    this.perfilAtual.set(null);
  }
}
