// Preferências, filtros salvos e notificações do usuário autenticado.

import { z } from 'zod';
import { CAMPOS_EXPEDIENTE, interpretarOrdenacao, validarCriterios } from '../../dominio/criterios.js';
import { isoLocal } from '../../dominio/regras.js';
import { ErroNaoEncontrado, ErroValidacao } from '../../dominio/erros.js';
import { gerarId } from '../../servicos/lotes.js';
import { identificador, inteiro, validar } from '../http.js';
import { criado, semConteudo, type Contexto } from '../contexto.js';
import type { Repositorio } from '../../dados/repositorio.js';
import type { Entidade, Usuario } from '../../dominio/tipos.js';

export const WIDGETS = ['contadores', 'resumoIa', 'proximo', 'prazos', 'alertas', 'informes', 'filtros'] as const;
const CONTEXTOS = ['INICIO', 'PAINEL_UNIFICADO', 'JUDICIAL', 'DOCUMENTO', 'EXTRAJUDICIAL'] as const;
const SEVERIDADES = ['CRITICO', 'ATENCAO', 'INFO'] as const;

const ordenacaoValida = z.string().max(60).refine((o) => {
  try {
    interpretarOrdenacao(o);
    return true;
  } catch {
    return false;
  }
}, 'Ordenação inválida.');

const esquemaPreferencias = z.object({
  colunasVisiveis: z.array(z.enum(CAMPOS_EXPEDIENTE)).min(1).max(30).optional(),
  ordenacao: ordenacaoValida.optional(),
  itensPorPagina: z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]).optional(),
  densidade: z.enum(['CONFORTAVEL', 'COMPACTA']).optional(),
  widgets: z.array(z.object({ id: z.enum(WIDGETS), visivel: z.boolean() }).strict()).max(WIDGETS.length)
    .refine((lista) => new Set(lista.map((w) => w.id)).size === lista.length, 'Widgets repetidos.')
    .optional(),
}).strict();

const esquemaFiltro = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do filtro.').max(80, 'Nome com no máximo 80 caracteres.'),
  criterios: z.record(z.string(), z.unknown()).default({}),
  ordenacao: ordenacaoValida.default('fila'),
  padrao: z.boolean().default(false),
  compartilhadoComSetor: z.boolean().default(false),
}).strict();

const esquemaLidas = z.union([
  z.object({ todas: z.literal(true) }).strict(),
  z.object({ ids: z.array(z.string().max(80)).min(1).max(500), lida: z.boolean().default(true) }).strict(),
]);

export async function widgetsDoUsuario(repo: Repositorio, usuario: Usuario) {
  const pref = await repo.obterPreferencias(usuario.idUsuario, 'INICIO');
  const salvos = Array.isArray(pref?.widgets)
    ? (pref.widgets as { id: string; visivel: boolean }[]).filter((w) => (WIDGETS as readonly string[]).includes(w.id))
    : [];
  const faltando = WIDGETS.filter((id) => !salvos.some((w) => w.id === id)).map((id) => ({ id, visivel: true }));
  return [...salvos, ...faltando];
}

function contexto(ctx: Contexto): string {
  return validar(z.enum(CONTEXTOS, { error: 'Contexto inválido.' }), ctx.params.contexto);
}

export async function obterPreferencias(ctx: Contexto) {
  const nome = contexto(ctx);
  const pref: Entidade = (await ctx.repo.obterPreferencias(ctx.usuario.idUsuario, nome)) ?? { contexto: nome };
  if (nome === 'INICIO') pref.widgets = await widgetsDoUsuario(ctx.repo, ctx.usuario);
  if (typeof pref.colunasVisiveis === 'string') pref.colunasVisiveis = pref.colunasVisiveis.split(';').filter(Boolean);
  return pref;
}

export async function salvarPreferencias(ctx: Contexto) {
  const nome = contexto(ctx);
  const corpo = validar(esquemaPreferencias, ctx.corpo ?? {});
  const atual = (await ctx.repo.obterPreferencias(ctx.usuario.idUsuario, nome)) ?? {};
  const nova: Entidade = {
    ...atual, entidade: 'preferencias_usuario', idUsuario: ctx.usuario.idUsuario, siglaSetor: ctx.usuario.siglaSetor, contexto: nome,
  };
  if (corpo.colunasVisiveis) nova.colunasVisiveis = corpo.colunasVisiveis.join(';');
  if (corpo.ordenacao) nova.ordenacao = corpo.ordenacao;
  if (corpo.itensPorPagina) nova.itensPorPagina = corpo.itensPorPagina;
  if (corpo.densidade) nova.densidade = corpo.densidade;
  if (corpo.widgets) nova.widgets = corpo.widgets;
  await ctx.repo.salvar([nova]);
  return obterPreferencias(ctx);
}

// ---------- filtros salvos ----------

function filtroPublico(f: Entidade) {
  let criterios = f.criterios;
  if (typeof criterios === 'string') {
    try {
      criterios = JSON.parse(criterios);
    } catch {
      criterios = {};
    }
  }
  return {
    idFiltro: f.idFiltro, idUsuario: f.idUsuario, nome: f.nome, criterios, ordenacao: f.ordenacao, padrao: f.padrao === true,
    compartilhadoComSetor: f.compartilhadoComSetor === true, dataCriacao: f.dataCriacao,
  };
}

