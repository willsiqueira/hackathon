import { describe, expect, it } from 'vitest';
import { textoPrazo } from './selos';
import { contraste, corTexto } from '../core/catalogo.service';

// Cores de catalogos.csv (STATUS_PRAZO, PRIORIDADE, GERENCIADOR, SEVERIDADE) e a cor padrão.
const CORES = ['#C62828', '#E65100', '#F9A825', '#FDD835', '#2E7D32', '#546E7A', '#8D6E63', '#EF6C00', '#1565C0', '#6A1B9A', '#607D8B'];

describe('Selo de prazo (RF07: texto sem depender da cor)', () => {
  it.each([
    ['VENCIDO', -3, 'Vencido há 3 dias'],
    ['VENCIDO', -1, 'Vencido há 1 dia'],
    ['VENCE_HOJE', 0, 'Vence hoje'],
    ['CRITICO', 2, 'Vence em 2 dias'],
    ['ATENCAO', 1, 'Vence em 1 dia'],
    ['NO_PRAZO', 12, 'No prazo (12 dias)'],
  ] as const)('%s com %i dia(s) → "%s"', (status, dias, esperado) => {
    expect(textoPrazo(status, dias)).toBe(esperado);
  });

  it('sem prazo', () => {
    expect(textoPrazo(undefined, undefined)).toBe('Sem prazo');
  });
});

describe('Contraste dos selos (WCAG AA, 4,5:1)', () => {
  it.each(CORES)('texto escolhido sobre %s tem contraste suficiente', (fundo) => {
    expect(contraste(fundo, corTexto(fundo))).toBeGreaterThanOrEqual(4.5);
  });
});
