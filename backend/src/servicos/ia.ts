// Adaptadores de modelo de linguagem (Amazon Bedrock ou modo demonstração), cache curto e orquestração da busca
// em linguagem natural e do resumo do dia. Nenhum log leva prompt, resposta ou mensagem do SDK.

import { createHash } from 'node:crypto';
import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import {
  datasDeReferencia, descreverCriterios, interpretarRespostaBusca, interpretarRespostaResumo, montarEntradaResumo,
  montarPedidoBusca, montarPedidoResumo, type ChipCriterio, type ContextoBusca, type EntradaResumo, type PedidoModelo,
} from '../dominio/ia.js';
import { ErroIaIndisponivel } from '../dominio/erros.js';
import { CAIXAS_ATIVAS, isoLocal, rotuloPrazo } from '../dominio/regras.js';
import { ativosVisiveis, contadoresPorGerenciador, fila, gerenciadoresDoSetor } from './painel.js';
import type { Criterios } from '../dominio/criterios.js';
import type { Repositorio } from '../dados/repositorio.js';
import type { Setor, Usuario } from '../dominio/tipos.js';

export interface ModeloLinguagem {
  gerar(pedido: PedidoModelo): Promise<string>;
}

export type OrigemIa = 'bedrock' | 'demonstracao';

export interface Ia {
  modelo: ModeloLinguagem;
  origem: OrigemIa;
  cache?: CacheCurto<ResumoDiaIa>;
}

/** Parte do cliente do Bedrock Runtime que usamos (permite injetar um cliente falso nos testes). */
export interface ClienteConverse {
  send(comando: ConverseCommand, opcoes?: { abortSignal?: AbortSignal }): Promise<ConverseCommandOutput>;
}

const MENSAGEM_NAO_HABILITADO = 'O modelo de IA não está habilitado para esta conta. A pesquisa e os filtros continuam funcionando.';
const MENSAGEM_LIMITE = 'Muitas solicitações à IA agora. Tente de novo em instantes.';
const ERROS_NAO_HABILITADO = ['AccessDeniedException', 'ResourceNotFoundException', 'ValidationException'];
const ERROS_LIMITE = ['ThrottlingException', 'ServiceQuotaExceededException'];

/** Amazon Bedrock via Converse (sem streaming): autorizado pela ação bedrock:InvokeModel. */
export class ModeloBedrock implements ModeloLinguagem {
  readonly modelId: string;
  private readonly timeoutMs: number;
  private readonly cliente: ClienteConverse;

  constructor(opcoes: { modelId: string; regiao?: string; timeoutMs?: number; cliente?: ClienteConverse }) {
    this.modelId = opcoes.modelId;
    this.timeoutMs = opcoes.timeoutMs && opcoes.timeoutMs > 0 ? opcoes.timeoutMs : 10000;
    this.cliente = opcoes.cliente ?? new BedrockRuntimeClient({ region: opcoes.regiao ?? 'us-east-1', maxAttempts: 2 });
  }

  async gerar(pedido: PedidoModelo): Promise<string> {
    const comando = new ConverseCommand({
      modelId: this.modelId,
      system: [{ text: pedido.sistema }],
      messages: [{ role: 'user', content: [{ text: pedido.mensagem }] }],
      inferenceConfig: { maxTokens: pedido.maxTokens, temperature: pedido.temperatura, topP: 0.9 },
    });
    let saida: ConverseCommandOutput;
    try {
      saida = await this.cliente.send(comando, { abortSignal: AbortSignal.timeout(this.timeoutMs) });
    } catch (erro) {
      const tipo = erro instanceof Error ? erro.name : 'Desconhecido';
      // Só o tipo do erro: a mensagem do SDK pode repetir trechos do pedido.
      console.warn(JSON.stringify({ nivel: 'AVISO', origem: 'bedrock', tipo }));
      if (ERROS_NAO_HABILITADO.includes(tipo)) throw new ErroIaIndisponivel(MENSAGEM_NAO_HABILITADO);
      if (ERROS_LIMITE.includes(tipo)) throw new ErroIaIndisponivel(MENSAGEM_LIMITE);
      throw new ErroIaIndisponivel();
    }
    return (saida.output?.message?.content ?? []).map((bloco) => bloco.text ?? '').join('');
  }
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const escaparRegex = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Modo demonstração: regras fixas, sem rede, para rodar a demo e os testes sem credenciais. A resposta passa pela
 * mesma conferência da resposta do Bedrock.
 */
export class ModeloDemonstracao implements ModeloLinguagem {
  async gerar(pedido: PedidoModelo): Promise<string> {
    return pedido.tarefa === 'BUSCA' ? this.busca(pedido.mensagem) : this.resumo(pedido.mensagem);
  }

