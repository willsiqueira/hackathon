// Resumo diário por e-mail (RF16): vencidos, vencem hoje, novos e devoluções vencidas.
// O e-mail leva só etiquetas e números: nunca assunto ou resumo (sigilo e minimização de dados).

import { dataLocal } from '../dominio/regras.js';
import { fila } from './painel.js';
import type { Repositorio } from '../dados/repositorio.js';
import type { Expediente, Usuario } from '../dominio/tipos.js';

export interface ResumoDiario {
  idUsuario: string;
  nome: string;
  email?: string;
  data: string;
  vencidos: number;
  vencemHoje: number;
  novos24h: number;
  devolucoesVencidas: number;
  meusProximos: { etiqueta: string; dataPrazo?: string; statusPrazo?: string; gerenciador: string }[];
  assunto: string;
  texto: string;
}

export function montarResumo(usuario: Usuario, ativos: Expediente[], designacoesAtivas: { prazoDevolucao: string }[], agora: Date): ResumoDiario {
  const hoje = dataLocal(agora);
  const comAcao = fila(ativos);
  const vencidos = comAcao.filter((e) => e.statusPrazo === 'VENCIDO').length;
  const vencemHoje = comAcao.filter((e) => e.statusPrazo === 'VENCE_HOJE').length;
  const novos24h = ativos.filter((e) => e.novo === true).length;
  const devolucoesVencidas = designacoesAtivas.filter((d) => d.prazoDevolucao < hoje).length;
  const meusProximos = comAcao
    .filter((e) => e.idResponsavel === usuario.idUsuario)
    .slice(0, 10)
    .map((e) => ({ etiqueta: e.etiqueta, dataPrazo: e.dataPrazo, statusPrazo: e.statusPrazo, gerenciador: e.gerenciador }));
  const linhas = [
    `Olá, ${usuario.nome}.`,
    '',
    `Resumo do setor ${usuario.siglaSetor} em ${hoje.split('-').reverse().join('/')}:`,
    `- Vencidos: ${vencidos}`,
    `- Vencem hoje: ${vencemHoje}`,
    `- Novos nas últimas 24 horas: ${novos24h}`,
    `- Suas devoluções de designação vencidas: ${devolucoesVencidas}`,
    '',
    meusProximos.length ? 'Seus próximos prazos:' : 'Você não tem prazos pendentes na sua fila.',
    ...meusProximos.map((p) => `- ${p.etiqueta} (${p.gerenciador.toLowerCase()}), prazo ${p.dataPrazo?.split('-').reverse().join('/')}`),
    '',
    'Abra o painel para ver os detalhes. Mensagem automática com dados fictícios do hackathon.',
  ];
  return {
    idUsuario: usuario.idUsuario,
    nome: usuario.nome,
    email: usuario.email,
    data: hoje,
    vencidos,
    vencemHoje,
    novos24h,
    devolucoesVencidas,
    meusProximos,
    assunto: `[Painel] ${vencidos} vencido(s) e ${vencemHoje} vencendo hoje`,
    texto: linhas.join('\n'),
  };
}

export async function resumoDoUsuario(repo: Repositorio, usuario: Usuario, agora: Date): Promise<ResumoDiario> {
  const [ativos, designacoes] = await Promise.all([
    repo.listarAtivos(usuario.siglaSetor, agora),
    repo.designacoesAtivasDoUsuario(usuario.idUsuario),
  ]);
  return montarResumo(usuario, ativos, designacoes as { prazoDevolucao: string }[], agora);
}

/** Quem optou pelo e-mail (preferência notificarPorEmail em PAINEL_UNIFICADO). */
export async function destinatariosDoSetor(repo: Repositorio, sigla: string): Promise<Usuario[]> {
  const pessoas = (await repo.listarUsuariosDoSetor(sigla)).filter((p) => p.ativo !== false);
  const optaram = await Promise.all(pessoas.map(async (p) => {
    const pref = await repo.obterPreferencias(p.idUsuario, 'PAINEL_UNIFICADO');
    return pref?.notificarPorEmail === true ? p : null;
  }));
  return optaram.filter((p): p is Usuario => p !== null);
}
