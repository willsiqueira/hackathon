// Recursos de IA (Amazon Bedrock): domínio puro, adaptadores com cliente falso e rotas sobre a base completa.
// Nenhum teste chama o Bedrock de verdade.

import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { criarApi } from '../src/api/roteador.js';
import { Repositorio } from '../src/dados/repositorio.js';
import { TabelaMemoria, carregarItensJson } from '../src/dados/tabela-memoria.js';
import { ErroIaIndisponivel, ErroNaoAutenticado, ErroRespostaIa } from '../src/dominio/erros.js';
import {
  datasDeReferencia, descreverCriterios, esquemaPedidoBusca, interpretarRespostaBusca, interpretarRespostaResumo,
  itemParaIa, montarEntradaResumo, montarPedidoBusca, LIMITE_TEXTO_RESUMO, type ContextoBusca, type PedidoModelo,
} from '../src/dominio/ia.js';
import { comporPrioridade, rotuloPrazo } from '../src/dominio/regras.js';
import { ehSigiloso } from '../src/dominio/acesso.js';
import {
  CacheCurto, criarIa, ModeloBedrock, ModeloDemonstracao, type ClienteConverse, type ModeloLinguagem, type ResumoDiaIa,
} from '../src/servicos/ia.js';
import { publicadorEmProcesso } from '../src/eventos/notificador.js';
import type { Entidade, Expediente } from '../src/dominio/tipos.js';

const ITENS = fileURLToPath(new URL('../../docs/hackathon-expedientes/seed/saida/dynamodb/itens.json', import.meta.url));
const AGORA = new Date('2026-10-07T17:00:00-03:00');
const MEMBRO = 'GABSUB3-DVT-U01';
const CHEFE = 'GABSUB3-DVT-U02';
const SERVIDOR = 'GABSUB3-DVT-U03';

const CONTEXTO: ContextoBusca = {
  datas: datasDeReferencia(AGORA),
  gerenciadores: ['JUDICIAL', 'DOCUMENTO', 'EXTRAJUDICIAL'],
  caixas: ['A_RECEBER', 'NO_SETOR', 'ENVIADO_NAO_RECEBIDO'],
  situacoes: ['EM_ANALISE', 'AGUARDANDO_ASSINATURA'],
  assuntos: ['Tráfico de drogas', 'Execução penal'],
  classes: ['RESP', 'HC'],
  temas: ['Direito Penal'],
  marcadores: ['Acompanhar'],
  responsaveis: [{ idUsuario: MEMBRO, nome: 'Ana Exemplo' }, { idUsuario: CHEFE, nome: 'Bruno Teste' }],
};

function expediente(campos: Partial<Expediente>): Expediente {
  return {
    idExpediente: 'EXP1', gerenciador: 'JUDICIAL', siglaSetor: 'GABSUB3-DVT', caixa: 'NO_SETOR', situacao: 'EM_ANALISE',
    etiqueta: 'PGR-1/2026', statusPrazo: 'VENCIDO', diasRestantes: -2, prioridade: 'CRITICA', pontuacaoPrioridade: 80,
    acaoPendente: 'Analisar', urgente: true, motivoUrgencia: 'Réu preso', tempoParadoDias: 40, nivelSigilo: 0, sigiloso: false,
    assunto: 'Assunto secreto XYZ', resumo: 'Resumo secreto XYZ', tema: 'Tema secreto XYZ', nomeResponsavel: 'Ana Exemplo',
    idResponsavel: MEMBRO, numeroReferencia: 'REF-SECRETA', ...campos,
  } as Expediente;
}

/** Modelo falso: guarda os pedidos e devolve a resposta programada (ou a do modo demonstração). */
class ModeloEspiao implements ModeloLinguagem {
  pedidos: PedidoModelo[] = [];
  resposta: ((pedido: PedidoModelo) => string | Promise<string>) | null = null;
  private readonly demonstracao = new ModeloDemonstracao();

  async gerar(pedido: PedidoModelo): Promise<string> {
    this.pedidos.push(pedido);
    return this.resposta ? this.resposta(pedido) : this.demonstracao.gerar(pedido);
  }

  limpar(): void {
    this.pedidos = [];
    this.resposta = null;
  }
}

// ---------------------------------------------------------------- domínio

