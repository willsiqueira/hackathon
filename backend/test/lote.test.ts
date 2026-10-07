import { describe, expect, test } from 'vitest';
import { aplicarAcao, lerPedidoLote, MAX_ITENS_LOTE, motivoIgnorar, validarLote, type ContextoAplicacao } from '../src/dominio/lote.js';
import { notificacoesDoEvento } from '../src/eventos/notificador.js';
import { montarResumo } from '../src/servicos/resumo.js';
import type { Expediente, Usuario } from '../src/dominio/tipos.js';

const AGORA = new Date('2026-10-07T17:00:00-03:00');
const chefe: Usuario = { idUsuario: 'C1', nome: 'Chefe', perfil: 'CHEFE', siglaSetor: 'S' };
const membro: Usuario = { idUsuario: 'M1', nome: 'Membro', perfil: 'MEMBRO', siglaSetor: 'S' };
const servidor: Usuario = { idUsuario: 'S1', nome: 'Servidor', perfil: 'SERVIDOR', siglaSetor: 'S', ativo: true };
let seq = 0;
const gerarId = (p: string) => `${p}${(seq += 1)}`;

const exp = (extra: Partial<Expediente> = {}): Expediente => ({
  idExpediente: 'E1', etiqueta: 'ET-1', gerenciador: 'JUDICIAL', siglaSetor: 'S', caixa: 'NO_SETOR', situacao: 'EM_ANALISE',
  qtdMinutasPendentes: 0, marcadores: '', idResponsavel: 'M1', nomeResponsavel: 'Membro', tipoResponsabilidade: 'TITULAR', ...extra,
});

const pedido = (tipoAcao: string, parametros: object = {}, ids = ['E1']) => lerPedidoLote({ tipoAcao, ids, parametros });

describe('Validação do lote (zod e perfil)', () => {
  test('ação desconhecida, vazio, limite, id malicioso e parâmetro extra', () => {
    expect(() => pedido('APAGAR')).toThrow(/Ação desconhecida/);
    expect(() => pedido('RECEBER', {}, [])).toThrow(/ao menos um/);
    expect(() => pedido('RECEBER', {}, Array.from({ length: MAX_ITENS_LOTE + 1 }, (_, i) => `E${i}`))).toThrow(/no máximo/);
    expect(() => pedido('RECEBER', {}, ['E1#META'])).toThrow(/Identificador inválido/);
    expect(() => pedido('RECEBER', { siglaSetor: 'X' })).toThrow();
  });

  test('servidor não designa; só membro assina', () => {
    expect(() => validarLote(pedido('DESIGNAR', { idUsuarioDesignado: 'S1' }), servidor, AGORA)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => validarLote(pedido('ASSINAR'), chefe, AGORA)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => validarLote(pedido('ASSINAR'), membro, AGORA)).not.toThrow();
  });

  test('prazo de devolução padrão de 5 dias e não pode ser passado', () => {
    expect(validarLote(pedido('DESIGNAR', { idUsuarioDesignado: 'S1' }), chefe, AGORA).prazoDevolucao).toBe('2026-10-12');
    expect(() => validarLote(pedido('DESIGNAR', { idUsuarioDesignado: 'S1', prazoDevolucao: '2026-10-01' }), chefe, AGORA)).toThrow(/a partir de hoje/);
  });
});

describe('RN4 e RN5: o que é ignorado na prévia', () => {
  const ctx = { usuario: chefe, parametros: {} };

  test('só se recebe da caixa A receber', () => {
    expect(motivoIgnorar('RECEBER', exp(), ctx)).toMatch(/só é possível receber da caixa "A receber"/);
    expect(motivoIgnorar('RECEBER', exp({ caixa: 'A_RECEBER' }), ctx)).toBeNull();
  });

  test.each(['DESIGNAR', 'MOVIMENTAR', 'ARQUIVAR'] as const)('%s só da caixa No setor', (tipo) => {
    expect(motivoIgnorar(tipo, exp({ caixa: 'A_RECEBER' }), { ...ctx, destinatario: servidor })).toMatch(/caixa "No setor"/);
  });

  test('não arquiva com minuta pendente', () => {
    expect(motivoIgnorar('ARQUIVAR', exp({ qtdMinutasPendentes: 1 }), ctx)).toMatch(/minuta/);
    expect(motivoIgnorar('ARQUIVAR', exp(), ctx)).toBeNull();
  });

  test('outro setor e inexistente', () => {
    expect(motivoIgnorar('ARQUIVAR', exp({ siglaSetor: 'X' }), ctx)).toBe('Expediente de outro setor.');
    expect(motivoIgnorar('ARQUIVAR', null, ctx)).toBe('Expediente não encontrado.');
  });

  test('designação para fora do setor ou repetida', () => {
    expect(motivoIgnorar('DESIGNAR', exp(), { ...ctx, destinatario: { ...servidor, siglaSetor: 'X' } })).toMatch(/não é usuária ativa/);
    expect(motivoIgnorar('DESIGNAR', exp({ idResponsavel: 'S1', tipoResponsabilidade: 'DESIGNADO' }), { ...ctx, destinatario: servidor })).toMatch(/Já está designado/);
  });

  test('marcador de outro gerenciador ou já aplicado', () => {
    const marcador = { idRotulo: 'R1', siglaSetor: 'S', gerenciador: 'DOCUMENTO', descricao: 'Responder' };
    expect(motivoIgnorar('INCLUIR_MARCADOR', exp(), { ...ctx, marcador })).toMatch(/outro gerenciador/);
    expect(motivoIgnorar('INCLUIR_MARCADOR', exp({ marcadores: 'Responder' }), { ...ctx, marcador: { ...marcador, gerenciador: 'JUDICIAL' } })).toMatch(/Já tem/);
  });

  test('ciência só em judicial com intimação; assinatura só aguardando assinatura', () => {
    expect(motivoIgnorar('DAR_CIENCIA', exp(), ctx)).toMatch(/Não há intimação/);
    expect(motivoIgnorar('DAR_CIENCIA', exp({ novaIntimacao: true }), ctx)).toBeNull();
    expect(motivoIgnorar('ASSINAR', exp(), ctx)).toMatch(/Não está aguardando/);
  });
});

