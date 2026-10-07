// Formatação de datas no padrão brasileiro, sem depender do fuso do navegador
// (as datas da base já vêm com −03:00; exibimos o dia e a hora de Brasília).

export function dataBr(valor: string | undefined | null): string {
  if (!valor) return '—';
  const [a, m, d] = valor.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function dataHoraBr(valor: string | undefined | null): string {
  if (!valor) return '—';
  const hora = valor.length > 10 ? valor.slice(11, 16) : '';
  return hora ? `${dataBr(valor)} ${hora}` : dataBr(valor);
}

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "Quarta-feira, 7 de outubro de 2026" a partir de 'AAAA-MM-DD…'. */
export function dataPorExtenso(valor: string): string {
  const [a, m, d] = valor.slice(0, 10).split('-').map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  const texto = `${DIAS[dia]}, ${d} de ${MESES[m - 1]} de ${a}`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function rotuloEnum(codigo: string | undefined): string {
  if (!codigo) return '—';
  const texto = codigo.toLowerCase().replace(/_/g, ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
