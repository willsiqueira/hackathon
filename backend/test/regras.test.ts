import { describe, expect, test } from 'vitest';
import {
  chavesIndice, classificarPrazo, compararFila, comporPrioridade, dataLocal, diferencaDias, isoLocal, nivelPrioridade,
  recalcular, riscoVencimento,
} from '../src/dominio/regras.js';
import { filtrar, interpretarOrdenacao, ordenar, validarCriterios } from '../src/dominio/criterios.js';
import { garantirMesmoSetor, paraExportacao, paraUsuario, TEXTO_RESTRITO } from '../src/dominio/acesso.js';
import { calcularCargas, distribuir, type Carga } from '../src/dominio/designacao.js';
import type { Expediente } from '../src/dominio/tipos.js';

const AGORA = new Date('2026-10-07T17:00:00-03:00');

const base: Expediente = {
  idExpediente: 'EXP1', gerenciador: 'JUDICIAL', siglaSetor: 'GABSUB3-DVT', caixa: 'NO_SETOR', situacao: 'EM_ANALISE',
  etiqueta: 'ET-1', statusPrazo: 'NO_PRAZO', urgente: false, novaIntimacao: false, tempoParadoDias: 0, dataPrazo: '2026-10-20',
};

describe('RN1: situação do prazo', () => {
  test.each([
    [-1, 'VENCIDO'], [0, 'VENCE_HOJE'], [1, 'CRITICO'], [3, 'CRITICO'], [4, 'ATENCAO'], [7, 'ATENCAO'], [8, 'NO_PRAZO'],
  ])('%i dia(s) → %s', (dias, esperado) => {
    expect(classificarPrazo(dias)).toBe(esperado);
  });

  test('exemplo do caso: prazo 09/10 consultado em 07/10 → 2 dias → crítico', () => {
    const e = recalcular({ ...base, dataPrazo: '2026-10-09' }, AGORA);
    expect(e.diasRestantes).toBe(2);
    expect(e.statusPrazo).toBe('CRITICO');
  });

  test('dias de calendário no fuso de Brasília (22h30 de 07/10 ainda é 07/10)', () => {
    expect(dataLocal(new Date('2026-10-08T01:30:00Z'))).toBe('2026-10-07');
    expect(diferencaDias('2026-10-07', '2026-10-06')).toBe(-1);
    expect(isoLocal(AGORA)).toBe('2026-10-07T17:00:00-03:00');
  });
});

describe('RN2: pontuação e prioridade', () => {
  test('vencido com réu preso → 80 → crítica, com as parcelas explicadas', () => {
    const { total, parcelas } = comporPrioridade({ ...base, statusPrazo: 'VENCIDO', urgente: true, motivoUrgencia: 'Réu preso' });
    expect(total).toBe(80);
    expect(nivelPrioridade(total)).toBe('CRITICA');
    expect(parcelas.map((p) => p.pontos)).toEqual([50, 30]);
    expect(parcelas[1].motivo).toMatch(/Réu preso/);
  });

  test('todas as parcelas, limitado a 100', () => {
    const { total } = comporPrioridade({
      ...base, statusPrazo: 'VENCIDO', urgente: true, novaIntimacao: true, tempoParadoDias: 31, situacao: 'AGUARDANDO_ASSINATURA',
    });
    expect(total).toBe(100);
  });

  test('parado só conta acima de 30 dias', () => {
    expect(comporPrioridade({ ...base, tempoParadoDias: 30 }).total).toBe(5);
    expect(comporPrioridade({ ...base, tempoParadoDias: 31 }).total).toBe(15);
  });

  test('enviado não recebido vale metade (divisão inteira)', () => {
    expect(comporPrioridade({ ...base, caixa: 'ENVIADO_NAO_RECEBIDO', statusPrazo: 'VENCE_HOJE' }).total).toBe(22);
  });

  test('baixado vale zero', () => {
    expect(comporPrioridade({ ...base, caixa: 'BAIXADO', statusPrazo: 'VENCIDO' }).total).toBe(0);
  });

  test.each([[60, 'CRITICA'], [59, 'ALTA'], [35, 'ALTA'], [34, 'MEDIA'], [20, 'MEDIA'], [19, 'BAIXA']])('%i pontos → %s', (p, nivel) => {
    expect(nivelPrioridade(p)).toBe(nivel);
  });
});

