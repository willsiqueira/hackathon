// Testes de API sobre a base sintética completa (tabela em memória), incluindo negações de acesso.

import { beforeAll, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { criarApi } from '../src/api/roteador.js';
import { EmissorTokenLocal, identidadeDasClaims } from '../src/api/autenticacao.js';
import { Repositorio } from '../src/dados/repositorio.js';
import { TabelaMemoria, carregarItensJson } from '../src/dados/tabela-memoria.js';
import { ErroNaoAutenticado } from '../src/dominio/erros.js';
import { TEXTO_RESTRITO } from '../src/dominio/acesso.js';
import { compararFila } from '../src/dominio/regras.js';
import { publicadorEmProcesso } from '../src/eventos/notificador.js';
import type { EventoDominio } from '../src/eventos/eventos.js';
import type { Entidade } from '../src/dominio/tipos.js';

const ITENS = fileURLToPath(new URL('../../docs/hackathon-expedientes/seed/saida/dynamodb/itens.json', import.meta.url));
const AGORA = new Date('2026-10-07T17:00:00-03:00');
const MEMBRO = 'GABSUB3-DVT-U01';
const CHEFE = 'GABSUB3-DVT-U02';
const SERVIDOR = 'GABSUB3-DVT-U03';
const OUTRO_SETOR = 'CIVINT-STIC-U02';

let tabela: TabelaMemoria;
let tratar: ReturnType<typeof criarApi>;
const publicados: EventoDominio[] = [];

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
  const ehJson = resposta.cabecalhos['Content-Type']?.startsWith('application/json');
  return { status: resposta.status, corpo: ehJson ? JSON.parse(resposta.corpo) : resposta.corpo, cabecalhos: resposta.cabecalhos };
}

const metaDe = (id: string) => tabela.obter(`EXP#${id}`, 'META') as Promise<Entidade>;

async function expedientesDoSetor(sigla: string, filtro: (e: Entidade) => boolean) {
  const itens = await tabela.consultar({ indice: 'GSI1', pk: `SETOR#${sigla}`, prefixo: 'ATIVO#' });
  return itens.filter(filtro);
}

beforeAll(async () => {
  tabela = await carregarItensJson(new TabelaMemoria(), ITENS);
  const repo = new Repositorio(tabela);
  const emProcesso = publicadorEmProcesso(repo);
  tratar = criarApi({
    repo,
    relogio: () => AGORA,
    registrar: () => {},
    eventos: { publicar: async (eventos) => { publicados.push(...eventos); await emProcesso.publicar(eventos); } },
  });
});

