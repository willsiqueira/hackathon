// Ações em lote, trilha, desfazer e sugestão de designação.

import { cargasDoSetor, desfazer, executar, previa } from '../../servicos/lotes.js';
import { distribuir } from '../../dominio/designacao.js';
import { exigirPerfil } from '../../dominio/acesso.js';
import { lerPedidoLote } from '../../dominio/lote.js';
import { identificador } from '../http.js';
import { criado, type Contexto } from '../contexto.js';

export async function previaLote(ctx: Contexto) {
  return previa(ctx.repo, ctx.usuario, lerPedidoLote(ctx.corpo), ctx.agora);
}

export async function executarLote(ctx: Contexto) {
  return criado(await executar(ctx.repo, ctx.usuario, lerPedidoLote(ctx.corpo), ctx.agora, ctx.eventos));
}

export async function desfazerLote(ctx: Contexto) {
  return desfazer(ctx.repo, ctx.usuario, identificador(ctx.params.id, 'Lote'), ctx.agora);
}

export async function listarLotes(ctx: Contexto) {
  const [meus, setor] = await Promise.all([
    ctx.repo.listarLotesDoUsuario(ctx.usuario.idUsuario),
    ctx.repo.listarLotesDoSetor(ctx.usuario.siglaSetor, 100),
  ]);
  return { meus, setor };
}

/** Carga por pessoa e, se pedida, a distribuição dos ids informados (RF14). */
export async function sugestaoDesignacao(ctx: Contexto) {
  exigirPerfil(ctx.usuario, ['MEMBRO', 'CHEFE'], 'designar');
  const cargas = await cargasDoSetor(ctx.repo, ctx.usuario, ctx.agora);
  const ids = ctx.query.ids ? String(ctx.query.ids).split(',').slice(0, 200).map((id) => identificador(id, 'Expediente')) : [];
  return { cargas, sugerido: cargas[0] ?? null, distribuicao: ids.length ? distribuir(ids, cargas) : {} };
}
