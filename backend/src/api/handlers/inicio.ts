// Usuário, tela inicial e dados de apoio (catálogos, pessoas, marcadores).

import { isoLocal } from '../../dominio/regras.js';
import { ativosVisiveis, contadoresPorGerenciador, fila, gerenciadoresDoSetor } from '../../servicos/painel.js';
import { widgetsDoUsuario } from './usuario.js';
import { resumoDoUsuario } from '../../servicos/resumo.js';
import type { Contexto } from '../contexto.js';
import type { Expediente } from '../../dominio/tipos.js';

export async function me(ctx: Contexto) {
  const { usuario, setor } = ctx;
  return {
    usuario: { idUsuario: usuario.idUsuario, nome: usuario.nome, perfil: usuario.perfil, cargo: usuario.cargo, siglaSetor: usuario.siglaSetor },
    setor: {
      siglaSetor: setor.siglaSetor, nome: setor.nome, tipoSetor: setor.tipoSetor, oficio: setor.oficio,
      gerenciadores: gerenciadoresDoSetor(setor),
    },
    dataReferencia: isoLocal(ctx.agora),
  };
}

const resumo = (e: Expediente) => ({
  idExpediente: e.idExpediente, etiqueta: e.etiqueta, gerenciador: e.gerenciador, caixa: e.caixa, assunto: e.assunto,
  classe: e.classe, acaoPendente: e.acaoPendente, dataPrazo: e.dataPrazo, diasRestantes: e.diasRestantes,
  statusPrazo: e.statusPrazo, prioridade: e.prioridade, pontuacaoPrioridade: e.pontuacaoPrioridade, urgente: e.urgente,
  motivoUrgencia: e.motivoUrgencia, nomeResponsavel: e.nomeResponsavel, conteudoRestrito: e.conteudoRestrito,
});

export async function inicio(ctx: Contexto) {
  const { repo, usuario, agora, setor } = ctx;
  const agoraIso = isoLocal(agora);
  const [ativos, notificacoes, noticias, widgets] = await Promise.all([
    ativosVisiveis(repo, usuario, agora),
    repo.listarNotificacoes(usuario.idUsuario),
    repo.listarNoticias(),
    widgetsDoUsuario(repo, usuario),
  ]);
  const naFila = fila(ativos);
  const naoLidas = notificacoes.filter((n) => !n.lida && n.dataHora <= agoraIso);
  const informes = noticias
    .filter((n) => n.dataInicioExibicao <= agoraIso && agoraIso.slice(0, 10) <= n.dataFimExibicao)
    .sort((a, b) => a.prioridade - b.prioridade || String(b.dataInicioExibicao).localeCompare(a.dataInicioExibicao));
  const minhaFila = naFila.filter((e) => e.idResponsavel === usuario.idUsuario);
  return {
    dataReferencia: agoraIso,
    contadores: contadoresPorGerenciador(ativos, usuario, gerenciadoresDoSetor(setor)),
    proximoExpediente: (minhaFila[0] ?? naFila[0]) ? resumo(minhaFila[0] ?? naFila[0]) : null,
    proximosPrazos: naFila.filter((e) => (e.diasRestantes ?? -1) >= 0).slice(0, 10).map(resumo),
    vencidos: naFila.filter((e) => (e.diasRestantes ?? 0) < 0).slice(0, 5).map(resumo),
    alertas: { naoLidas: naoLidas.length, itens: naoLidas.slice(0, 5) },
    informes,
    widgets,
  };
}

/** Prévia do resumo diário por e-mail do próprio usuário (RF16). */
export async function resumoDiario(ctx: Contexto) {
  const { email: _email, ...resumo } = await resumoDoUsuario(ctx.repo, ctx.usuario, ctx.agora);
  return resumo;
}

export async function catalogos(ctx: Contexto) {
  return ctx.repo.listarCatalogos();
}

export async function usuarios(ctx: Contexto) {
  const pessoas = await ctx.repo.listarUsuariosDoSetor(ctx.usuario.siglaSetor);
  return pessoas.map(({ idUsuario, nome, perfil, cargo, ativo }) => ({ idUsuario, nome, perfil, cargo, ativo }));
}

export async function marcadores(ctx: Contexto) {
  return ctx.repo.listarMarcadores(ctx.usuario.siglaSetor);
}
