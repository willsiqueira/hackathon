import { inject } from '@angular/core';
import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { type CanActivateFn, Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AutenticacaoService } from './autenticacao.service';
import { ApiService } from './api.service';

/** Envia o token só para a própria API e encerra a sessão em 401. */
export const autenticacaoInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AutenticacaoService);
  const token = auth.token();
  const paraApi = req.url.startsWith('/api/');
  const comToken = token && paraApi ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(comToken).pipe(
    catchError((erro: unknown) => {
      if (erro instanceof HttpErrorResponse && erro.status === 401 && paraApi) auth.sair();
      return throwError(() => erro);
    }),
  );
};

/** Exige sessão e carrega /api/me (setor e perfil vêm do backend). */
export const autenticadoGuard: CanActivateFn = async () => {
  const auth = inject(AutenticacaoService);
  const router = inject(Router);
  if (!auth.token()) return router.createUrlTree(['/entrar']);
  if (!auth.me()) {
    try {
      auth.definirMe(await inject(ApiService).me());
    } catch {
      return router.createUrlTree(['/entrar']);
    }
  }
  return true;
};

/** Mensagem legível de um erro da API ({ erro, mensagem }). */
export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof HttpErrorResponse) {
    if (erro.status === 0) return 'Sem conexão com o servidor.';
    const corpo = erro.error as { mensagem?: string } | null;
    if (corpo && typeof corpo === 'object' && corpo.mensagem) return corpo.mensagem;
    if (erro.status === 403) return 'Acesso negado.';
    if (erro.status === 404) return 'Não encontrado.';
  }
  return 'Erro inesperado. Tente de novo.';
}