export async function listarFiltros(ctx: Contexto) {
  const { repo, usuario } = ctx;
  const meus = (await repo.listarFiltros(usuario.idUsuario)).map(filtroPublico);
  const colegas = (await repo.listarUsuariosDoSetor(usuario.siglaSetor)).filter((p) => p.idUsuario !== usuario.idUsuario);
  const nomes = new Map(colegas.map((p) => [p.idUsuario, p.nome]));
  const compartilhados = (await Promise.all(colegas.map((p) => repo.listarFiltros(p.idUsuario))))
    .flat()
    .filter((f) => f.compartilhadoComSetor === true)
    .map((f) => ({ ...filtroPublico(f), padrao: false, nomeAutor: nomes.get(f.idUsuario) }));
  return { meus, compartilhados };
}

function lerFiltro(corpo: unknown) {
  const dados = validar(esquemaFiltro, corpo);
  return { ...dados, criterios: JSON.stringify(validarCriterios(dados.criterios)) };
}

async function desmarcarPadrao(repo: Repositorio, idUsuario: string, exceto: string) {
  const outros = (await repo.listarFiltros(idUsuario)).filter((f) => f.padrao && f.idFiltro !== exceto);
  if (outros.length) await repo.salvar(outros.map((f) => ({ ...f, entidade: 'filtros_salvos', padrao: false })));
}

export async function criarFiltro(ctx: Contexto) {
  const dados = lerFiltro(ctx.corpo);
  const existentes = await ctx.repo.listarFiltros(ctx.usuario.idUsuario);
  if (existentes.length >= 50) throw new ErroValidacao('Limite de 50 filtros salvos.');
  const filtro: Entidade = {
    entidade: 'filtros_salvos', idFiltro: gerarId('FIL'), idUsuario: ctx.usuario.idUsuario, siglaSetor: ctx.usuario.siglaSetor,
    ...dados, dataCriacao: isoLocal(ctx.agora),
  };
  if (filtro.padrao) await desmarcarPadrao(ctx.repo, ctx.usuario.idUsuario, filtro.idFiltro);
  await ctx.repo.salvar([filtro]);
  return criado(filtroPublico(filtro));
}

/** Só o autor altera ou exclui: a busca é feita na partição do próprio usuário. */
async function filtroProprio(ctx: Contexto): Promise<Entidade> {
  const id = identificador(ctx.params.id, 'Filtro');
  const filtro = await ctx.repo.obterFiltro(ctx.usuario.idUsuario, id);
  if (!filtro) throw new ErroNaoEncontrado('Filtro não encontrado entre os seus.');
  return filtro;
}

export async function atualizarFiltro(ctx: Contexto) {
  const filtro = await filtroProprio(ctx);
  const { idFiltro: _i, idUsuario: _u, dataCriacao: _d, ...editaveis } = filtroPublico(filtro);
  const dados = lerFiltro({ ...editaveis, ...(ctx.corpo as object) });
  const atualizado: Entidade = { ...filtro, ...dados, entidade: 'filtros_salvos' };
  if (atualizado.padrao) await desmarcarPadrao(ctx.repo, ctx.usuario.idUsuario, atualizado.idFiltro);
  await ctx.repo.salvar([atualizado]);
  return filtroPublico(atualizado);
}

export async function excluirFiltro(ctx: Contexto) {
  const filtro = await filtroProprio(ctx);
  await ctx.repo.excluirFiltro(ctx.usuario.idUsuario, filtro.idFiltro);
  return semConteudo();
}

// ---------- notificações ----------

export async function listarNotificacoes(ctx: Contexto) {
  const agoraIso = isoLocal(ctx.agora);
  const { lida, severidade } = ctx.query;
  if (severidade && !(SEVERIDADES as readonly string[]).includes(severidade)) throw new ErroValidacao('Severidade inválida.');
  const tamanho = inteiro(ctx.query.tamanho, { padrao: 50, min: 1, max: 200, nome: 'tamanho' });
  const pagina = inteiro(ctx.query.pagina, { padrao: 1, min: 1, max: 10000, nome: 'pagina' });
  const todas = (await ctx.repo.listarNotificacoes(ctx.usuario.idUsuario)).filter((n) => n.dataHora <= agoraIso);
  let lista = todas;
  if (lida === 'true' || lida === 'false') lista = lista.filter((n) => n.lida === (lida === 'true'));
  if (severidade) lista = lista.filter((n) => n.severidade === severidade);
  return {
    total: lista.length,
    naoLidas: todas.filter((n) => !n.lida).length,
    pagina,
    tamanho,
    itens: lista.slice((pagina - 1) * tamanho, pagina * tamanho),
  };
}

export async function marcarLidas(ctx: Contexto) {
  const corpo = validar(esquemaLidas, ctx.corpo);
  const todas = await ctx.repo.listarNotificacoes(ctx.usuario.idUsuario);
  let alvo: Entidade[];
  let lida = true;
  if ('todas' in corpo) alvo = todas.filter((n) => !n.lida);
  else {
    const ids = new Set(corpo.ids);
    lida = corpo.lida;
    alvo = todas.filter((n) => ids.has(n.idNotificacao) && n.lida !== lida);
  }
  if (alvo.length) await ctx.repo.salvar(alvo.map((n) => ({ ...n, entidade: 'notificacoes', lida })));
  return { atualizadas: alvo.length };
}