describe('IA: domínio', () => {
  test('1. esquemaPedidoBusca: vazio, só espaços, 301 caracteres e chave extra falham; 300 passa', () => {
    expect(esquemaPedidoBusca.safeParse({ texto: '' }).success).toBe(false);
    expect(esquemaPedidoBusca.safeParse({ texto: '   ' }).success).toBe(false);
    expect(esquemaPedidoBusca.safeParse({ texto: 'a'.repeat(301) }).success).toBe(false);
    expect(esquemaPedidoBusca.safeParse({ texto: 'vencidos', extra: 1 }).success).toBe(false);
    expect(esquemaPedidoBusca.safeParse({}).success).toBe(false);
    expect(esquemaPedidoBusca.safeParse({ texto: 'a'.repeat(300) }).success).toBe(true);
  });

  test('2. datasDeReferencia no fuso de Brasília', () => {
    expect(datasDeReferencia(AGORA)).toMatchObject({
      hoje: '2026-10-07', amanha: '2026-10-08', fimDaSemana: '2026-10-11', fimDoMes: '2026-10-31', daquiA7Dias: '2026-10-14',
      daquiA30Dias: '2026-11-06', diaDaSemana: 'quarta-feira',
    });
    expect(datasDeReferencia(new Date('2026-10-11T10:00:00-03:00')).fimDaSemana).toBe('2026-10-11'); // domingo
  });

  test('3. itemParaIa de não sigiloso: só a lista branca, motivos da composição da prioridade', () => {
    const e = expediente({});
    const item = itemParaIa(e);
    const permitidas = ['etiqueta', 'gerenciador', 'statusPrazo', 'diasRestantes', 'prioridade', 'acaoPendente', 'motivos'];
    expect(Object.keys(item).every((k) => permitidas.includes(k))).toBe(true);
    expect(Object.keys(item).sort()).toEqual([...permitidas].sort());
    expect(item.motivos).toEqual(comporPrioridade(e).parcelas.map((p) => p.motivo));
    expect(JSON.stringify(item)).not.toMatch(/secreto|REF-SECRETA|Ana Exemplo|GABSUB3/);
  });

  test('4. itemParaIa de sigiloso visto por MEMBRO (conteudoRestrito: false): só etiqueta, prazo e prioridade', () => {
    const e = expediente({ nivelSigilo: 1, sigiloso: true, conteudoRestrito: false });
    const item = itemParaIa(e);
    expect(Object.keys(item).sort()).toEqual(['etiqueta', 'prioridade', 'sigiloso', 'statusPrazo']);
    expect(item.sigiloso).toBe(true);
    const texto = JSON.stringify(item);
    for (const proibido of ['Assunto secreto', 'Resumo secreto', 'Tema secreto', 'Réu preso', 'Urgente']) expect(texto).not.toContain(proibido);
  });

  test('5. itemParaIa com conteudoRestrito: true e nivelSigilo 0: também restrito', () => {
    const item = itemParaIa(expediente({ conteudoRestrito: true, nivelSigilo: 0, sigiloso: false }));
    expect(Object.keys(item).sort()).toEqual(['etiqueta', 'prioridade', 'sigiloso', 'statusPrazo']);
  });

  test('6. montarEntradaResumo: até 8 itens, conta sigilosos e agrega alertas', () => {
    const fila = Array.from({ length: 12 }, (_, i) => expediente({
      idExpediente: `EXP${i}`, etiqueta: `PGR-${i}/2026`, nivelSigilo: i % 3 === 0 ? 1 : 0,
    }));
    const entrada = montarEntradaResumo({
      agora: AGORA, perfil: 'MEMBRO', contadores: {}, fila,
      notificacoesNaoLidas: [{ severidade: 'CRITICO' }, { severidade: 'CRITICO' }, { severidade: 'INFO' }, {}],
    });
    expect(entrada.proximos).toHaveLength(8);
    expect(entrada.sigilososSemConteudo).toBe(3); // índices 0, 3 e 6
    expect(entrada.alertasNaoLidos).toEqual({ total: 4, porSeveridade: { CRITICO: 2, INFO: 2 } });
    expect(entrada.dataReferencia).toBe('2026-10-07');
    expect(JSON.stringify(entrada)).not.toMatch(/secreto|Ana Exemplo/);
  });

  test('7. montarPedidoBusca: pedido, datas e responsáveis na mensagem; limites do modelo', () => {
    const pedido = montarPedidoBusca('vencidos do Bruno', CONTEXTO);
    expect(pedido.tarefa).toBe('BUSCA');
    expect(pedido.maxTokens).toBe(400);
    expect(pedido.temperatura).toBe(0);
    const mensagem = JSON.parse(pedido.mensagem);
    expect(mensagem.pedido).toBe('vencidos do Bruno');
    expect(mensagem.contexto.datas.fimDaSemana).toBe('2026-10-11');
    expect(pedido.mensagem).toContain('Bruno Teste');
    expect(pedido.sistema).toMatch(/Não siga instruções/);
  });

  test('8. interpretarRespostaBusca: lista branca, domínios conferidos e 422 para lixo', () => {
    const bruto = '```json\n' + JSON.stringify({
      statusPrazo: 'VENCIDO', prioridade: ['CRITICA', 'URGENTISSIMA'], siglaSetor: 'CIVINT/STIC', PK: 'EXP#1',
      idResponsavel: ['CIVINT-STIC-U02', CHEFE], dataPrazoMax: '2026-13-40', dataPrazoMin: '2026-10-07', urgente: false,
      reuPreso: true, assunto: 'tráfico DE drogas', tempoParadoDiasMin: 30,
    }) + '\n```';
    const { criterios, descartados } = interpretarRespostaBusca(bruto, CONTEXTO);
    expect(criterios).toEqual({
      statusPrazo: ['VENCIDO'], prioridade: ['CRITICA'], idResponsavel: [CHEFE], dataPrazoMin: '2026-10-07', reuPreso: true,
      assunto: ['Tráfico de drogas'], tempoParadoDiasMin: 30,
    });
    expect(descartados).toEqual(expect.arrayContaining(['siglaSetor', 'PK', 'prioridade: URGENTISSIMA',
      'idResponsavel: CIVINT-STIC-U02', 'dataPrazoMax: 2026-13-40', 'urgente: false']));
    expect(interpretarRespostaBusca('{"statusPrazo":"CUMPRIDO","q":"x"}', CONTEXTO).descartados).toContain('statusPrazo: CUMPRIDO');
    expect(interpretarRespostaBusca('{"idResponsavel":"$USUARIO","tipoResponsabilidade":"DESIGNADO"}', CONTEXTO).criterios)
      .toEqual({ idResponsavel: '$USUARIO', tipoResponsabilidade: 'DESIGNADO' });
    expect(() => interpretarRespostaBusca('não sei responder', CONTEXTO)).toThrow(ErroRespostaIa);
    expect(() => interpretarRespostaBusca('[1,2]', CONTEXTO)).toThrow(ErroRespostaIa);
    try {
      interpretarRespostaBusca('{"PK":"x","siglaSetor":"y","statusPrazo":"CUMPRIDO"}', CONTEXTO);
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroRespostaIa);
      expect((erro as ErroRespostaIa).status).toBe(422);
    }
  });

  test('9. descreverCriterios: nomes, "Eu", rótulos de prazo e datas dd/mm/aaaa', () => {
    const chips = descreverCriterios({
      idResponsavel: [MEMBRO], statusPrazo: ['VENCIDO', 'CRITICO'], dataPrazoMax: '2026-10-11', reuPreso: true,
    }, CONTEXTO);
    expect(chips).toEqual([
      { chave: 'idResponsavel', rotulo: 'Responsável', valor: 'Ana Exemplo' },
      { chave: 'statusPrazo', rotulo: 'Situação do prazo', valor: `${rotuloPrazo('VENCIDO')}, ${rotuloPrazo('CRITICO')}` },
      { chave: 'dataPrazoMax', rotulo: 'Prazo até', valor: '11/10/2026' },
      { chave: 'reuPreso', rotulo: 'Réu preso', valor: 'Sim' },
    ]);
    expect(descreverCriterios({ idResponsavel: '$USUARIO' }, CONTEXTO)[0].valor).toBe('Eu');
  });

  test('10. interpretarRespostaResumo: remove markdown, corta em 1.500 e recusa vazio', () => {
    expect(interpretarRespostaResumo('## Resumo\n**Hoje** há 3 vencidos.')).toBe('Resumo\nHoje há 3 vencidos.');
    expect(interpretarRespostaResumo('x'.repeat(2000))).toHaveLength(LIMITE_TEXTO_RESUMO);
    expect(() => interpretarRespostaResumo('  ** ')).toThrow(ErroRespostaIa);
  });
});