describe('Autenticação e autorização', () => {
  test('sem identidade → 401 (inclusive em rota inexistente)', async () => {
    expect((await chamar(null, 'GET', '/api/expedientes')).status).toBe(401);
    expect((await chamar(null, 'GET', '/api/nao-existe')).status).toBe(401);
  });

  test('claims do Cognito sem custom:idUsuario → 401', () => {
    const evento = { requestContext: { authorizer: { claims: { sub: 'x' } } } } as unknown as APIGatewayProxyEvent;
    expect(() => identidadeDasClaims(evento.requestContext.authorizer?.claims)).toThrow(ErroNaoAutenticado);
    expect(identidadeDasClaims({ 'custom:idUsuario': CHEFE })).toEqual({ idUsuario: CHEFE });
  });

  test('setor e perfil vêm das claims; divergência com o cadastro → 403', async () => {
    expect(identidadeDasClaims({ 'custom:idUsuario': CHEFE, 'custom:siglaSetor': 'GABSUB3-DVT', 'cognito:groups': '[CHEFE]' }))
      .toEqual({ idUsuario: CHEFE, siglaSetor: 'GABSUB3-DVT', perfil: 'CHEFE' });
    const forjado = await tratar({
      metodo: 'GET', caminho: '/api/me', obterIdentidade: () => ({ idUsuario: SERVIDOR, siglaSetor: 'GABSUB3-DVT', perfil: 'CHEFE' }),
    });
    expect(forjado.status).toBe(403);
    const outroSetor = await tratar({
      metodo: 'GET', caminho: '/api/me', obterIdentidade: () => ({ idUsuario: SERVIDOR, siglaSetor: 'CIVINT/STIC' }),
    });
    expect(outroSetor.status).toBe(403);
    expect(() => identidadeDasClaims({ 'custom:idUsuario': CHEFE, 'cognito:groups': 'CHEFE,MEMBRO' })).toThrow(/mais de um perfil/);
  });

  test('token local: assinatura conferida e adulteração recusada', () => {
    const emissor = new EmissorTokenLocal();
    const token = emissor.emitir({ idUsuario: CHEFE, siglaSetor: 'GABSUB3-DVT', perfil: 'CHEFE' });
    expect(emissor.verificar(token)).toEqual({ idUsuario: CHEFE, siglaSetor: 'GABSUB3-DVT', perfil: 'CHEFE' });
    const [conteudo, assinatura] = token.split('.');
    const trocado = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(conteudo, 'base64url').toString()), perfil: 'MEMBRO' })).toString('base64url');
    expect(() => emissor.verificar(`${trocado}.${assinatura}`)).toThrow(ErroNaoAutenticado);
    expect(() => new EmissorTokenLocal().verificar(token)).toThrow(ErroNaoAutenticado);
  });

  test('usuário desconhecido → 401', async () => {
    expect((await chamar('NINGUEM', 'GET', '/api/me')).status).toBe(401);
  });

  test('/api/me devolve setor e perfil do cadastro', async () => {
    const { status, corpo } = await chamar(CHEFE, 'GET', '/api/me');
    expect(status).toBe(200);
    expect(corpo.usuario.perfil).toBe('CHEFE');
    expect(corpo.setor.gerenciadores).toEqual(['JUDICIAL', 'DOCUMENTO', 'EXTRAJUDICIAL']);
  });

  test('expediente de outro setor → 403 (detalhe e histórico)', async () => {
    const [deOutro] = await expedientesDoSetor('GABSUB3-DVT', () => true);
    expect((await chamar(OUTRO_SETOR, 'GET', `/api/expedientes/${deOutro.idExpediente}`)).status).toBe(403);
    expect((await chamar(OUTRO_SETOR, 'GET', `/api/expedientes/${deOutro.idExpediente}/historico.csv`)).status).toBe(403);
  });

  test('gerenciador que o setor não usa → 400; id malicioso → 400', async () => {
    expect((await chamar(OUTRO_SETOR, 'GET', '/api/expedientes', { query: { gerenciador: 'JUDICIAL' } })).status).toBe(400);
    expect((await chamar(MEMBRO, 'GET', '/api/expedientes/EXP%23META')).status).toBe(400);
  });
});

describe('Painel e tela inicial', () => {
  test('lista só ativos, com contadores por caixa iguais aos da base (RN7)', async () => {
    const { status, corpo } = await chamar(MEMBRO, 'GET', '/api/expedientes', { query: { tamanho: '100' } });
    expect(status).toBe(200);
    expect(corpo.contadoresCaixa).toEqual({ A_RECEBER: 20, NO_SETOR: 389, ENVIADO_NAO_RECEBIDO: 5 });
    expect(corpo.total).toBe(414);
    expect(corpo.itens.every((e: Entidade) => e.caixa !== 'BAIXADO')).toBe(true);
  });

  test('ordem padrão é a fila (RN3)', async () => {
    const { corpo } = await chamar(MEMBRO, 'GET', '/api/expedientes', { query: { tamanho: '100', caixa: 'NO_SETOR' } });
    expect(corpo.itens.map((e: Entidade) => e.idExpediente)).toEqual([...corpo.itens].sort(compararFila).map((e: Entidade) => e.idExpediente));
  });

  test('aba judicial com filtros combinados', async () => {
    const criterios = JSON.stringify({ statusPrazo: ['VENCIDO', 'VENCE_HOJE', 'CRITICO'] });
    const { corpo } = await chamar(MEMBRO, 'GET', '/api/expedientes', { query: { gerenciador: 'JUDICIAL', criterios, tamanho: '100' } });
    expect(corpo.total).toBeGreaterThan(0);
    expect(corpo.itens.every((e: Entidade) => e.gerenciador === 'JUDICIAL' && ['VENCIDO', 'VENCE_HOJE', 'CRITICO'].includes(e.statusPrazo))).toBe(true);
  });

  test('filtro por chave técnica → 400', async () => {
    expect((await chamar(MEMBRO, 'GET', '/api/expedientes', { query: { criterios: '{"PK":"x"}' } })).status).toBe(400);
  });

  test('contadores recalculados batem com contadores.csv', async () => {
    const { corpo } = await chamar(MEMBRO, 'GET', '/api/inicio');
    expect(corpo.contadores.TODOS).toMatchObject({ aReceber: 20, noSetor: 389, vencidos: 50, venceHoje: 24 });
    expect(corpo.contadores.JUDICIAL.urgentes).toBe(8);
    expect(corpo.proximosPrazos.every((e: Entidade) => e.diasRestantes >= 0)).toBe(true);
    expect(corpo.widgets.length).toBeGreaterThanOrEqual(5);
  });
});

