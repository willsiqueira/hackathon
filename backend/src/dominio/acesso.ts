// Autorização por setor e por sigilo (RN6). Sempre aplicada no backend.

import { ErroProibido } from './erros.js';
import type { Expediente, Perfil, Usuario } from './tipos.js';

export const TEXTO_RESTRITO = 'Conteúdo restrito (sigiloso)';
const CAMPOS_RESTRITOS = ['assunto', 'resumo', 'numeroReferencia', 'orgaoOrigem', 'tema'];

export function ehSigiloso(expediente: Pick<Expediente, 'nivelSigilo' | 'sigiloso'>): boolean {
  return Number(expediente.nivelSigilo ?? 0) > 0 || expediente.sigiloso === true;
}

/** Lança 403 se o expediente não for do setor do usuário. */
export function garantirMesmoSetor(usuario: Pick<Usuario, 'siglaSetor'>, expediente?: Pick<Expediente, 'siglaSetor'> | null): void {
  if (!expediente || expediente.siglaSetor !== usuario.siglaSetor) {
    throw new ErroProibido('Este expediente não pertence ao seu setor.');
  }
}

/** Em sigiloso, SERVIDOR só vê o conteúdo se for o responsável. MEMBRO e CHEFE veem. */
export function podeVerConteudo(usuario: Pick<Usuario, 'idUsuario' | 'perfil'>, expediente: Expediente): boolean {
  if (!ehSigiloso(expediente)) return true;
  if (usuario.perfil !== 'SERVIDOR') return true;
  return expediente.idResponsavel === usuario.idUsuario;
}

function ocultar<T extends Expediente>(expediente: T): T {
  const copia: T = { ...expediente, conteudoRestrito: true };
  for (const campo of CAMPOS_RESTRITOS) if (copia[campo] !== undefined) (copia as Record<string, unknown>)[campo] = TEXTO_RESTRITO;
  return copia;
}

/** Versão do expediente que o usuário pode ver na tela. */
export function paraUsuario<T extends Expediente>(usuario: Pick<Usuario, 'idUsuario' | 'perfil'>, expediente: T): T {
  return podeVerConteudo(usuario, expediente) ? { ...expediente, conteudoRestrito: false } : ocultar(expediente);
}

/** Exportações (CSV, ICS, e-mail) nunca levam conteúdo de sigiloso, qualquer que seja o perfil. */
export function paraExportacao<T extends Expediente>(expediente: T): T {
  return ehSigiloso(expediente) ? ocultar(expediente) : { ...expediente, conteudoRestrito: false };
}

export function exigirPerfil(usuario: Pick<Usuario, 'perfil'>, perfis: Perfil[], acao: string): void {
  if (!perfis.includes(usuario.perfil)) {
    throw new ErroProibido(`Seu perfil (${usuario.perfil}) não permite ${acao}.`);
  }
}
