import { describe, expect, it } from 'vitest';
import {
  avisoBuscaIaAplicada, caixasEmExtras, contarFiltros, deCriterios, formularioVazio, paraCriterios, removerCaixaDeExtras,
  separarCriteriosIa,
} from './filtros-painel';
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

describe('Critérios da busca com IA → tela do painel', () => {
  const abas = ['TODOS', 'JUDICIAL', 'DOCUMENTO', 'EXTRAJUDICIAL'];
  const abasCaixa = ['A_RECEBER', 'NO_SETOR', 'ENVIADO_NAO_RECEBIDO'];

  it('gerenciador único presente nas abas vira aba', () => {
    const r = separarCriteriosIa({ gerenciador: ['JUDICIAL'], statusPrazo: ['VENCIDO'] }, abas);
    expect(r.gerenciador).toBe('JUDICIAL');
    expect(r.formulario.statusPrazo).toEqual(['VENCIDO']);
    expect(r.formulario.extras).toEqual({});
  });

  it('gerenciador fora das abas (ou mais de um) fica em extras e a aba volta para Todos', () => {
    const fora = separarCriteriosIa({ gerenciador: ['JUDICIAL'] }, ['TODOS', 'DOCUMENTO']);
    expect(fora.gerenciador).toBe('TODOS');
    expect(fora.formulario.extras).toEqual({ gerenciador: ['JUDICIAL'] });
    const dois = separarCriteriosIa({ gerenciador: ['JUDICIAL', 'DOCUMENTO'] }, abas);
    expect(dois.formulario.extras).toEqual({ gerenciador: ['JUDICIAL', 'DOCUMENTO'] });
  });

  it('sem gerenciador não mexe na aba; q vira o texto da pesquisa', () => {
    const r = separarCriteriosIa({ q: ' dano moral ' }, abas);
    expect(r.gerenciador).toBeUndefined();
    expect(r.busca).toBe('dano moral');
    expect(paraCriterios(r.formulario)).toEqual({});
  });

  it('caixa única presente nas abas de caixa vira a aba de caixa (fora dos extras)', () => {
    const r = separarCriteriosIa({ caixa: ['A_RECEBER'], urgente: true }, abas, abasCaixa);
    expect(r.caixa).toBe('A_RECEBER');
    expect(r.formulario.urgente).toBe(true);
    expect(r.formulario.extras).toEqual({});
    expect(caixasEmExtras(r.formulario)).toEqual([]);
    expect(paraCriterios(r.formulario)).toEqual({ urgente: true });
  });

  it('várias caixas (ou fora das abas) voltam a aba para "Todas as caixas" e ficam visíveis como chips', () => {
    const varias = separarCriteriosIa({ caixa: ['A_RECEBER', 'NO_SETOR'] }, abas, abasCaixa);
    expect(varias.caixa).toBe('');
    expect(caixasEmExtras(varias.formulario)).toEqual(['A_RECEBER', 'NO_SETOR']);
    expect(paraCriterios(varias.formulario)).toEqual({ caixa: ['A_RECEBER', 'NO_SETOR'] });
    const fora = separarCriteriosIa({ caixa: 'BAIXADO' }, abas, abasCaixa);
    expect(fora.caixa).toBe('');
    expect(caixasEmExtras(fora.formulario)).toEqual(['BAIXADO']);
  });

  it('sem caixa nos critérios, a aba de caixa atual é mantida', () => {
    expect(separarCriteriosIa({ urgente: true }, abas, abasCaixa).caixa).toBeUndefined();
  });

  it('regressão: aba "No setor" + IA pedindo "A receber" não cruza as duas caixas', () => {
    // Antes, a caixa da IA ia para extras e a requisição saía com caixa=NO_SETOR e criterios.caixa=[A_RECEBER]
    // (lista vazia). Agora a aba passa a ser A_RECEBER e os critérios não repetem a caixa.
    const abaAtual = 'NO_SETOR';
    const r = separarCriteriosIa({ caixa: ['A_RECEBER'], statusPrazo: ['VENCIDO'] }, abas, abasCaixa);
    const caixaDaRequisicao = r.caixa ?? abaAtual;
    const criterios = paraCriterios(r.formulario);
    expect(caixaDaRequisicao).toBe('A_RECEBER');
    expect(criterios['caixa']).toBeUndefined();
    // Itens de exemplo filtrados como o backend faz (critérios e depois aba): sobra o vencido "A receber".
    const itens = [
      { caixa: 'A_RECEBER', statusPrazo: 'VENCIDO' }, { caixa: 'NO_SETOR', statusPrazo: 'VENCIDO' }, { caixa: 'A_RECEBER', statusPrazo: 'NO_PRAZO' },
    ];
    const visiveis = itens
      .filter((e) => (criterios['statusPrazo'] as string[]).includes(e.statusPrazo))
      .filter((e) => !criterios['caixa'] || (criterios['caixa'] as string[]).includes(e.caixa))
      .filter((e) => e.caixa === caixaDaRequisicao);
    expect(visiveis).toHaveLength(1);
  });

  it('remover um chip de caixa tira só aquela caixa; sem caixas, o critério some', () => {
    const f = deCriterios({ caixa: ['A_RECEBER', 'NO_SETOR'], urgente: true });
    const uma = removerCaixaDeExtras(f, 'A_RECEBER');
    expect(caixasEmExtras(uma)).toEqual(['NO_SETOR']);
    expect(uma.urgente).toBe(true);
    expect(paraCriterios(removerCaixaDeExtras(uma, 'NO_SETOR'))).toEqual({ urgente: true });
  });

  it('aviso cita a troca da aba de caixa', () => {
    expect(avisoBuscaIaAplicada(17, 'A receber'))
      .toBe('Filtros da busca com IA aplicados; caixa alterada para A receber: 17 expediente(s). Ajuste em Filtros avançados se precisar.');
    expect(avisoBuscaIaAplicada(4)).toBe('Filtros da busca com IA aplicados: 4 expediente(s). Ajuste em Filtros avançados se precisar.');
  });

  it('réu preso, intervalo de prazo e "designados a mim" preenchem o formulário', () => {
    const r = separarCriteriosIa({
      reuPreso: true, dataPrazoMin: '2026-10-07', dataPrazoMax: '2026-10-11', idResponsavel: '$USUARIO', tipoResponsabilidade: 'DESIGNADO',
    }, abas);
    expect(r.formulario.reuPreso).toBe(true);
    expect(r.formulario.prazoDe).toBe('2026-10-07');
    expect(r.formulario.prazoAte).toBe('2026-10-11');
    expect(r.formulario.designadoAMim).toBe(true);
    expect(r.formulario.extras).toEqual({});
  });

  it('responsável escolhido pela IA vai para o campo Responsável', () => {
    const r = separarCriteriosIa({ idResponsavel: ['GABSUB3-DVT-U01'] }, abas);
    expect(r.formulario.idResponsavel).toBe('GABSUB3-DVT-U01');
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