describe('RN3: ordem da fila', () => {
  test('prazo crescente; no empate, pontuação decrescente', () => {
    const lista = [
      { idExpediente: 'A', dataPrazo: '2026-10-08', pontuacaoPrioridade: 45 },
      { idExpediente: 'B', dataPrazo: '2026-10-08', pontuacaoPrioridade: 80 },
      { idExpediente: 'C', dataPrazo: '2026-10-01', pontuacaoPrioridade: 50 },
    ].sort(compararFila);
    expect(lista.map((e) => e.idExpediente)).toEqual(['C', 'B', 'A']);
  });

  test('chaves GSI1 e GSI2 no formato do gerador', () => {
    const chaves = chavesIndice({ ...base, pontuacaoPrioridade: 50, dataChegada: '2026-10-01T10:00:00-03:00' });
    expect(chaves.GSI2SK).toBe('PRAZO#2026-10-20#050#EXP1');
    expect(chaves.GSI1SK).toBe('ATIVO#JUD#NO_SETOR#2026-10-01T10:00:00-03:00#EXP1');
  });
});

describe('RF08: risco de vencimento', () => {
  test('fórmula e limite', () => {
    expect(riscoVencimento(0, 0)).toBe(20);
    expect(riscoVencimento(9, 1)).toBe(100);
    expect(riscoVencimento(2, 9)).toBe(6);
  });
  test('não vale para vencidos', () => {
    expect(riscoVencimento(10, -1)).toBeNull();
  });
});

describe('Filtros e ordenação', () => {
  const lista: Expediente[] = [
    { ...base, idExpediente: 'A', statusPrazo: 'VENCIDO', tempoParadoDias: 40, assunto: 'Habeas corpus', marcadores: 'Atenção;Ciência', idResponsavel: 'U1', dataChegada: '2026-10-01T10:00:00-03:00' },
    { ...base, idExpediente: 'B', statusPrazo: 'CRITICO', tempoParadoDias: 5, assunto: 'Execução penal', marcadores: '', idResponsavel: 'U2', dataChegada: '2026-10-07T10:00:00-03:00' },
  ];
  const ids = (l: Expediente[]) => l.map((e) => e.idExpediente);

  test('lista = um destes; Min; Max por dia; $USUARIO; marcador', () => {
    const usuario = { idUsuario: 'U2' };
    expect(ids(filtrar(lista, validarCriterios({ statusPrazo: ['VENCIDO', 'VENCE_HOJE'] }), usuario))).toEqual(['A']);
    expect(ids(filtrar(lista, validarCriterios({ tempoParadoDiasMin: 30 }), usuario))).toEqual(['A']);
    expect(ids(filtrar(lista, validarCriterios({ dataChegadaMax: '2026-10-01' }), usuario))).toEqual(['A']);
    expect(ids(filtrar(lista, validarCriterios({ idResponsavel: '$USUARIO' }), usuario))).toEqual(['B']);
    expect(ids(filtrar(lista, validarCriterios({ marcadores: ['Ciência'] }), usuario))).toEqual(['A']);
  });

  test('busca sem acento e sem diferenciar maiúsculas', () => {
    expect(ids(filtrar(lista, validarCriterios({ q: 'EXECUCAO' }), {}))).toEqual(['B']);
  });

  test('rejeita filtro desconhecido, valor objeto e ordenação por chave técnica', () => {
    expect(() => validarCriterios({ senha: 'x' })).toThrow(/Filtro desconhecido/);
    expect(() => validarCriterios({ assunto: { $ne: 1 } })).toThrow(/Critérios inválidos/);
    expect(() => interpretarOrdenacao('PK:asc')).toThrow(/Ordenação inválida/);
  });

  test('ordenação por coluna com nulos no fim', () => {
    const comNulo = [{ ...lista[0], risco: null }, { ...lista[1], risco: 30 }];
    expect(ids(ordenar(comNulo, { campo: 'risco', direcao: 'desc' }))).toEqual(['B', 'A']);
    expect(ids(ordenar(comNulo, { campo: 'risco', direcao: 'asc' }))).toEqual(['B', 'A']);
  });
});

