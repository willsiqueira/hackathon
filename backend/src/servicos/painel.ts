// Montagem do painel, dos contadores e da fila a partir dos ativos do setor.

import { paraUsuario } from '../dominio/acesso.js';
import { filtrar, ordenar, paginar, type Criterios, type Ordenacao } from '../dominio/criterios.js';
import { CAIXAS_ATIVAS, compararFila } from '../dominio/regras.js';
import { ErroValidacao } from '../dominio/erros.js';
import type { Repositorio } from '../dados/repositorio.js';
import type { Caixa, Expediente, Gerenciador, Setor, Usuario } from '../dominio/tipos.js';

export const GERENCIADORES: readonly Gerenciador[] = Object.freeze(['JUDICIAL', 'DOCUMENTO', 'EXTRAJUDICIAL']);

/** Gerenciadores do setor (atributo "JUDICIAL;DOCUMENTO;…" do perfil do setor). */
export function gerenciadoresDoSetor(setor: Setor | null): Gerenciador[] {
  return String(setor?.gerenciadores ?? '').split(';').filter((g): g is Gerenciador => GERENCIADORES.includes(g as Gerenciador));
}

export function validarGerenciador(gerenciador: string | undefined, setor: Setor): Gerenciador | undefined {
  if (!gerenciador || gerenciador === 'TODOS') return undefined;
  if (!gerenciadoresDoSetor(setor).includes(gerenciador as Gerenciador)) {
    throw new ErroValidacao(`O setor não usa o gerenciador ${gerenciador}.`);
  }
  return gerenciador as Gerenciador;
}

export function validarCaixa(caixa: string | undefined): Caixa | undefined {
  if (!caixa) return undefined;
  if (!CAIXAS_ATIVAS.includes(caixa as Caixa)) throw new ErroValidacao(`Caixa inválida: ${caixa}. Baixados ficam só nos indicadores.`);
  return caixa as Caixa;
}

/** Ativos do setor, já com a máscara de sigilo do usuário (aplicada antes de filtrar, para não vazar por filtro). */
export async function ativosVisiveis(repo: Repositorio, usuario: Usuario, agora: Date, gerenciador?: string): Promise<Expediente[]> {
  const ativos = await repo.listarAtivos(usuario.siglaSetor, agora, gerenciador);
  return ativos.map((e) => paraUsuario(usuario, e));
}

export function contarPorCaixa(lista: Expediente[]): Record<string, number> {
  const contagem: Record<string, number> = Object.fromEntries(CAIXAS_ATIVAS.map((c) => [c, 0]));
  for (const e of lista) if (contagem[e.caixa] !== undefined) contagem[e.caixa] += 1;
  return contagem;
}

export interface OpcoesPainel {
  caixa?: Caixa;
  criterios: Criterios;
  ordenacao: Ordenacao;
  pagina: number;
  tamanho: number;
}

/** Lista do painel: filtros → contadores por caixa → caixa → ordenação → página. */
export function montarPainel(ativos: Expediente[], usuario: Usuario, opcoes: OpcoesPainel) {
  const filtrados = filtrar(ativos, opcoes.criterios, usuario);
  const contadoresCaixa = contarPorCaixa(filtrados);
  const daCaixa = opcoes.caixa ? filtrados.filter((e) => e.caixa === opcoes.caixa) : filtrados;
  const ordenados = ordenar(daCaixa, opcoes.ordenacao);
  return {
    total: ordenados.length,
    pagina: opcoes.pagina,
    tamanho: opcoes.tamanho,
    contadoresCaixa,
    itens: paginar(ordenados, opcoes.pagina, opcoes.tamanho),
    todos: ordenados,
  };
}

/** Contadores da tela inicial (só ativos, RN7; indicadores de prazo só para o que exige ação). */
export function contadores(ativos: Expediente[], usuario: Pick<Usuario, 'idUsuario'>) {
  const comAcao = ativos.filter((e) => e.requerAcao);
  const conta = (lista: Expediente[], condicao: (e: Expediente) => boolean) => lista.reduce((n, e) => n + (condicao(e) ? 1 : 0), 0);
  return {
    aReceber: conta(ativos, (e) => e.caixa === 'A_RECEBER'),
    noSetor: conta(ativos, (e) => e.caixa === 'NO_SETOR'),
    enviadosNaoRecebidos: conta(ativos, (e) => e.caixa === 'ENVIADO_NAO_RECEBIDO'),
    vencidos: conta(comAcao, (e) => e.statusPrazo === 'VENCIDO'),
    venceHoje: conta(comAcao, (e) => e.statusPrazo === 'VENCE_HOJE'),
    criticos: conta(comAcao, (e) => e.statusPrazo === 'CRITICO'),
    atencao: conta(comAcao, (e) => e.statusPrazo === 'ATENCAO'),
    urgentes: conta(comAcao, (e) => e.urgente === true),
    prioridadeCritica: conta(comAcao, (e) => e.prioridade === 'CRITICA'),
    novos24h: conta(ativos, (e) => e.novo === true),
    parados30dias: conta(comAcao, (e) => (e.tempoParadoDias ?? 0) > 30),
    designados: conta(ativos, (e) => e.tipoResponsabilidade === 'DESIGNADO'),
    designadosAMim: conta(ativos, (e) => e.tipoResponsabilidade === 'DESIGNADO' && e.idResponsavel === usuario.idUsuario),
  };
}

export type Contadores = ReturnType<typeof contadores>;

export function contadoresPorGerenciador(ativos: Expediente[], usuario: Usuario, gerenciadores: Gerenciador[]): Record<string, Contadores> {
  const resultado: Record<string, Contadores> = { TODOS: contadores(ativos, usuario) };
  for (const g of gerenciadores) resultado[g] = contadores(ativos.filter((e) => e.gerenciador === g), usuario);
  return resultado;
}

/** Fila que exige ação, na ordem RN3. */
export function fila(ativos: Expediente[]): Expediente[] {
  return ativos.filter((e) => e.requerAcao).sort(compararFila);
}
