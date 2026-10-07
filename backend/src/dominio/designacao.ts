// Sugestão de designação pela carga de cada pessoa (F7, RF14).
//   carga      = designações ativas + 2 × devoluções vencidas
//   capacidade = 1 + ações nos últimos 30 dias ÷ 30
//   índice     = carga ÷ capacidade (menor = mais disponível)

import type { Entidade, Usuario } from './tipos.js';

export const JANELA_PRODUTIVIDADE_DIAS = 30;
export const PESO_DEVOLUCAO_VENCIDA = 2;

export interface Carga {
  idUsuario: string;
  nome: string;
  designacoesAtivas: number;
  devolucoesVencidas: number;
  acoes30dias: number;
  carga: number;
  capacidade: number;
  indice: number;
}

const arredondar = (valor: number) => Math.round(valor * 100) / 100;

function compararIndice(a: Carga, b: Carga): number {
  return a.indice - b.indice || a.carga - b.carga || a.nome.localeCompare(b.nome, 'pt-BR');
}

/** Cargas das pessoas ativas com perfil SERVIDOR, da mais disponível para a menos. */
export function calcularCargas(
  pessoas: Pick<Usuario, 'idUsuario' | 'nome' | 'perfil' | 'ativo'>[],
  designacoesAtivas: Entidade[],
  produtividade: Entidade[],
  hoje: string,
): Carga[] {
  return pessoas
    .filter((p) => p.ativo !== false && p.perfil === 'SERVIDOR')
    .map((p) => {
      const minhas = designacoesAtivas.filter((d) => d.idUsuarioDesignado === p.idUsuario);
      const vencidas = minhas.filter((d) => d.prazoDevolucao < hoje).length;
      const acoes = produtividade.filter((r) => r.idUsuario === p.idUsuario).reduce((s, r) => s + Number(r.totalAcoes ?? 0), 0);
      const carga = minhas.length + PESO_DEVOLUCAO_VENCIDA * vencidas;
      const capacidade = 1 + acoes / JANELA_PRODUTIVIDADE_DIAS;
      return {
        idUsuario: p.idUsuario,
        nome: p.nome,
        designacoesAtivas: minhas.length,
        devolucoesVencidas: vencidas,
        acoes30dias: acoes,
        carga,
        capacidade: arredondar(capacidade),
        indice: arredondar(carga / capacidade),
      };
    })
    .sort(compararIndice);
}

/**
 * Distribuição gulosa: cada expediente (na ordem recebida) vai para quem tem o menor índice naquele momento.
 * Devolve { idExpediente: idUsuario }.
 */
export function distribuir(
  idsExpedientes: string[],
  cargas: Carga[],
  /** Quem já é o designado de cada expediente: não recebe o mesmo item de novo, se houver alternativa. */
  designadosAtuais: Record<string, string | undefined> = {},
): Record<string, string> {
  if (!cargas.length) return {};
  const estado = cargas.map((c) => ({ ...c }));
  const resultado: Record<string, string> = {};
  for (const id of idsExpedientes) {
    estado.sort(compararIndice);
    const escolhido = estado.find((c) => c.idUsuario !== designadosAtuais[id]) ?? estado[0];
    resultado[id] = escolhido.idUsuario;
    escolhido.carga += 1;
    escolhido.indice = arredondar(escolhido.carga / escolhido.capacidade);
  }
  return resultado;
}