describe('Sigilo (RN6)', () => {
  let sigiloso: Entidade;

  beforeAll(async () => {
    [sigiloso] = await expedientesDoSetor('GABSUB3-DVT', (e) => e.nivelSigilo > 0 && e.idResponsavel !== SERVIDOR);
    expect(sigiloso).toBeDefined();
  });

  test('servidor não responsável vê o item sem conteúdo, na lista e no detalhe', async () => {
    const lista = await chamar(SERVIDOR, 'GET', '/api/expedientes', { query: { q: sigiloso.etiqueta } });
    expect(lista.corpo.itens[0].assunto).toBe(TEXTO_RESTRITO);
    const detalhe = await chamar(SERVIDOR, 'GET', `/api/expedientes/${sigiloso.idExpediente}`);
    expect(detalhe.status).toBe(200);
    expect(detalhe.corpo.expediente).toMatchObject({ conteudoRestrito: true, resumo: TEXTO_RESTRITO });
    expect(detalhe.corpo.anotacoes).toEqual([]);
  });

  test('filtrar pelo assunto real não revela o sigiloso ao servidor', async () => {
    const criterios = JSON.stringify({ assunto: [sigiloso.assunto] });
    const { corpo } = await chamar(SERVIDOR, 'GET', '/api/expedientes', { query: { criterios, tamanho: '100' } });
    expect(corpo.itens.some((e: Entidade) => e.idExpediente === sigiloso.idExpediente)).toBe(false);
  });

  test('membro vê o conteúdo, mas CSV, histórico e ICS saem mascarados', async () => {
    const detalhe = await chamar(MEMBRO, 'GET', `/api/expedientes/${sigiloso.idExpediente}`);
    expect(detalhe.corpo.expediente.assunto).toBe(sigiloso.assunto);
    const csv = await chamar(MEMBRO, 'GET', '/api/expedientes/exportar', { query: { q: sigiloso.etiqueta } });
    expect(csv.cabecalhos['Content-Type']).toMatch(/text\/csv/);
    expect(csv.corpo).toContain(TEXTO_RESTRITO);
    expect(csv.corpo).not.toContain(sigiloso.resumo);
    const historico = await chamar(MEMBRO, 'GET', `/api/expedientes/${sigiloso.idExpediente}/historico.csv`);
    expect(historico.corpo).toContain('Descrição restrita');
    const ics = await chamar(MEMBRO, 'GET', '/api/prazos.ics');
    expect(ics.corpo).toMatch(/BEGIN:VCALENDAR/);
    expect(ics.corpo).not.toContain(sigiloso.resumo);
  });
});