// ---------------------------------------------------------------- adaptadores

describe('IA: adaptadores', () => {
  afterEach(() => vi.restoreAllMocks());

  const PEDIDO: PedidoModelo = { tarefa: 'RESUMO', sistema: 'SEGREDO-SISTEMA', mensagem: 'SEGREDO-PROMPT', maxTokens: 500, temperatura: 0.2 };

  test('11. ModeloBedrock envia ConverseCommand com modelo, limites e timeout, e concatena o texto', async () => {
    const enviados: { comando: ConverseCommand; opcoes?: { abortSignal?: AbortSignal } }[] = [];
    const cliente: ClienteConverse = {
      send: async (comando, opcoes) => {
        enviados.push({ comando, opcoes });
        return { output: { message: { role: 'assistant', content: [{ text: 'Olá, ' }, { text: 'mundo.' }] } } } as never;
      },
    };
    const modelo = new ModeloBedrock({ modelId: 'us.amazon.nova-lite-v1:0', cliente, timeoutMs: 5000 });
    expect(await modelo.gerar(PEDIDO)).toBe('Olá, mundo.');
    const { input } = enviados[0].comando;
    expect(input.modelId).toBe('us.amazon.nova-lite-v1:0');
    expect(input.inferenceConfig).toEqual({ maxTokens: 500, temperature: 0.2, topP: 0.9 });
    expect(input.system).toEqual([{ text: 'SEGREDO-SISTEMA' }]);
    expect(input.messages).toEqual([{ role: 'user', content: [{ text: 'SEGREDO-PROMPT' }] }]);
    expect(enviados[0].opcoes?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  test('12. ModeloBedrock: erros viram 503 em pt-BR e nada do prompt vai para o log', async () => {
    const espioes = [vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {})];
    const casos: [string, RegExp][] = [
      ['ThrottlingException', /Muitas solicitações/],
      ['AccessDeniedException', /não está habilitado/],
      ['AbortError', /indisponível no momento/],
    ];
    for (const [nome, mensagem] of casos) {
      const cliente: ClienteConverse = {
        send: async () => {
          const erro = new Error('falhou com SEGREDO-PROMPT e RESPOSTA-SECRETA');
          erro.name = nome;
          throw erro;
        },
      };
      const falha = await new ModeloBedrock({ modelId: 'm', cliente }).gerar(PEDIDO).catch((e) => e);
      expect(falha).toBeInstanceOf(ErroIaIndisponivel);
      expect(falha.status).toBe(503);
      expect(falha.codigo).toBe('IA_INDISPONIVEL');
      expect(falha.message).toMatch(mensagem);
      expect(falha.message).not.toContain('SEGREDO');
    }
    const registrado = espioes.flatMap((s) => s.mock.calls.flat()).map(String).join('\n');
    expect(registrado).toContain('ThrottlingException');
    expect(registrado).not.toMatch(/SEGREDO|RESPOSTA-SECRETA/);
  });

  test('13. criarIa escolhe o modo pelas variáveis de ambiente', () => {
    expect(criarIa({}).origem).toBe('demonstracao');
    expect(criarIa({}).modelo).toBeInstanceOf(ModeloDemonstracao);
    expect(criarIa({ IA_MODO: 'fake', BEDROCK_MODEL_ID: 'us.amazon.nova-lite-v1:0' }).origem).toBe('demonstracao');
    const real = criarIa({ BEDROCK_MODEL_ID: 'us.amazon.nova-lite-v1:0', AWS_REGION: 'us-east-1' });
    expect(real.origem).toBe('bedrock');
    expect(real.modelo).toBeInstanceOf(ModeloBedrock);
    expect(real.cache).toBeInstanceOf(CacheCurto);
  });

  test('14. ModeloDemonstracao + interpretarRespostaBusca entende a frase da demo', async () => {
    const texto = 'processos de réu preso que vencem esta semana designados à Ana';
    const bruto = await new ModeloDemonstracao().gerar(montarPedidoBusca(texto, CONTEXTO));
    const { criterios } = interpretarRespostaBusca(bruto, CONTEXTO);
    expect(criterios).toEqual({ reuPreso: true, dataPrazoMin: '2026-10-07', dataPrazoMax: '2026-10-11', idResponsavel: [MEMBRO] });
    const meus = interpretarRespostaBusca(await new ModeloDemonstracao().gerar(montarPedidoBusca('vencidos designados a mim', CONTEXTO)), CONTEXTO);
    expect(meus.criterios).toEqual({ statusPrazo: ['VENCIDO'], idResponsavel: '$USUARIO', tipoResponsabilidade: 'DESIGNADO' });
    const livre = interpretarRespostaBusca(await new ModeloDemonstracao().gerar(montarPedidoBusca('ofício da receita', CONTEXTO)), CONTEXTO);
    expect(livre.criterios).toEqual({ q: 'ofício da receita' });
  });

  test('15. CacheCurto: validade e tamanho máximo', () => {
    let agora = 0;
    const cache = new CacheCurto<number>(1000, 2, () => agora);
    cache.guardar('a', 1);
    agora = 999;
    expect(cache.obter('a')).toBe(1);
    agora = 1000;
    expect(cache.obter('a')).toBeUndefined();
    cache.guardar('a', 1);
    cache.guardar('b', 2);
    cache.guardar('c', 3);
    expect(cache.tamanho).toBe(2);
    expect(cache.obter('a')).toBeUndefined();
    expect(cache.obter('c')).toBe(3);
  });
});

// ---------------------------------------------------------------- API (base completa)

describe('IA: API', () => {
  let tabela: TabelaMemoria;
  let tratar: ReturnType<typeof criarApi>;
  const modelo = new ModeloEspiao();

  async function chamar(idUsuario: string | null, metodo: string, caminho: string, opcoes: { query?: Record<string, string>; corpo?: unknown } = {}) {
    const resposta = await tratar({
      metodo,
      caminho,
      query: opcoes.query ?? {},
      corpo: () => opcoes.corpo,
      obterIdentidade: () => {
        if (!idUsuario) throw new ErroNaoAutenticado();
        return { idUsuario };
      },
    });
    return { status: resposta.status, corpo: JSON.parse(resposta.corpo || 'null') };
  }

  const ativosDe = (sigla: string) => tabela.consultar({ indice: 'GSI1', pk: `SETOR#${sigla}`, prefixo: 'ATIVO#' });

  beforeAll(async () => {
    tabela = await carregarItensJson(new TabelaMemoria(), ITENS);
    const repo = new Repositorio(tabela);
    tratar = criarApi({
      repo,
      relogio: () => AGORA,
      registrar: () => {},
      eventos: publicadorEmProcesso(repo),
      ia: { modelo, origem: 'bedrock', cache: new CacheCurto<ResumoDiaIa>() },
    });
  });

  afterEach(() => modelo.limpar());

  test('16. sem identidade → 401', async () => {
    expect((await chamar(null, 'POST', '/api/ia/busca', { corpo: { texto: 'vencidos' } })).status).toBe(401);
    expect((await chamar(null, 'POST', '/api/ia/resumo-dia', { corpo: {} })).status).toBe(401);
    expect(modelo.pedidos).toHaveLength(0);
  });

  test('17. entrada inválida → 400 sem chamar o modelo', async () => {
    for (const corpo of [{ texto: '' }, { texto: 'a'.repeat(301) }, { texto: 'vencidos', extra: 1 }, undefined]) {
      const { status, corpo: resposta } = await chamar(CHEFE, 'POST', '/api/ia/busca', { corpo });
      expect(status).toBe(400);
      expect(resposta.erro).toBe('VALIDACAO');
    }
    expect((await chamar(CHEFE, 'POST', '/api/ia/resumo-dia', { corpo: { idUsuario: CHEFE } })).status).toBe(400);
    expect(modelo.pedidos).toHaveLength(0);
  });

  test('18. busca válida: critérios e chips; ao modelo só vão listas de domínio do próprio setor', async () => {
    const { status, corpo } = await chamar(CHEFE, 'POST', '/api/ia/busca', { corpo: { texto: 'judiciais vencidos de réu preso' } });
    expect(status).toBe(200);
    expect(corpo.criterios).toEqual({ reuPreso: true, statusPrazo: ['VENCIDO'], gerenciador: ['JUDICIAL'] });
    expect(corpo.interpretacao.length).toBe(3);
    expect(corpo.origem).toBe('bedrock');
    expect(corpo.descartados).toEqual([]);
    expect(modelo.pedidos).toHaveLength(1);
    const { mensagem } = modelo.pedidos[0];
    expect(mensagem).toContain('Ana Exemplo');
    expect(mensagem).not.toContain('CIVINT-STIC-U');
    expect(mensagem).not.toContain('Gabriela Simulada');
    expect(mensagem).not.toMatch(/@exemplo\.org/);
    // Nenhum dado de expediente: nem etiqueta, nem número de referência, nem resumo.
    for (const e of await ativosDe('GABSUB3-DVT')) {
      for (const campo of ['etiqueta', 'numeroReferencia', 'resumo']) {
        if (e[campo]) expect(mensagem, `${campo} de ${e.idExpediente}`).not.toContain(String(e[campo]));
      }
    }
  });

  test('19. resposta ilegível → 422; Bedrock indisponível → 503', async () => {
    modelo.resposta = () => 'Desculpe, não entendi.';
    const ilegivel = await chamar(CHEFE, 'POST', '/api/ia/busca', { corpo: { texto: 'vencidos' } });
    expect(ilegivel.status).toBe(422);
    expect(ilegivel.corpo).toEqual({ erro: 'RESPOSTA_IA_INVALIDA', mensagem: expect.stringMatching(/interpretar/) });
    modelo.resposta = () => {
      throw new ErroIaIndisponivel();
    };
    const fora = await chamar(CHEFE, 'POST', '/api/ia/busca', { corpo: { texto: 'vencidos' } });
    expect(fora.status).toBe(503);
    expect(fora.corpo.erro).toBe('IA_INDISPONIVEL');
    expect(fora.corpo.mensagem).toMatch(/filtros continuam funcionando/);
    expect((await chamar(CHEFE, 'POST', '/api/ia/resumo-dia', { corpo: {} })).status).toBe(503);
  });

  test('20. critérios devolvidos são aceitos pelo painel', async () => {
    const { corpo } = await chamar(SERVIDOR, 'POST', '/api/ia/busca', { corpo: { texto: 'vencidos que vencem esta semana' } });
    const painel = await chamar(SERVIDOR, 'GET', '/api/expedientes', { query: { criterios: JSON.stringify(corpo.criterios), tamanho: '100' } });
    expect(painel.status).toBe(200);
    expect(painel.corpo.itens.every((e: Entidade) => e.siglaSetor === 'GABSUB3-DVT')).toBe(true);
  });

  test('20b. regressão: caixa da IA vira a aba de caixa (aba "No setor" + "a receber" → lista não vazia)', async () => {
    const { corpo } = await chamar(CHEFE, 'POST', '/api/ia/busca', { corpo: { texto: 'processos a receber' } });
    expect(corpo.criterios.caixa).toEqual(['A_RECEBER']);
    const { caixa, ...semCaixa } = corpo.criterios;
    // Como era: a aba "No setor" continuava e a caixa da IA ia junto nos critérios → lista vazia.
    const cruzado = await chamar(CHEFE, 'GET', '/api/expedientes', { query: { caixa: 'NO_SETOR', criterios: JSON.stringify(corpo.criterios) } });
    expect(cruzado.corpo.total).toBe(0);
    // Como o frontend faz agora (separarCriteriosIa): a caixa vira a aba e sai dos critérios.
    const painel = await chamar(CHEFE, 'GET', '/api/expedientes', { query: { caixa: caixa[0], criterios: JSON.stringify(semCaixa) } });
    expect(painel.status).toBe(200);
    expect(painel.corpo.total).toBeGreaterThan(0);
    expect(painel.corpo.total).toBe(painel.corpo.contadoresCaixa.A_RECEBER);
    expect(painel.corpo.itens.every((e: Entidade) => e.caixa === 'A_RECEBER')).toBe(true);
  });

  test('21. resumo como MEMBRO e SERVIDOR: nada de conteúdo de sigiloso nem de outro setor', async () => {
    const ativos = await ativosDe('GABSUB3-DVT');
    const sigilosos = ativos.filter((e) => ehSigiloso(e as Expediente));
    expect(sigilosos.length).toBeGreaterThan(0);
    const naoSigilosos = ativos.filter((e) => !ehSigiloso(e as Expediente));
    const etiquetasOutroSetor = (await ativosDe('CIVINT/STIC')).map((e) => String(e.etiqueta));
    for (const idUsuario of [MEMBRO, SERVIDOR]) {
      modelo.limpar();
      const { status, corpo } = await chamar(idUsuario, 'POST', '/api/ia/resumo-dia', { corpo: {} });
      expect(status).toBe(200);
      expect(corpo).toMatchObject({ origem: 'bedrock', doCache: false });
      expect(typeof corpo.texto).toBe('string');
      expect(typeof corpo.sigilososSemConteudo).toBe('number');
      expect(modelo.pedidos).toHaveLength(1);
      const { mensagem } = modelo.pedidos[0];
      const entrada = JSON.parse(mensagem);
      // Os sigilosos que entraram na fila vão só com etiqueta, prazo e prioridade.
      const etiquetasSigilosas = new Set(sigilosos.map((e) => e.etiqueta));
      expect(entrada.proximos.some((i: { etiqueta: string }) => etiquetasSigilosas.has(i.etiqueta))).toBe(true); // a base põe sigiloso na fila
      expect(entrada.sigilososSemConteudo).toBe(corpo.sigilososSemConteudo);
      for (const item of entrada.proximos) {
        if (etiquetasSigilosas.has(item.etiqueta)) expect(Object.keys(item).sort()).toEqual(['etiqueta', 'prioridade', 'sigiloso', 'statusPrazo']);
      }
      // Nenhum texto de conteúdo de sigiloso aparece; motivoUrgencia só conta se não for também de um item não sigiloso enviado.
      const motivosLegitimos = entrada.proximos.flatMap((i: { motivos?: string[] }) => i.motivos ?? []).join('|');
      for (const e of sigilosos) {
        for (const campo of ['assunto', 'resumo', 'tema']) {
          if (e[campo]) expect(mensagem, `${campo} de ${e.idExpediente}`).not.toContain(String(e[campo]));
        }
        if (e.motivoUrgencia && e.motivoUrgencia !== 'Nenhum' && !motivosLegitimos.includes(e.motivoUrgencia)) {
          expect(mensagem).not.toContain(String(e.motivoUrgencia));
        }
      }
      // Nada de conteúdo, nomes ou ids de nenhum expediente (lista branca do resumo).
      for (const e of naoSigilosos.slice(0, 200)) {
        if (e.resumo) expect(mensagem).not.toContain(String(e.resumo));
        if (e.numeroReferencia) expect(mensagem).not.toContain(String(e.numeroReferencia));
      }
      expect(mensagem).not.toMatch(/Ana Exemplo|Carla Modelo|GABSUB3-DVT-U|EXP0/);
      for (const etiqueta of etiquetasOutroSetor) expect(mensagem).not.toContain(etiqueta);
    }
  });

  test('22. resumo repetido usa o cache', async () => {
    const primeiro = await chamar(CHEFE, 'POST', '/api/ia/resumo-dia', { corpo: {} });
    const segundo = await chamar(CHEFE, 'POST', '/api/ia/resumo-dia');
    expect(primeiro.corpo.doCache).toBe(false);
    expect(segundo.status).toBe(200);
    expect(segundo.corpo.doCache).toBe(true);
    expect(segundo.corpo.texto).toBe(primeiro.corpo.texto);
    expect(modelo.pedidos).toHaveLength(1);
  });

  test('23. widget resumoIa na tela inicial e nas preferências', async () => {
    const { corpo } = await chamar(CHEFE, 'GET', '/api/inicio');
    expect(corpo.widgets.map((w: { id: string }) => w.id)).toContain('resumoIa');
    const salvo = await chamar(CHEFE, 'PUT', '/api/preferencias/INICIO', {
      corpo: { widgets: [{ id: 'resumoIa', visivel: true }, { id: 'contadores', visivel: true }] },
    });
    expect(salvo.status).toBe(200);
    expect(salvo.corpo.widgets[0]).toEqual({ id: 'resumoIa', visivel: true });
  });
});