  private busca(mensagem: string): string {
    const { contexto, pedido } = JSON.parse(mensagem) as { contexto: ContextoBusca; pedido: string };
    const t = normalizar(pedido);
    const c: Criterios = {};
    if (/reu(s)? pres/.test(t)) c.reuPreso = true;
    if (/idos[oa]/.test(t)) c.idoso = true;
    if (/urgente/.test(t)) c.urgente = true;
    if (/nova(s)? intima/.test(t)) c.novaIntimacao = true;
    if (/sigilos/.test(t)) c.sigiloso = true;
    if (/favorit/.test(t)) c.favorito = true;
    const status: string[] = [];
    if (/vencid/.test(t)) status.push('VENCIDO');
    if (/vence(m)? hoje/.test(t)) status.push('VENCE_HOJE');
    if (status.length) c.statusPrazo = status;
    if (/esta semana/.test(t)) {
      c.dataPrazoMin = contexto.datas.hoje;
      c.dataPrazoMax = contexto.datas.fimDaSemana;
    } else if (/este mes/.test(t)) {
      c.dataPrazoMax = contexto.datas.fimDoMes;
    }
    const gerenciadores = [
      ['EXTRAJUDICIAL', /extrajudicia/], ['JUDICIAL', /(^|[^a-z])judicia/], ['DOCUMENTO', /documento/],
    ] as const;
    const achados = gerenciadores.filter(([g, re]) => re.test(t) && contexto.gerenciadores.includes(g)).map(([g]) => g);
    if (achados.length) c.gerenciador = achados;
    const parado = /parad[oa]s? (?:ha )?(?:mais de )?(\d{1,4}) dias/.exec(t);
    if (parado) c.tempoParadoDiasMin = Number(parado[1]);
    const prioridade = /prioridade (critica|alta)/.exec(t);
    if (prioridade) c.prioridade = [prioridade[1].toUpperCase()];
    if (/a receber/.test(t) && contexto.caixas.includes('A_RECEBER')) c.caixa = ['A_RECEBER'];
    if (/designad/.test(t) && /(a mim|meus|minhas)/.test(t)) {
      c.idResponsavel = '$USUARIO';
      c.tipoResponsabilidade = 'DESIGNADO';
    } else {
      const pessoa = contexto.responsaveis.find((r) => {
        const primeiroNome = normalizar(r.nome.split(/\s+/)[0] ?? '');
        return primeiroNome && new RegExp(`(^|[^a-z])${escaparRegex(primeiroNome)}([^a-z]|$)`).test(t);
      });
      if (pessoa) c.idResponsavel = [pessoa.idUsuario];
    }
    if (!Object.keys(c).length) c.q = pedido.trim().slice(0, 200);
    return JSON.stringify(c);
  }

