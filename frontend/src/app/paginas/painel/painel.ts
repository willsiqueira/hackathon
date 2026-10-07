import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AutenticacaoService } from '../../core/autenticacao.service';
import { AvisosService } from '../../core/avisos.service';
import { CatalogoService } from '../../core/catalogo.service';
import { mensagemDeErro } from '../../core/interceptadores';
import type { Criterios, Expediente, FiltroSalvo, Marcador, PessoaSetor, RespostaPainel, ResultadoLote, TipoAcao } from '../../core/modelos';
import { SeloGerenciador, SeloPrazo, SeloPrioridade } from '../../compartilhado/selos';
import { DialogoLote, ROTULO_ACAO, acoesDoPerfil } from '../../compartilhado/dialogo-lote';
import { dataBr, rotuloEnum } from '../../compartilhado/formatos';
import { COLUNAS, normalizarColunas, type Coluna } from './colunas';
import {
  SINALIZACOES, avisoBuscaIaAplicada, caixasEmExtras, contarFiltros, deCriterios, formularioVazio, paraCriterios,
  removerCaixaDeExtras, separarCriteriosIa, type FormularioFiltros,
} from './filtros-painel';
import { BuscaIa } from './busca-ia';

const CAIXAS = [
  { codigo: '', rotulo: 'Todas as caixas' },
  { codigo: 'A_RECEBER', rotulo: 'A receber' },
  { codigo: 'NO_SETOR', rotulo: 'No setor' },
  { codigo: 'ENVIADO_NAO_RECEBIDO', rotulo: 'Enviados não recebidos' },
] as const;
const CODIGOS_CAIXA: string[] = CAIXAS.map((c) => c.codigo).filter(Boolean);

@Component({
  selector: 'app-painel',
  imports: [FormsModule, RouterLink, SeloPrazo, SeloPrioridade, SeloGerenciador, DialogoLote, BuscaIa],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './painel.html',
})
export class PainelPagina implements OnInit {
  private readonly api = inject(ApiService);
  private readonly rota = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly avisos = inject(AvisosService);
  protected readonly catalogo = inject(CatalogoService);
  protected readonly me = inject(AutenticacaoService).me;
  private readonly dialogoLote = viewChild.required(DialogoLote);

  // estado da consulta
  protected readonly gerenciador = signal('TODOS');
  protected readonly caixa = signal('');
  protected busca = '';
  protected filtros: FormularioFiltros = formularioVazio();
  protected readonly ordenacao = signal('fila');
  protected readonly pagina = signal(1);
  protected readonly tamanho = signal(25);
  protected readonly densidade = signal<'CONFORTAVEL' | 'COMPACTA'>('CONFORTAVEL');
  protected readonly colunasVisiveis = signal<string[]>(normalizarColunas(undefined));

  // dados
  protected readonly resposta = signal<RespostaPainel | null>(null);
  protected readonly carregando = signal(false);
  protected readonly pessoas = signal<PessoaSetor[]>([]);
  protected readonly marcadores = signal<Marcador[]>([]);
  protected readonly filtrosSalvos = signal<{ meus: FiltroSalvo[]; compartilhados: FiltroSalvo[] }>({ meus: [], compartilhados: [] });
  protected readonly selecionados = signal<Map<string, Expediente>>(new Map());

  // painéis
  protected readonly mostrarFiltros = signal(false);
  protected readonly mostrarColunas = signal(false);
  protected readonly mostrarSalvar = signal(false);
  protected readonly mostrarBuscaIa = signal(false);
  protected filtroEscolhido = '';
  protected novoFiltro = { nome: '', padrao: false, compartilhadoComSetor: false };

  protected readonly caixas = CAIXAS;
  protected readonly sinalizacoes = SINALIZACOES;
  protected readonly todasColunas = COLUNAS;
  protected readonly rotuloAcao = ROTULO_ACAO;
  protected readonly dataBr = dataBr;
  protected readonly rotuloEnum = rotuloEnum;