describe('RN6: acesso por setor e sigilo', () => {
  const sigiloso: Expediente = { ...base, nivelSigilo: 1, sigiloso: true, assunto: 'Segredo', resumo: 'Detalhes', idResponsavel: 'U3' };

  test('outro setor → 403', () => {
    expect(() => garantirMesmoSetor({ siglaSetor: 'CIVINT/STIC' }, base)).toThrow(expect.objectContaining({ status: 403 }));
  });

  test('servidor não responsável não vê conteúdo; responsável, membro e chefe veem', () => {
    expect(paraUsuario({ idUsuario: 'U4', perfil: 'SERVIDOR' }, sigiloso).assunto).toBe(TEXTO_RESTRITO);
    expect(paraUsuario({ idUsuario: 'U3', perfil: 'SERVIDOR' }, sigiloso).assunto).toBe('Segredo');
    expect(paraUsuario({ idUsuario: 'U1', perfil: 'MEMBRO' }, sigiloso).resumo).toBe('Detalhes');
    expect(paraUsuario({ idUsuario: 'U2', perfil: 'CHEFE' }, sigiloso).conteudoRestrito).toBe(false);
  });

  test('exportação sempre mascara sigiloso', () => {
    expect(paraExportacao(sigiloso).assunto).toBe(TEXTO_RESTRITO);
    expect(paraExportacao(base).conteudoRestrito).toBe(false);
  });
});

describe('RF14: designação balanceada', () => {
  const pessoas = [
    { idUsuario: 'S1', nome: 'Ana', perfil: 'SERVIDOR' as const },
    { idUsuario: 'S2', nome: 'Bia', perfil: 'SERVIDOR' as const },
    { idUsuario: 'C1', nome: 'Chefe', perfil: 'CHEFE' as const },
  ];

  test('índice = carga ÷ capacidade; só servidores', () => {
    const cargas = calcularCargas(
      pessoas,
      [{ idUsuarioDesignado: 'S1', prazoDevolucao: '2026-10-01' }, { idUsuarioDesignado: 'S2', prazoDevolucao: '2026-10-10' }],
      [{ idUsuario: 'S2', totalAcoes: 30 }],
      '2026-10-07',
    );
    expect(cargas.map((c) => c.idUsuario)).toEqual(['S2', 'S1']);
    expect(cargas[0].indice).toBe(0.5); // 1 ÷ (1 + 30/30)
    expect(cargas[1].carga).toBe(3); // 1 ativa + 2 × 1 vencida
  });

  test('distribuição gulosa equilibra', () => {
    const cargas: Carga[] = ['S1', 'S2'].map((idUsuario, i) => ({
      idUsuario, nome: `P${i}`, designacoesAtivas: 0, devolucoesVencidas: 0, acoes30dias: 0, carga: 0, capacidade: 1, indice: 0,
    }));
    const contagem: Record<string, number> = {};
    for (const id of Object.values(distribuir(['E1', 'E2', 'E3', 'E4'], cargas))) contagem[id] = (contagem[id] ?? 0) + 1;
    expect(contagem).toEqual({ S1: 2, S2: 2 });
  });

  test('não redistribui o item para quem já é o designado', () => {
    const cargas: Carga[] = ['S1', 'S2'].map((idUsuario, i) => ({
      idUsuario, nome: `P${i}`, designacoesAtivas: 0, devolucoesVencidas: 0, acoes30dias: 0, carga: i, capacidade: 1, indice: i,
    }));
    expect(distribuir(['E1'], cargas, { E1: 'S1' })).toEqual({ E1: 'S2' });
  });
});
