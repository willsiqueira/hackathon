// Identidade do chamador.
// AWS: o API Gateway (Cognito User Pool Authorizer) valida o ID token e repassa as claims; aqui lemos custom:idUsuario.
// Local: token HMAC-SHA256 emitido pelo servidor local, com segredo aleatório por execução.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ErroNaoAutenticado, ErroProibido } from '../dominio/erros.js';
import type { Repositorio } from '../dados/repositorio.js';
import type { Perfil, Usuario } from '../dominio/tipos.js';

const VALIDADE_TOKEN_LOCAL_S = 8 * 60 * 60;

export interface Identidade {
  idUsuario: string;
  /** custom:siglaSetor do token (imutável no Cognito). */
  siglaSetor?: string;
  /** Grupo do Cognito (MEMBRO, CHEFE ou SERVIDOR). */
  perfil?: Perfil;
}

const PERFIS: readonly Perfil[] = ['MEMBRO', 'CHEFE', 'SERVIDOR'];

/** "cognito:groups" chega como texto ("CHEFE", "[CHEFE]" ou "A,B") ou lista, conforme o integrador. */
function perfilDosGrupos(grupos: unknown): Perfil | undefined {
  const lista = Array.isArray(grupos) ? grupos.map(String) : String(grupos ?? '').replace(/[[\]]/g, '').split(/[\s,]+/);
  const perfis = PERFIS.filter((p) => lista.includes(p));
  if (perfis.length > 1) throw new ErroProibido('Usuário em mais de um perfil; procure o administrador.');
  return perfis[0];
}

/** Claims do Cognito User Pool Authorizer (API Gateway REST, payload 1.0). */
export function identidadeDasClaims(claims: Record<string, unknown> | undefined | null): Identidade {
  const idUsuario = claims?.['custom:idUsuario'];
  if (typeof idUsuario !== 'string' || !idUsuario) throw new ErroNaoAutenticado();
  const siglaSetor = claims?.['custom:siglaSetor'];
  return {
    idUsuario,
    siglaSetor: typeof siglaSetor === 'string' && siglaSetor ? siglaSetor : undefined,
    perfil: perfilDosGrupos(claims?.['cognito:groups']),
  };
}

export class EmissorTokenLocal {
  constructor(private readonly segredo: Buffer = randomBytes(32)) {}

  private assinar(conteudo: string): string {
    return createHmac('sha256', this.segredo).update(conteudo).digest('base64url');
  }

  /** Mesmo conteúdo do ID token do Cognito: id, setor e perfil. */
  emitir(usuario: Pick<Usuario, 'idUsuario' | 'siglaSetor' | 'perfil'>, agoraMs = Date.now()): string {
    const dados = { sub: usuario.idUsuario, setor: usuario.siglaSetor, perfil: usuario.perfil, exp: Math.floor(agoraMs / 1000) + VALIDADE_TOKEN_LOCAL_S };
    const conteudo = Buffer.from(JSON.stringify(dados)).toString('base64url');
    return `${conteudo}.${this.assinar(conteudo)}`;
  }

  verificar(token: string | undefined, agoraMs = Date.now()): Identidade {
    const [conteudo, assinatura] = String(token ?? '').split('.');
    if (!conteudo || !assinatura) throw new ErroNaoAutenticado();
    const esperada = Buffer.from(this.assinar(conteudo));
    const recebida = Buffer.from(assinatura);
    if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) throw new ErroNaoAutenticado('Token inválido.');
    let dados: { sub?: unknown; exp?: unknown; setor?: unknown; perfil?: unknown };
    try {
      dados = JSON.parse(Buffer.from(conteudo, 'base64url').toString('utf8'));
    } catch {
      throw new ErroNaoAutenticado('Token inválido.');
    }
    if (typeof dados.sub !== 'string' || typeof dados.exp !== 'number' || dados.exp * 1000 < agoraMs) {
      throw new ErroNaoAutenticado('Sessão expirada.');
    }
    return {
      idUsuario: dados.sub,
      siglaSetor: typeof dados.setor === 'string' ? dados.setor : undefined,
      perfil: PERFIS.includes(dados.perfil as Perfil) ? (dados.perfil as Perfil) : undefined,
    };
  }

  identidadeDoCabecalho(cabecalho: string | undefined): Identidade {
    const [tipo, token] = String(cabecalho ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new ErroNaoAutenticado();
    return this.verificar(token);
  }
}

/**
 * Usuário autenticado. Setor e perfil vêm das claims do Cognito (custom:siglaSetor e grupo), nunca da requisição;
 * o cadastro na tabela é conferido como segunda barreira: divergência → 403.
 */
export async function carregarUsuario(repo: Repositorio, identidade: Identidade): Promise<Usuario> {
  const usuario = await repo.obterUsuario(identidade.idUsuario);
  if (!usuario) throw new ErroNaoAutenticado('Usuário não cadastrado.');
  if (usuario.ativo === false) throw new ErroProibido('Usuário inativo.');
  if (identidade.siglaSetor && identidade.siglaSetor !== usuario.siglaSetor) throw new ErroProibido('Setor do token não confere com o cadastro.');
  if (identidade.perfil && identidade.perfil !== usuario.perfil) throw new ErroProibido('Perfil do token não confere com o cadastro.');
  return {
    ...usuario,
    siglaSetor: identidade.siglaSetor ?? usuario.siglaSetor,
    perfil: identidade.perfil ?? usuario.perfil,
  };
}
