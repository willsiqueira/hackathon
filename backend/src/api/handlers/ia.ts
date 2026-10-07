// Recursos de IA: busca em linguagem natural (texto → filtros) e resumo do dia.
// Setor, perfil e sigilo vêm do usuário autenticado; o corpo só traz o texto digitado.

import { z } from 'zod';
import { esquemaPedidoBusca } from '../../dominio/ia.js';
import { buscarComIa, resumoDoDiaComIa } from '../../servicos/ia.js';
import { validar } from '../http.js';
import type { Contexto } from '../contexto.js';

const esquemaPedidoResumo = z.strictObject({}, { error: 'O resumo do dia não recebe parâmetros.' });

export async function busca(ctx: Contexto) {
  const { texto } = validar(esquemaPedidoBusca, ctx.corpo ?? {});
  return buscarComIa(ctx.ia, ctx, texto);
}

export async function resumoDia(ctx: Contexto) {
  validar(esquemaPedidoResumo, ctx.corpo ?? {});
  return resumoDoDiaComIa(ctx.ia, ctx);
}
