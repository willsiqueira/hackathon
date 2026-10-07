// Geração de CSV e iCal. Conteúdo de sigiloso já deve vir mascarado (acesso.paraExportacao).

import { somarDias } from '../dominio/regras.js';
import type { Entidade } from '../dominio/tipos.js';

export interface ColunaCsv {
  campo: string;
  titulo: string;
}

/** Célula CSV com aspas e proteção contra injeção de fórmula em planilhas. */
function celula(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  let texto = String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[",\n\r;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function gerarCsv(linhas: Entidade[], colunas: ColunaCsv[]): string {
  const cabecalho = colunas.map((c) => celula(c.titulo)).join(',');
  const corpo = linhas.map((linha) => colunas.map((c) => celula(linha[c.campo])).join(','));
  // BOM para o Excel abrir os acentos corretamente.
  return `\uFEFF${[cabecalho, ...corpo].join('\r\n')}\r\n`;
}

function escaparIcs(texto: unknown): string {
  return String(texto ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545: linhas de no máximo 75 octetos; a continuação começa com espaço. */
function dobrarLinha(linha: string): string {
  const partes: string[] = [];
  let resto = linha;
  while (Buffer.byteLength(resto) > 75) {
    let corte = 75;
    while (Buffer.byteLength(resto.slice(0, corte)) > 75) corte -= 1;
    partes.push(resto.slice(0, corte));
    resto = ` ${resto.slice(corte)}`;
  }
  partes.push(resto);
  return partes.join('\r\n');
}

/** Um evento de dia inteiro por prazo, com lembrete N dias antes. */
export function gerarIcs(
  expedientes: Entidade[],
  { antecedenciaDias, carimbo, dominio = 'lex-gabinete.exemplo.org' }: { antecedenciaDias: number; carimbo: string; dominio?: string },
): string {
  const dtstamp = `${carimbo.replace(/[-:]/g, '').replace(/\.\d+/, '').slice(0, 15)}Z`;
  const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hackathon MPF//Lex Gabinete//PT-BR', 'CALSCALE:GREGORIAN'];
  for (const e of expedientes) {
    if (!e.dataPrazo) continue;
    const inicio = String(e.dataPrazo).replace(/-/g, '');
    const fim = somarDias(e.dataPrazo, 1).replace(/-/g, '');
    const titulo = e.conteudoRestrito ? `Prazo: ${e.etiqueta} (sigiloso)` : `Prazo: ${e.etiqueta} - ${e.assunto}`;
    linhas.push(
      'BEGIN:VEVENT',
      `UID:${e.idExpediente}-${inicio}@${dominio}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${inicio}`,
      `DTEND;VALUE=DATE:${fim}`,
      `SUMMARY:${escaparIcs(titulo)}`,
      `DESCRIPTION:${escaparIcs(`${e.gerenciador} · ${e.acaoPendente ?? ''} · prioridade ${e.prioridade}`)}`,
    );
    if (antecedenciaDias > 0) {
      linhas.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escaparIcs(titulo)}`, `TRIGGER:-P${antecedenciaDias}D`, 'END:VALARM');
    }
    linhas.push('END:VEVENT');
  }
  linhas.push('END:VCALENDAR');
  return `${linhas.map(dobrarLinha).join('\r\n')}\r\n`;
}