describe('Efeitos das ações', () => {
  const base: ContextoAplicacao = { usuario: chefe, agora: AGORA, gerarId, parametros: {} };

  test('receber: vai para No setor, com data de recebimento, versão e movimentação', () => {
    const { expediente, gravar } = aplicarAcao('RECEBER', exp({ caixa: 'A_RECEBER', versao: 2 }), base);
    expect(expediente.caixa).toBe('NO_SETOR');
    expect(expediente.dataRecebimento).toBe('2026-10-07T17:00:00-03:00');
    expect(expediente.versao).toBe(3);
    expect(gravar[0].tipoMovimentacao).toBe('RECEBIMENTO');
  });

  test('designar: encerra a ativa e cria a nova', () => {
    const ativa = { entidade: 'designacoes', idDesignacao: 'D0', situacao: 'ATIVA', prazoDevolucao: '2026-10-01' };
    const { expediente, gravar } = aplicarAcao('DESIGNAR', exp(), {
      ...base, destinatario: servidor, designacoesAtivas: [ativa], parametros: { prazoDevolucao: '2026-10-12' },
    });
    expect(expediente.idResponsavel).toBe('S1');
    expect(expediente.tipoResponsabilidade).toBe('DESIGNADO');
    expect(gravar.map((g) => `${g.entidade}:${g.situacao ?? g.tipoMovimentacao}`)).toEqual([
      'designacoes:ENCERRADA', 'designacoes:ATIVA', 'movimentacoes:DESIGNACAO',
    ]);
    expect(gravar[0].statusDevolucao).toBe('DEVOLVIDA_COM_ATRASO');
  });

  test('arquivar: vai para Baixado, sem pontuação', () => {
    const { expediente } = aplicarAcao('ARQUIVAR', exp({ diasRestantes: -2 }), base);
    expect(expediente.caixa).toBe('BAIXADO');
    expect(expediente.statusPrazo).toBe('CUMPRIDO_COM_ATRASO');
    expect(expediente.pontuacaoPrioridade).toBe(0);
  });

  test('incluir marcador atualiza a lista', () => {
    const marcador = { idRotulo: 'R1', descricao: 'Atenção', cor: '#F48FB1' };
    const { expediente, gravar } = aplicarAcao('INCLUIR_MARCADOR', exp({ marcadores: 'Ciência' }), { ...base, marcador });
    expect(expediente.marcadores).toBe('Ciência;Atenção');
    expect(expediente.qtdMarcadores).toBe(2);
    expect(gravar[0].entidade).toBe('marcadores_expedientes');
  });
});

describe('Eventos e resumo diário', () => {
  test('designação gera notificação idempotente para o designado, sem conteúdo do expediente', () => {
    const evento = {
      tipo: 'ExpedienteDesignado' as const, idDesignacao: 'DES-1', idExpediente: 'E1', etiqueta: 'ET-1', gerenciador: 'JUDICIAL',
      siglaSetor: 'S', idUsuarioDesignado: 'S1', idUsuarioDesignador: 'C1', nomeDesignador: 'Chefe', prazoDevolucao: '2026-10-12',
      dataHora: '2026-10-07T17:00:00-03:00',
    };
    const [n] = notificacoesDoEvento(evento);
    expect(n.idNotificacao).toBe('NOT-DES-1');
    expect(n.idUsuario).toBe('S1');
    expect(notificacoesDoEvento({ ...evento, idUsuarioDesignado: 'C1' })).toEqual([]);
  });

  test('resumo diário traz números e etiquetas, nunca assunto', () => {
    const ativos = [
      exp({ idExpediente: 'A', statusPrazo: 'VENCIDO', requerAcao: true, idResponsavel: 'S1', assunto: 'Segredo', dataPrazo: '2026-10-01' }),
      exp({ idExpediente: 'B', statusPrazo: 'VENCE_HOJE', requerAcao: true, novo: true, dataPrazo: '2026-10-07' }),
    ];
    const resumo = montarResumo(servidor, ativos, [{ prazoDevolucao: '2026-10-01' }], AGORA);
    expect(resumo).toMatchObject({ vencidos: 1, vencemHoje: 1, novos24h: 1, devolucoesVencidas: 1 });
    expect(resumo.texto).toContain('ET-1');
    expect(resumo.texto).not.toContain('Segredo');
  });
});