  private resumo(mensagem: string): string {
    const entrada = JSON.parse(mensagem) as EntradaResumo;
    const todos = entrada.contadores.TODOS;
    const data = `${entrada.dataReferencia.slice(8, 10)}/${entrada.dataReferencia.slice(5, 7)}/${entrada.dataReferencia.slice(0, 4)}`;
    const frases = [
      `Em ${data}, o setor tem ${todos?.vencidos ?? 0} expediente(s) vencido(s) e ${todos?.venceHoje ?? 0} que vence(m) hoje entre os que exigem ação.`,
      `Há ${todos?.aReceber ?? 0} expediente(s) a receber e ${todos?.urgentes ?? 0} urgente(s).`,
      `Você tem ${entrada.alertasNaoLidos.total} alerta(s) não lido(s), ${entrada.alertasNaoLidos.porSeveridade.CRITICO ?? 0} crítico(s).`,
    ];
    const primeiro = entrada.proximos[0];
    if (primeiro) {
      const prazo = primeiro.statusPrazo ? `, ${rotuloPrazo(primeiro.statusPrazo).toLowerCase()}` : '';
      frases.push(`Comece por ${primeiro.etiqueta}${prazo}.`);
    }
    if (entrada.sigilososSemConteudo) {
      frases.push(`${entrada.sigilososSemConteudo} item(ns) sigiloso(s) da fila entraram só pela etiqueta.`);
    }
    return frases.join(' ');
  }
}

/** Cache em memória da instância, com validade e tamanho máximo (remove o mais antigo). */
export class CacheCurto<T> {
  private readonly itens = new Map<string, { valor: T; expira: number }>();

  constructor(
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly max = 500,
    private readonly relogio: () => number = () => Date.now(),
  ) {}

  obter(chave: string): T | undefined {
    const item = this.itens.get(chave);
    if (!item) return undefined;
    if (item.expira <= this.relogio()) {
      this.itens.delete(chave);
      return undefined;
    }
    return item.valor;
  }

  guardar(chave: string, valor: T): void {
    this.itens.delete(chave);
    while (this.itens.size >= this.max) {
      const maisAntiga = this.itens.keys().next().value;
      if (maisAntiga === undefined) break;
      this.itens.delete(maisAntiga);
    }
    this.itens.set(chave, { valor, expira: this.relogio() + this.ttlMs });
  }

