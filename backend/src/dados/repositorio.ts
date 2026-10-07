// Padrões de acesso do README (único módulo que conhece as chaves das consultas).
// Todas as leituras são Query por chave de partição (+ begins_with); nenhuma usa Scan.

import { paraItem, semChaves } from './chaves.js';
import type { Operacao, Tabela } from './tabela.js';
import { abreviacaoGerenciador, recalcular } from '../dominio/regras.js';
import type { Entidade, Expediente, Setor, Usuario } from '../dominio/tipos.js';

export const DOMINIOS_CATALOGO = Object.freeze([
  'GERENCIADOR', 'CAIXA', 'SITUACAO', 'STATUS_PRAZO', 'PRIORIDADE', 'SEVERIDADE', 'TIPO_PRAZO', 'TIPO_MOVIMENTACAO',
  'TIPO_NOTIFICACAO', 'TIPO_ACAO_LOTE', 'CLASSE_JUDICIAL', 'CLASSE_DOCUMENTO', 'CLASSE_EXTRAJUDICIAL',
  'ASSUNTO_JUDICIAL', 'ASSUNTO_DOCUMENTO', 'ASSUNTO_EXTRAJUDICIAL', 'TEMA_JUDICIAL', 'TEMA_DOCUMENTO', 'TEMA_EXTRAJUDICIAL',
]);

export interface DetalheExpediente {
  expediente: Expediente;
  movimentacoes: Entidade[];
  prazos: Entidade[];
  designacoes: Entidade[];
  anotacoes: Entidade[];
  marcadores: Entidade[];
}

export class Repositorio {
  constructor(private readonly tabela: Tabela) {}

  private async lista<T extends Entidade = Entidade>(consulta: Parameters<Tabela['consultar']>[0]): Promise<T[]> {
    return (await this.tabela.consultar(consulta)).map((i) => semChaves(i) as T);
  }

  // ---------- usuários e setores ----------

  async obterUsuario(idUsuario: string): Promise<Usuario | null> {
    return semChaves(await this.tabela.obter(`USR#${idUsuario}`, 'PERFIL')) as Usuario | null;
  }

  async obterSetor(sigla: string): Promise<Setor | null> {
    return semChaves(await this.tabela.obter(`SETOR#${sigla}`, 'PERFIL')) as Setor | null;
  }

  async listarUsuariosDoSetor(sigla: string): Promise<Usuario[]> {
    return this.lista<Usuario>({ indice: 'GSI1', pk: `SETOR#${sigla}`, prefixo: 'USR#' });
  }

  // ---------- expedientes ----------

  /** Ativos do setor (GSI1 ATIVO#), recalculados pela data de referência. */
  async listarAtivos(sigla: string, agora: Date, gerenciador?: string): Promise<Expediente[]> {
    const prefixo = gerenciador ? `ATIVO#${abreviacaoGerenciador(gerenciador)}#` : 'ATIVO#';
    const itens = await this.lista<Expediente>({ indice: 'GSI1', pk: `SETOR#${sigla}`, prefixo });
    return itens.map((e) => recalcular(e, agora));
  }

  /** Fila por prazo e prioridade (GSI2). Inclui só o que exige ação. */
  async listarFila(sigla: string, agora: Date): Promise<Expediente[]> {
    const itens = await this.lista<Expediente>({ indice: 'GSI2', pk: `SETOR#${sigla}`, prefixo: 'PRAZO#' });
    return itens.map((e) => recalcular(e, agora)).filter((e) => e.requerAcao);
  }

  async obterExpediente(idExpediente: string, agora: Date): Promise<Expediente | null> {
    const item = semChaves(await this.tabela.obter(`EXP#${idExpediente}`, 'META')) as Expediente | null;
    return item ? recalcular(item, agora) : null;
  }

  /** Detalhe completo: META, MOV#, PRZ#, DES#, ANO#, ROT# numa só Query. */
  async obterDetalhe(idExpediente: string, agora: Date): Promise<DetalheExpediente | null> {
    const itens = await this.tabela.consultar({ pk: `EXP#${idExpediente}` });
    const grupo = (prefixo: string) => itens.filter((i) => String(i.SK).startsWith(prefixo)).map(semChaves);
    const meta = itens.find((i) => i.SK === 'META');
    if (!meta) return null;
    return {
      expediente: recalcular(semChaves(meta) as Expediente, agora),
      movimentacoes: grupo('MOV#'),
      prazos: grupo('PRZ#'),
      designacoes: grupo('DES#'),
      anotacoes: grupo('ANO#'),
      marcadores: grupo('ROT#'),
    };
  }

