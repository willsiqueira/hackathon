import { describe, expect, it } from 'vitest';
import { contarFiltros, deCriterios, formularioVazio, paraCriterios } from './filtros-painel';
import { normalizarColunas } from './colunas';
import { acaoDoItem } from '../foco/foco';
import { acoesDoPerfil } from '../../compartilhado/dialogo-lote';
import type { Expediente } from '../../core/modelos';

describe('Filtros do painel ↔ critérios da API', () => {
  it('converte o formulário no formato de filtros_salvos', () => {
    const f = { ...formularioVazio(), statusPrazo: ['VENCIDO'], assunto: 'Dano moral', prazoAte: '2026-10-09', tempoParadoMin: 30, urgente: true, designadoAMim: true };
    expect(paraCriterios(f)).toEqual({
      statusPrazo: ['VENCIDO'], assunto: ['Dano moral'], dataPrazoMax: '2026-10-09', tempoParadoDiasMin: 30, urgente: true,
      idResponsavel: '$USUARIO', tipoResponsabilidade: 'DESIGNADO',
    });
  });

  it('ida e volta preserva os campos e guarda o que a tela não edita', () => {
    const criterios = { statusPrazo: ['VENCIDO', 'CRITICO'], marcadores: ['Atenção'], requerAcao: true, assunto: ['A', 'B'] };
    const f = deCriterios(criterios);
    expect(f.statusPrazo).toEqual(['VENCIDO', 'CRITICO']);
    expect(f.marcador).toBe('Atenção');
    expect(f.extras).toEqual({ assunto: ['A', 'B'] });
    expect(paraCriterios(f)).toEqual(criterios);
  });

  it('conta filtros ativos', () => {
    expect(contarFiltros(formularioVazio())).toBe(0);
    expect(contarFiltros({ ...formularioVazio(), designadoAMim: true, urgente: true })).toBe(2);
  });

  it('colunas: etiqueta sempre primeiro, desconhecidas descartadas', () => {
    expect(normalizarColunas(['assunto', 'PK', 'etiqueta', 'assunto'])).toEqual(['etiqueta', 'assunto']);
    expect(normalizarColunas([])[0]).toBe('etiqueta');
  });
});

describe('Ações por perfil e modo foco', () => {
  const base = { idExpediente: 'E', gerenciador: 'JUDICIAL', siglaSetor: 'S', etiqueta: 'E' } as Expediente;

  it('só membro assina; servidor não designa', () => {
    expect(acoesDoPerfil('MEMBRO')).toContain('ASSINAR');
    expect(acoesDoPerfil('CHEFE')).not.toContain('ASSINAR');
    expect(acoesDoPerfil('SERVIDOR')).not.toContain('DESIGNAR');
  });

  it('ação pendente vira atalho da fila', () => {
    expect(acaoDoItem({ ...base, caixa: 'A_RECEBER', situacao: 'AGUARDANDO_RECEBIMENTO' }, 'SERVIDOR')).toBe('RECEBER');
    expect(acaoDoItem({ ...base, caixa: 'NO_SETOR', situacao: 'AGUARDANDO_ASSINATURA' }, 'MEMBRO')).toBe('ASSINAR');
    expect(acaoDoItem({ ...base, caixa: 'NO_SETOR', situacao: 'AGUARDANDO_ASSINATURA' }, 'SERVIDOR')).toBeNull();
    expect(acaoDoItem({ ...base, caixa: 'NO_SETOR', situacao: 'EM_ANALISE', novaIntimacao: true }, 'SERVIDOR')).toBe('DAR_CIENCIA');
  });
});