  get tamanho(): number {
    return this.itens.size;
  }
}

/**
 * IA_MODO=fake ou sem BEDROCK_MODEL_ID → modo demonstração. Com BEDROCK_MODEL_ID → Amazon Bedrock na região
 * BEDROCK_REGIAO (ou AWS_REGION), com timeout IA_TIMEOUT_MS (padrão 10 s).
 */
export function criarIa(env: Record<string, string | undefined> = process.env): Ia {
  const cache = new CacheCurto<ResumoDiaIa>();
  const modelId = env.BEDROCK_MODEL_ID?.trim();
  if (env.IA_MODO === 'fake' || !modelId) return { modelo: new ModeloDemonstracao(), origem: 'demonstracao', cache };
  const timeoutMs = Number(env.IA_TIMEOUT_MS ?? 10000);
  return {
    modelo: new ModeloBedrock({
      modelId,
      regiao: env.BEDROCK_REGIAO ?? env.AWS_REGION ?? 'us-east-1',
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 10000,
    }),
    origem: 'bedrock',
    cache,
  };
}

export interface RespostaBuscaIa {
  criterios: Criterios;
  interpretacao: ChipCriterio[];
  descartados: string[];
  origem: OrigemIa;
}

export interface ResumoDiaIa {
  texto: string;
  geradoEm: string;
  origem: OrigemIa;
  itensConsiderados: number;
  sigilososSemConteudo: number;
  doCache: boolean;
}

interface ContextoIa {
  repo: Repositorio;
  usuario: Usuario;
  setor: Setor;
  agora: Date;
}

const unicosOrdenados = (valores: unknown[]) =>
  [...new Set(valores.filter((v): v is string => typeof v === 'string' && v !== ''))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

/** Listas de domínio do setor: catálogos, marcadores e pessoas do próprio setor. Nenhum dado de expediente. */
async function contextoDaBusca(ctx: ContextoIa): Promise<ContextoBusca> {
  const gerenciadores = gerenciadoresDoSetor(ctx.setor);
  const [catalogos, marcadores, pessoas] = await Promise.all([
    ctx.repo.listarCatalogos(),
    ctx.repo.listarMarcadores(ctx.usuario.siglaSetor),
    ctx.repo.listarUsuariosDoSetor(ctx.usuario.siglaSetor),
  ]);
  const doCatalogo = (prefixo: string, campo: 'codigo' | 'descricao') =>
    unicosOrdenados(gerenciadores.flatMap((g) => (catalogos[`${prefixo}_${g}`] ?? []).map((i) => i[campo])));
  return {
    datas: datasDeReferencia(ctx.agora),
    gerenciadores: [...gerenciadores],
    caixas: [...CAIXAS_ATIVAS],
    situacoes: unicosOrdenados((catalogos.SITUACAO ?? []).map((i) => i.codigo)),
    assuntos: doCatalogo('ASSUNTO', 'descricao'),
    classes: doCatalogo('CLASSE', 'codigo'),
    temas: doCatalogo('TEMA', 'descricao'),
    marcadores: unicosOrdenados(marcadores.map((m) => m.descricao)),
    responsaveis: pessoas
      .filter((p) => p.siglaSetor === ctx.usuario.siglaSetor)
      .map((p) => ({ idUsuario: String(p.idUsuario), nome: String(p.nome) })),
  };
}

/** Busca em linguagem natural: texto → critérios do painel (o filtro em si é aplicado pela rota do painel). */
export async function buscarComIa(ia: Ia, ctx: ContextoIa, texto: string): Promise<RespostaBuscaIa> {
  const contexto = await contextoDaBusca(ctx);
  const bruto = await ia.modelo.gerar(montarPedidoBusca(texto, contexto));
  const { criterios, descartados } = interpretarRespostaBusca(bruto, contexto);
  return { criterios, interpretacao: descreverCriterios(criterios, contexto), descartados, origem: ia.origem };
}

/** Resumo do dia a partir dos ativos visíveis do setor (já escopados e mascarados) e dos alertas não lidos. */
export async function resumoDoDiaComIa(ia: Ia, ctx: ContextoIa): Promise<ResumoDiaIa> {
  const { repo, usuario, setor, agora } = ctx;
  const agoraIso = isoLocal(agora);
  const [ativos, notificacoes] = await Promise.all([
    ativosVisiveis(repo, usuario, agora),
    repo.listarNotificacoes(usuario.idUsuario),
  ]);
  const entrada = montarEntradaResumo({
    agora,
    perfil: usuario.perfil,
    contadores: contadoresPorGerenciador(ativos, usuario, gerenciadoresDoSetor(setor)),
    notificacoesNaoLidas: notificacoes.filter((n) => !n.lida && n.dataHora <= agoraIso),
    fila: fila(ativos),
  });
  const chave = `${usuario.idUsuario}:${createHash('sha256').update(JSON.stringify(entrada)).digest('hex')}`;
  const guardado = ia.cache?.obter(chave);
  if (guardado) return { ...guardado, doCache: true };
  const texto = interpretarRespostaResumo(await ia.modelo.gerar(montarPedidoResumo(entrada)));
  const resumo: ResumoDiaIa = {
    texto,
    geradoEm: agoraIso,
    origem: ia.origem,
    itensConsiderados: entrada.proximos.length,
    sigilososSemConteudo: entrada.sigilososSemConteudo,
    doCache: false,
  };
  ia.cache?.guardar(chave, resumo);
  return resumo;
}

/** Usado só para o log de início do servidor local. */
export function descreverIa(ia: Ia): string {
  return ia.modelo instanceof ModeloBedrock
    ? `IA: Bedrock (${ia.modelo.modelId})`
    : 'IA: modo demonstração (defina BEDROCK_MODEL_ID e credenciais para usar o Bedrock)';
}