describe('Ações em lote', () => {
  test('prévia de RECEBER ignora o que está No setor, com motivo, sem gravar', async () => {
    const [aReceber] = await expedientesDoSetor('GABSUB3-DVT', (e) => e.caixa === 'A_RECEBER');
    const [noSetor] = await expedientesDoSetor('GABSUB3-DVT', (e) => e.caixa === 'NO_SETOR');
    const { status, corpo } = await chamar(CHEFE, 'POST', '/api/lotes/previa', {
      corpo: { tipoAcao: 'RECEBER', ids: [aReceber.idExpediente, noSetor.idExpediente] },
    });
    expect(status).toBe(200);
    expect(corpo.aplicaveis.map((a: Entidade) => a.idExpediente)).toEqual([aReceber.idExpediente]);
    expect(corpo.ignorados[0]).toMatchObject({ idExpediente: noSetor.idExpediente, motivo: expect.stringMatching(/A receber/) });
    expect((await metaDe(aReceber.idExpediente)).caixa).toBe('A_RECEBER');
  });

  test('não revela dados de expediente de outro setor na prévia', async () => {
    const [deOutro] = await expedientesDoSetor('CIVINT/STIC', () => true);
    const { corpo } = await chamar(CHEFE, 'POST', '/api/lotes/previa', { corpo: { tipoAcao: 'RECEBER', ids: [deOutro.idExpediente] } });
    expect(Object.keys(corpo.ignorados[0]).sort()).toEqual(['idExpediente', 'motivo']);
  });

  test('corpo inválido → 400', async () => {
    expect((await chamar(CHEFE, 'POST', '/api/lotes', { corpo: { tipoAcao: 'RECEBER', ids: 'tudo' } })).status).toBe(400);
  });

  test('receber em lote, conferir índices e desfazer', async () => {
    const alvos = (await expedientesDoSetor('GABSUB3-DVT', (e) => e.caixa === 'A_RECEBER' && e.gerenciador === 'JUDICIAL')).slice(0, 3);
    const ids = alvos.map((e) => e.idExpediente);
    const execucao = await chamar(CHEFE, 'POST', '/api/lotes', { corpo: { tipoAcao: 'RECEBER', ids } });
    expect(execucao.status).toBe(201);
    expect(execucao.corpo.aplicados).toHaveLength(3);
    const depois = await metaDe(ids[0]);
    expect(depois.caixa).toBe('NO_SETOR');
    expect(depois.GSI1SK).toMatch(/^ATIVO#JUD#NO_SETOR#/);
    expect((await chamar(CHEFE, 'GET', '/api/expedientes')).corpo.contadoresCaixa.A_RECEBER).toBe(17);
    const historico = await chamar(CHEFE, 'GET', `/api/expedientes/${ids[0]}`);
    expect(historico.corpo.movimentacoes.at(-1).tipoMovimentacao).toBe('RECEBIMENTO');
    expect(publicados.some((e) => e.tipo === 'LoteExecutado' && e.idLote === execucao.corpo.idLote)).toBe(true);

    expect((await chamar(MEMBRO, 'POST', `/api/lotes/${execucao.corpo.idLote}/desfazer`)).status).toBe(403);

    const desfeito = await chamar(CHEFE, 'POST', `/api/lotes/${execucao.corpo.idLote}/desfazer`);
    expect(desfeito.status).toBe(200);
    expect(desfeito.corpo.restaurados).toHaveLength(3);
    expect((await metaDe(ids[0])).caixa).toBe('A_RECEBER');
    const movs = await tabela.consultar({ pk: `EXP#${ids[0]}`, prefixo: 'MOV#' });
    expect(movs.some((m) => m.tipoMovimentacao === 'RECEBIMENTO')).toBe(false);
    expect((await chamar(CHEFE, 'POST', `/api/lotes/${execucao.corpo.idLote}/desfazer`)).status).toBe(409);
  });

  test('desfazer não restaura o que mudou depois do lote', async () => {
    const [alvo] = await expedientesDoSetor('GABSUB3-DVT', (e) => e.caixa === 'A_RECEBER');
    const lote1 = await chamar(CHEFE, 'POST', '/api/lotes', { corpo: { tipoAcao: 'RECEBER', ids: [alvo.idExpediente] } });
    const marcador = (await chamar(CHEFE, 'GET', '/api/marcadores')).corpo.find((m: Entidade) => m.gerenciador === alvo.gerenciador);
    await chamar(CHEFE, 'POST', '/api/lotes', { corpo: { tipoAcao: 'INCLUIR_MARCADOR', ids: [alvo.idExpediente], parametros: { idRotulo: marcador.idRotulo } } });
    const desfeito = await chamar(CHEFE, 'POST', `/api/lotes/${lote1.corpo.idLote}/desfazer`);
    expect(desfeito.corpo.restaurados).toHaveLength(0);
    expect(desfeito.corpo.naoRestaurados).toHaveLength(1);
  });

  test('arquivar ignora quem tem minuta pendente (RN5) e tira do painel (RN7)', async () => {
    const [comMinuta] = await expedientesDoSetor('GABSUB3-DVT', (e) => e.caixa === 'NO_SETOR' && e.qtdMinutasPendentes > 0);
    const [semMinuta] = await expedientesDoSetor('GABSUB3-DVT', (e) => e.caixa === 'NO_SETOR' && e.qtdMinutasPendentes === 0);
    const { corpo } = await chamar(CHEFE, 'POST', '/api/lotes', { corpo: { tipoAcao: 'ARQUIVAR', ids: [comMinuta.idExpediente, semMinuta.idExpediente] } });
    expect(corpo.resultado).toBe('PARCIAL');
    expect(corpo.ignorados[0].motivo).toMatch(/minuta/);
    const meta = await metaDe(semMinuta.idExpediente);
    expect(meta.caixa).toBe('BAIXADO');
    expect(meta.GSI1SK).toMatch(/^HIST#/);
    expect((await chamar(CHEFE, 'GET', '/api/expedientes', { query: { q: semMinuta.etiqueta } })).corpo.total).toBe(0);
  });

  test('designar: servidor recebe 403; chefe distribui e o evento gera o aviso ao designado', async () => {
    const alvos = (await expedientesDoSetor('GABSUB3-DVT', (e) => e.caixa === 'NO_SETOR' && e.tipoResponsabilidade === 'TITULAR')).slice(0, 4);
    const ids = alvos.map((e) => e.idExpediente);
    expect((await chamar(SERVIDOR, 'POST', '/api/lotes/previa', { corpo: { tipoAcao: 'DESIGNAR', ids, parametros: { idUsuarioDesignado: SERVIDOR } } })).status).toBe(403);
    expect((await chamar(SERVIDOR, 'GET', '/api/designacao/sugestao')).status).toBe(403);

    const sugestao = await chamar(CHEFE, 'GET', '/api/designacao/sugestao', { query: { ids: ids.join(',') } });
    expect(sugestao.status).toBe(200);
    expect(sugestao.corpo.cargas.every((c: Entidade) => c.idUsuario.startsWith('GABSUB3-DVT'))).toBe(true);

    const { corpo } = await chamar(CHEFE, 'POST', '/api/lotes', { corpo: { tipoAcao: 'DESIGNAR', ids, parametros: { distribuir: true } } });
    expect(corpo.aplicados).toHaveLength(4);
    const designado = (await metaDe(ids[0])).idResponsavel;
    expect(designado).toBe(sugestao.corpo.distribuicao[ids[0]]);
    expect(publicados.filter((e) => e.tipo === 'ExpedienteDesignado' && ids.includes(e.idExpediente))).toHaveLength(4);
    const avisos = await chamar(designado, 'GET', '/api/notificacoes', { query: { lida: 'false' } });
    expect(avisos.corpo.itens.some((n: Entidade) => n.tipoNotificacao === 'DESIGNACAO' && ids.includes(n.idExpediente))).toBe(true);
  });
});

describe('Filtros salvos e preferências', () => {
  test('criar compartilhado, aparecer para colega, colega não exclui', async () => {
    const criado = await chamar(MEMBRO, 'POST', '/api/filtros', {
      corpo: { nome: 'Judiciais urgentes', criterios: { gerenciador: ['JUDICIAL'], urgente: true }, ordenacao: 'fila', compartilhadoComSetor: true, padrao: true },
    });
    expect(criado.status).toBe(201);
    expect((await chamar(MEMBRO, 'GET', '/api/filtros')).corpo.meus.filter((f: Entidade) => f.padrao)).toHaveLength(1);
    expect((await chamar(CHEFE, 'GET', '/api/filtros')).corpo.compartilhados.some((f: Entidade) => f.idFiltro === criado.corpo.idFiltro)).toBe(true);
    expect((await chamar(CHEFE, 'DELETE', `/api/filtros/${criado.corpo.idFiltro}`)).status).toBe(404);
    expect((await chamar(MEMBRO, 'DELETE', `/api/filtros/${criado.corpo.idFiltro}`)).status).toBe(204);
  });

  test('filtro com critério inválido ou campo extra → 400', async () => {
    expect((await chamar(MEMBRO, 'POST', '/api/filtros', { corpo: { nome: 'x', criterios: { naoExiste: 1 } } })).status).toBe(400);
    expect((await chamar(MEMBRO, 'POST', '/api/filtros', { corpo: { nome: 'x', idUsuario: CHEFE } })).status).toBe(400);
  });

  test('preferências de colunas e widgets', async () => {
    const salvo = await chamar(SERVIDOR, 'PUT', '/api/preferencias/PAINEL_UNIFICADO', {
      corpo: { colunasVisiveis: ['etiqueta', 'statusPrazo', 'prioridade'], itensPorPagina: 50, ordenacao: 'risco:desc' },
    });
    expect(salvo.status).toBe(200);
    expect(salvo.corpo.colunasVisiveis).toEqual(['etiqueta', 'statusPrazo', 'prioridade']);
    const widgets = await chamar(SERVIDOR, 'PUT', '/api/preferencias/INICIO', { corpo: { widgets: [{ id: 'alertas', visivel: true }, { id: 'informes', visivel: false }] } });
    expect(widgets.corpo.widgets[0].id).toBe('alertas');
    expect((await chamar(SERVIDOR, 'PUT', '/api/preferencias/INICIO', { corpo: { widgets: [{ id: 'hack', visivel: true }] } })).status).toBe(400);
  });
});

describe('Indicadores, alertas, fila e resumo', () => {
  test('produtividade por pessoa só para membro e chefe', async () => {
    const membro = await chamar(MEMBRO, 'GET', '/api/indicadores', { query: { dias: '30' } });
    expect(membro.status).toBe(200);
    expect(Array.isArray(membro.corpo.produtividade)).toBe(true);
    expect(membro.corpo.serie).toHaveLength(30);
    expect((await chamar(SERVIDOR, 'GET', '/api/indicadores')).corpo.produtividade).toBeNull();
  });

  test('marcar alertas como lidos', async () => {
    const antes = await chamar(SERVIDOR, 'GET', '/api/notificacoes', { query: { lida: 'false', tamanho: '5' } });
    const ids = antes.corpo.itens.map((n: Entidade) => n.idNotificacao);
    expect((await chamar(SERVIDOR, 'POST', '/api/notificacoes/lidas', { corpo: { ids } })).corpo.atualizadas).toBe(ids.length);
    expect((await chamar(SERVIDOR, 'GET', '/api/notificacoes')).corpo.naoLidas).toBe(antes.corpo.naoLidas - ids.length);
  });

  test('fila em ordem do GSI2, só o que exige ação', async () => {
    const { corpo } = await chamar(MEMBRO, 'GET', '/api/fila', { query: { gerenciador: 'JUDICIAL' } });
    expect(corpo.itens.every((e: Entidade) => ['A_RECEBER', 'NO_SETOR'].includes(e.caixa))).toBe(true);
    expect(corpo.itens.map((e: Entidade) => e.idExpediente)).toEqual([...corpo.itens].sort(compararFila).map((e: Entidade) => e.idExpediente));
  });

  test('prévia do resumo diário não expõe o e-mail', async () => {
    const { status, corpo } = await chamar(SERVIDOR, 'GET', '/api/resumo-diario');
    expect(status).toBe(200);
    expect(corpo.email).toBeUndefined();
    expect(corpo.texto).toMatch(/Vencidos: \d+/);
  });
});
