// Configuração por variáveis de ambiente.

export const DATA_REFERENCIA_BASE = '2026-10-07T17:00:00-03:00';

/**
 * Relógio da aplicação. Com DATA_REFERENCIA (ISO 8601), o "agora" começa nessa data e avança com o tempo real
 * decorrido desde o início do processo; assim a base sintética continua coerente e as ações têm horários distintos.
 * Com "agora" (ou vazio), usa o relógio do sistema.
 */
export function criarRelogio(texto = process.env.DATA_REFERENCIA): () => Date {
  if (!texto || texto === 'agora') return () => new Date();
  const referencia = new Date(texto);
  if (Number.isNaN(referencia.getTime())) throw new Error(`DATA_REFERENCIA inválida: ${texto}`);
  const inicio = Date.now();
  return () => new Date(referencia.getTime() + (Date.now() - inicio));
}

export function variavelObrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável ${nome} não definida.`);
  return valor;
}