  async designacoesAtivasDoExpediente(idExpediente: string): Promise<Entidade[]> {
    const itens = await this.lista({ pk: `EXP#${idExpediente}`, prefixo: 'DES#' });
    return itens.filter((d) => d.situacao === 'ATIVA');
  }

  async designacoesAtivasDoUsuario(idUsuario: string): Promise<Entidade[]> {
    return this.lista({ indice: 'GSI1', pk: `USR#${idUsuario}`, prefixo: 'DES#ATIVA#' });
  }

  // ---------- setor ----------

  async listarMarcadores(sigla: string): Promise<Entidade[]> {
    return this.lista({ pk: `SETOR#${sigla}`, prefixo: 'ROT#' });
  }

  async listarEstoque(sigla: string): Promise<Entidade[]> {
    return this.lista({ pk: `SETOR#${sigla}`, prefixo: 'EST#' });
  }

  async listarProdutividade(sigla: string, desde?: string): Promise<Entidade[]> {
    // SK = PROD#<data>#…; a série tem 90 dias por setor, então o recorte por data é feito aqui.
    const itens = await this.lista({ pk: `SETOR#${sigla}`, prefixo: 'PROD#' });
    return desde ? itens.filter((p) => p.data >= desde) : itens;
  }

  async listarLotesDoSetor(sigla: string, limite = 100): Promise<Entidade[]> {
    return this.lista({ indice: 'GSI1', pk: `SETOR#${sigla}`, prefixo: 'LOTE#', decrescente: true, limite });
  }

  // ---------- usuário ----------

  async listarNotificacoes(idUsuario: string): Promise<Entidade[]> {
    return this.lista({ pk: `USR#${idUsuario}`, prefixo: 'NOT#', decrescente: true });
  }

  async obterPreferencias(idUsuario: string, contexto: string): Promise<Entidade | null> {
    return semChaves(await this.tabela.obter(`USR#${idUsuario}`, `PREF#${contexto}`));
  }

  async listarFiltros(idUsuario: string): Promise<Entidade[]> {
    return this.lista({ pk: `USR#${idUsuario}`, prefixo: 'FILTRO#' });
  }

  async obterFiltro(idUsuario: string, idFiltro: string): Promise<Entidade | null> {
    return semChaves(await this.tabela.obter(`USR#${idUsuario}`, `FILTRO#${idFiltro}`));
  }

  async excluirFiltro(idUsuario: string, idFiltro: string): Promise<void> {
    await this.tabela.gravar([{ delete: { PK: `USR#${idUsuario}`, SK: `FILTRO#${idFiltro}` } }]);
  }

  async listarLotesDoUsuario(idUsuario: string): Promise<Entidade[]> {
    return this.lista({ pk: `USR#${idUsuario}`, prefixo: 'LOTE#', decrescente: true });
  }

  /** Imagens anteriores gravadas pelo lote (com as chaves, para restaurar). */
  async listarDesfazer(idLote: string): Promise<Entidade[]> {
    return this.tabela.consultar({ pk: `LOTE#${idLote}`, prefixo: 'UNDO#' });
  }

  // ---------- conteúdo geral ----------

  async listarNoticias(): Promise<Entidade[]> {
    return this.lista({ pk: 'NOTICIA' });
  }

  async listarCatalogos(): Promise<Record<string, Entidade[]>> {
    const pares = await Promise.all(DOMINIOS_CATALOGO.map(async (dominio) => {
      const itens = await this.lista({ pk: `CATALOGO#${dominio}` });
      return [dominio, itens.map(({ codigo, descricao, ordem, cor }) => ({ codigo, descricao, ordem, cor }))] as const;
    }));
    return Object.fromEntries(pares);
  }

  // ---------- gravação ----------

  /** Item cru (com chaves), usado para guardar a imagem anterior no desfazer. */
  async obterItemCru(pk: string, sk: string): Promise<Entidade | null> {
    return this.tabela.obter(pk, sk);
  }

  /** Recalcula o expediente e devolve o item com as chaves de índice atualizadas. */
  itemExpediente(expediente: Expediente, agora: Date): Entidade {
    return paraItem({ ...recalcular(expediente, agora), entidade: 'expedientes' });
  }

  async salvar(entidades: Entidade[]): Promise<void> {
    await this.tabela.gravar(entidades.map((e) => ({ put: paraItem(e) })));
  }

  async gravarItens(operacoes: Operacao[]): Promise<void> {
    await this.tabela.gravar(operacoes);
  }
}