  protected readonly abas = computed(() => ['TODOS', ...(this.me()?.setor.gerenciadores ?? [])]);
  protected readonly colunas = computed<Coluna[]>(() =>
    this.colunasVisiveis().map((c) => COLUNAS.find((col) => col.campo === c)).filter((c): c is Coluna => !!c));
  protected readonly acoes = computed<TipoAcao[]>(() => acoesDoPerfil(this.me()?.usuario.perfil));
  protected readonly listaSelecionados = computed(() => [...this.selecionados().values()]);
  protected readonly totalPaginas = computed(() => Math.max(1, Math.ceil((this.resposta()?.total ?? 0) / this.tamanho())));
  protected readonly todosDaPaginaMarcados = computed(() => {
    const itens = this.resposta()?.itens ?? [];
    return itens.length > 0 && itens.every((e) => this.selecionados().has(e.idExpediente));
  });
  protected readonly gerenciadorAtual = computed(() => (this.gerenciador() === 'TODOS' ? null : this.gerenciador()));
  protected readonly assuntos = computed(() => this.opcoesCatalogo('ASSUNTO'));
  protected readonly classes = computed(() => this.opcoesCatalogo('CLASSE'));
  protected readonly temas = computed(() => this.opcoesCatalogo('TEMA'));
  protected readonly marcadoresDisponiveis = computed(() => {
    const g = this.gerenciadorAtual();
    const nomes = this.marcadores().filter((m) => !g || m.gerenciador === g).map((m) => m.descricao);
    return [...new Set(nomes)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  });

  protected qtdFiltros(): number {
    return contarFiltros(this.filtros);
  }

  private opcoesCatalogo(prefixo: string): string[] {
    const g = this.gerenciadorAtual();
    const gerenciadores = g ? [g] : (this.me()?.setor.gerenciadores ?? []);
    const valores = gerenciadores.flatMap((ger) => this.catalogo.itens(`${prefixo}_${ger}`).map((i) => (prefixo === 'CLASSE' ? i.codigo : i.descricao)));
    return [...new Set(valores)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  async ngOnInit(): Promise<void> {
    const q = this.rota.snapshot.queryParamMap;
    const setor = this.me()?.setor;
    // Gabinete começa pelos processos judiciais (foco do caso de uso), salvo pedido explícito.
    const padrao = setor?.tipoSetor === 'GABINETE' && setor.gerenciadores.includes('JUDICIAL') ? 'JUDICIAL' : 'TODOS';
    this.gerenciador.set(q.get('gerenciador') ?? (q.keys.length ? 'TODOS' : padrao));
    this.caixa.set(q.get('caixa') ?? '');
    const criterios = q.get('criterios');
    if (criterios) {
      try {
        this.filtros = deCriterios(JSON.parse(criterios) as Criterios);
      } catch {
        this.filtros = formularioVazio();
      }
    }
    try {
      const [pref, pessoas, marcadores, salvos] = await Promise.all([
        this.api.preferencias('PAINEL_UNIFICADO'),
        this.api.usuarios(),
        this.api.marcadores(),
        this.api.filtros(),
      ]);
      // Colunas e ordenação só se salvas por este painel (as preferências antigas da base não têm "ordenacao").
      if (pref.ordenacao) {
        this.colunasVisiveis.set(normalizarColunas(pref.colunasVisiveis));
        this.ordenacao.set(pref.ordenacao);
      }
      if (pref.itensPorPagina) this.tamanho.set(pref.itensPorPagina);
      if (pref.densidade) this.densidade.set(pref.densidade);
      this.pessoas.set(pessoas);
      this.marcadores.set(marcadores);
      this.filtrosSalvos.set(salvos);
      const idFiltro = q.get('filtro');
      const filtro = [...salvos.meus, ...salvos.compartilhados].find((f) => f.idFiltro === idFiltro)
        ?? (!q.keys.length ? salvos.meus.find((f) => f.padrao) : undefined);
      if (filtro) this.aplicarFiltroSalvo(filtro, false);
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    }
    await this.carregar();
  }

  protected async carregar(anunciar = false): Promise<void> {
    this.carregando.set(true);
    try {
      const r = await this.api.painel({
        gerenciador: this.gerenciadorAtual() ?? undefined,
        caixa: this.caixa() || undefined,
        q: this.busca.trim() || undefined,
        criterios: paraCriterios(this.filtros),
        ordenacao: this.ordenacao(),
        pagina: this.pagina(),
        tamanho: this.tamanho(),
      });
      this.resposta.set(r);
      if (this.pagina() > 1 && !r.itens.length) {
        this.pagina.set(1);
        return this.carregar(anunciar);
      }
      if (anunciar) this.avisos.informar(`${r.total} expediente(s) encontrados.`);
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    } finally {
      this.carregando.set(false);
    }
  }

  private recarregar(): void {
    this.pagina.set(1);
    void this.carregar(true);
  }

  // ---------- abas, busca, filtros ----------

  protected escolherGerenciador(g: string): void {
    this.gerenciador.set(g);
    this.recarregar();
  }

  protected escolherCaixa(c: string): void {
    this.caixa.set(c);
    this.recarregar();
  }

  protected pesquisar(): void {
    this.recarregar();
  }

  protected alternarLista(lista: string[], valor: string): void {
    const i = lista.indexOf(valor);
    if (i >= 0) lista.splice(i, 1);
    else lista.push(valor);
  }

  protected aplicarFiltros(): void {
    this.filtroEscolhido = '';
    this.recarregar();
  }

  protected limparFiltros(): void {
    this.filtros = formularioVazio();
    this.busca = '';
    this.filtroEscolhido = '';
    this.recarregar();
  }

  // ---------- busca com IA (Bedrock): só preenche os filtros existentes ----------

  protected alternarBuscaIa(): void {
    this.mostrarBuscaIa.set(!this.mostrarBuscaIa());
    if (this.mostrarBuscaIa()) setTimeout(() => document.getElementById('busca-ia')?.focus(), 0);
  }

  protected async aplicarCriteriosIa(criterios: Criterios): Promise<void> {
    const { gerenciador, caixa, busca, formulario } = separarCriteriosIa(criterios, this.abas(), CODIGOS_CAIXA);
    if (gerenciador) this.gerenciador.set(gerenciador);
    // A caixa da IA vira a aba de caixa (ou "Todas as caixas"), para não cruzar a aba atual com a lista da IA.
    const caixaAlterada = caixa !== undefined && caixa !== this.caixa() ? this.rotuloCaixa(caixa) : undefined;
    if (caixa !== undefined) this.caixa.set(caixa);
    this.busca = busca;
    this.filtros = formulario;
    this.filtroEscolhido = '';
    this.mostrarFiltros.set(true); // o usuário revisa e ajusta no formulário de sempre
    this.mostrarBuscaIa.set(false);
    this.pagina.set(1);
    await this.carregar();
    this.avisos.informar(avisoBuscaIaAplicada(this.resposta()?.total, caixaAlterada));
    document.getElementById('titulo-lista')?.focus();
  }

  /** Caixas em "extras" (busca com IA com várias caixas): visíveis como chips removíveis. */
  protected caixasExtras(): string[] {
    return caixasEmExtras(this.filtros);
  }

  protected rotuloCaixa(codigo: string): string {
    return CAIXAS.find((c) => c.codigo === codigo)?.rotulo ?? rotuloEnum(codigo);
  }

  protected removerCaixaExtra(codigo: string): void {
    this.filtros = removerCaixaDeExtras(this.filtros, codigo);
    this.filtroEscolhido = '';
    this.recarregar();
    // O botão clicado some: o foco volta para a aba de caixa selecionada.
    setTimeout(() => (document.querySelector('#grupo-caixa [aria-pressed="true"]') as HTMLElement | null)?.focus(), 0);
  }

  protected escolherFiltroSalvo(): void {
    const f = [...this.filtrosSalvos().meus, ...this.filtrosSalvos().compartilhados].find((x) => x.idFiltro === this.filtroEscolhido);
    if (f) this.aplicarFiltroSalvo(f, true);
  }

  private aplicarFiltroSalvo(f: FiltroSalvo, recarregar: boolean): void {
    const { gerenciador, ...resto } = f.criterios;
    const lista = Array.isArray(gerenciador) ? gerenciador : gerenciador ? [gerenciador] : [];
    if (lista.length === 1 && this.abas().includes(String(lista[0]))) {
      this.gerenciador.set(String(lista[0]));
      this.filtros = deCriterios(resto);
    } else {
      this.filtros = deCriterios(f.criterios);
    }
    this.ordenacao.set(f.ordenacao || 'fila');
    this.filtroEscolhido = f.idFiltro;
    if (recarregar) {
      this.avisos.informar(`Filtro "${f.nome}" aplicado.`);
      this.recarregar();
    }
  }

  protected async salvarFiltro(): Promise<void> {
    if (!this.novoFiltro.nome.trim()) {
      this.avisos.falhar('Informe o nome do filtro.');
      return;
    }
    const criterios = paraCriterios(this.filtros);
    if (this.gerenciadorAtual()) criterios['gerenciador'] = [this.gerenciadorAtual()!];
    if (this.busca.trim()) criterios['q'] = this.busca.trim();
    try {
      const criado = await this.api.criarFiltro({ ...this.novoFiltro, nome: this.novoFiltro.nome.trim(), criterios, ordenacao: this.ordenacao() });
      this.filtrosSalvos.set(await this.api.filtros());
      this.filtroEscolhido = criado.idFiltro;
      this.novoFiltro = { nome: '', padrao: false, compartilhadoComSetor: false };
      this.mostrarSalvar.set(false);
      this.avisos.informar(`Filtro "${criado.nome}" salvo.`);
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    }
  }

  protected async excluirFiltro(): Promise<void> {
    const f = this.filtrosSalvos().meus.find((x) => x.idFiltro === this.filtroEscolhido);
    if (!f || !confirm(`Excluir o filtro "${f.nome}"?`)) return;
    try {
      await this.api.excluirFiltro(f.idFiltro);
      this.filtrosSalvos.set(await this.api.filtros());
      this.filtroEscolhido = '';
      this.avisos.informar('Filtro excluído.');
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    }
  }

  protected ehMeuFiltro(): boolean {
    return this.filtrosSalvos().meus.some((f) => f.idFiltro === this.filtroEscolhido);
  }

  // ---------- ordenação, colunas, paginação ----------

  protected ordenarPor(campo: string): void {
    const [atual, direcao] = this.ordenacao().split(':');
    this.ordenacao.set(atual === campo && direcao === 'asc' ? `${campo}:desc` : `${campo}:asc`);
    this.recarregar();
  }

  protected ariaSort(campo: string): 'ascending' | 'descending' | null {
    const [atual, direcao] = this.ordenacao().split(':');
    if (atual !== campo) return null;
    return direcao === 'desc' ? 'descending' : 'ascending';
  }

  protected mudarOrdenacao(valor: string): void {
    this.ordenacao.set(valor);
    this.recarregar();
  }

  protected alternarColuna(campo: string): void {
    const atuais = this.colunasVisiveis();
    this.colunasVisiveis.set(atuais.includes(campo) ? atuais.filter((c) => c !== campo) : [...atuais, campo]);
  }

  protected moverColuna(campo: string, direcao: -1 | 1): void {
    const lista = [...this.colunasVisiveis()];
    const i = lista.indexOf(campo);
    const alvo = i + direcao;
    if (i <= 0 || alvo <= 0 || alvo >= lista.length) return; // etiqueta fica fixa em primeiro
    [lista[i], lista[alvo]] = [lista[alvo], lista[i]];
    this.colunasVisiveis.set(lista);
    const titulo = COLUNAS.find((c) => c.campo === campo)?.titulo;
    this.avisos.informar(`${titulo} na posição ${alvo + 1}.`);
  }

  protected async salvarVisao(): Promise<void> {
    try {
      await this.api.salvarPreferencias('PAINEL_UNIFICADO', {
        colunasVisiveis: this.colunasVisiveis(),
        ordenacao: this.ordenacao(),
        itensPorPagina: this.tamanho(),
        densidade: this.densidade(),
      });
      this.mostrarColunas.set(false);
      this.avisos.informar('Visão do painel salva.');
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    }
  }

  protected mudarTamanho(valor: number): void {
    this.tamanho.set(Number(valor));
    this.recarregar();
  }

  protected irPara(pagina: number): void {
    if (pagina < 1 || pagina > this.totalPaginas()) return;
    this.pagina.set(pagina);
    void this.carregar();
    document.getElementById('titulo-lista')?.focus();
  }

  // ---------- seleção e lote ----------

  protected alternarSelecao(e: Expediente): void {
    const mapa = new Map(this.selecionados());
    if (mapa.has(e.idExpediente)) mapa.delete(e.idExpediente);
    else mapa.set(e.idExpediente, e);
    this.selecionados.set(mapa);
  }

  protected alternarPagina(): void {
    const mapa = new Map(this.selecionados());
    const itens = this.resposta()?.itens ?? [];
    if (this.todosDaPaginaMarcados()) itens.forEach((e) => mapa.delete(e.idExpediente));
    else itens.forEach((e) => mapa.set(e.idExpediente, e));
    this.selecionados.set(mapa);
    this.avisos.informar(`${mapa.size} selecionado(s).`);
  }

  protected limparSelecao(): void {
    this.selecionados.set(new Map());
  }

  protected abrirLote(tipo: TipoAcao): void {
    void this.dialogoLote().abrir(tipo);
  }

  protected aoConcluirLote(resultado: ResultadoLote | null): void {
    if (resultado) {
      this.limparSelecao();
      void this.carregar();
    }
    document.getElementById('acoes-lote')?.focus();
  }

  protected async exportar(): Promise<void> {
    try {
      await this.api.baixar('expedientes/exportar', {
        gerenciador: this.gerenciadorAtual() ?? undefined,
        caixa: this.caixa() || undefined,
        q: this.busca.trim() || undefined,
        criterios: paraCriterios(this.filtros),
        ordenacao: this.ordenacao(),
      }, 'expedientes.csv');
      this.avisos.informar('Exportação CSV gerada. Sigilosos saem sem conteúdo.');
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    }
  }

  protected async baixarIcs(): Promise<void> {
    try {
      await this.api.baixar('prazos.ics', { gerenciador: this.gerenciadorAtual() ?? undefined, antecedencia: 1 }, 'prazos.ics');
      this.avisos.informar('Calendário de prazos gerado, com lembrete 1 dia antes.');
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    }
  }

  protected rotuloGerenciador(g: string): string {
    return g === 'TODOS' ? 'Todos' : this.catalogo.descricao('GERENCIADOR', g);
  }

  protected contadorCaixa(codigo: string): number | null {
    const c = this.resposta()?.contadoresCaixa;
    if (!c) return null;
    if (!codigo) return c.A_RECEBER + c.NO_SETOR + c.ENVIADO_NAO_RECEBIDO;
    return c[codigo as keyof typeof c];
  }

  protected abrirExpediente(e: Expediente): void {
    void this.router.navigate(['/expedientes', e.idExpediente]);
  }

  protected valor(e: Expediente, campo: string): string {
    const v = (e as unknown as Record<string, unknown>)[campo];
    if (v === null || v === undefined || v === '') return '—';
    if (campo.startsWith('data')) return dataBr(String(v));
    if (campo === 'caixa') return this.catalogo.descricao('CAIXA', String(v));
    if (campo === 'situacao') return this.catalogo.descricao('SITUACAO', String(v));
    if (campo === 'marcadores') return String(v).split(';').join(', ');
    return String(v);
  }
}
