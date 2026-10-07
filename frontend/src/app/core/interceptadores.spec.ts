import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { autenticacaoInterceptor, mensagemDeErro } from './interceptadores';
import { AutenticacaoService, expiracaoJwt } from './autenticacao.service';

describe('Interceptor de autenticação', () => {
  let http: HttpClient;
  let controle: HttpTestingController;

  beforeEach(() => {
    sessionStorage.setItem('lex:token', 'token-local.assinatura');
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'entrar', children: [] }]), provideHttpClient(withInterceptors([autenticacaoInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    controle = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    controle.verify();
    sessionStorage.clear();
  });

  it('envia o token só para a própria API', () => {
    http.get('/api/me').subscribe();
    http.get('https://outro.exemplo.org/x').subscribe();
    expect(controle.expectOne('/api/me').request.headers.get('Authorization')).toBe('Bearer token-local.assinatura');
    expect(controle.expectOne('https://outro.exemplo.org/x').request.headers.has('Authorization')).toBe(false);
  });

  it('401 encerra a sessão', () => {
    const auth = TestBed.inject(AutenticacaoService);
    http.get('/api/me').subscribe({ error: () => {} });
    controle.expectOne('/api/me').flush({ erro: 'NAO_AUTENTICADO' }, { status: 401, statusText: 'Unauthorized' });
    expect(auth.token()).toBeNull();
  });
});

describe('Apoio', () => {
  it('mensagem de erro da API', () => {
    const erro = new HttpErrorResponse({ status: 403, error: { erro: 'ACESSO_NEGADO', mensagem: 'Este expediente não pertence ao seu setor.' } });
    expect(mensagemDeErro(erro)).toBe('Este expediente não pertence ao seu setor.');
    expect(mensagemDeErro(new HttpErrorResponse({ status: 0 }))).toBe('Sem conexão com o servidor.');
  });

  it('lê a expiração do JWT do Cognito', () => {
    const corpo = btoa(JSON.stringify({ exp: 1_800_000_000 })).replace(/=+$/, '');
    expect(expiracaoJwt(`x.${corpo}.y`)).toBe(1_800_000_000_000);
    expect(expiracaoJwt('token-local.assinatura')).toBeNull();
  });
});
