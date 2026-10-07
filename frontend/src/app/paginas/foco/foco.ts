import { ChangeDetectionStrategy, Component, computed, HostListener, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AutenticacaoService } from '../../core/autenticacao.service';
import { AvisosService } from '../../core/avisos.service';
import { CatalogoService } from '../../core/catalogo.service';
import { mensagemDeErro } from '../../core/interceptadores';
import type { DetalheExpediente, Expediente, ResultadoLote, TipoAcao } from '../../core/modelos';
import { SeloGerenciador, SeloPrazo, SeloPrioridade } from '../../compartilhado/selos';
import { DialogoLote, ROTULO_ACAO, acoesDoPerfil } from '../../compartilhado/dialogo-lote';
import { dataBr } from '../../compartilhado/formatos';

/** Ação em lote que resolve a ação pendente do expediente, quando existe. */
export function acaoDoItem(e: Expediente, perfil: string | undefined): TipoAcao | null {
  const possiveis = acoesDoPerfil(perfil);
  let acao: TipoAcao | null = null;
  if (e.caixa === 'A_RECEBER') acao = 'RECEBER';
  else if (e.situacao === 'AGUARDANDO_ASSINATURA') acao = 'ASSINAR';
  else if (e.situacao === 'AGUARDANDO_CIENCIA' || e.novaIntimacao) acao = 'DAR_CIENCIA';
  else if (e.situacao === 'PRONTO_PARA_ENVIO') acao = 'MOVIMENTAR';
  return acao && possiveis.includes(acao) ? acao : null;
}

/** Modo "próximo processo" (RF09): um item por vez na ordem da fila (GSI2), com atalhos N, P e A. */
@Component({
  selector: 'app-foco',
  imports: [FormsModule, RouterLink, SeloPrazo, SeloPrioridade, SeloGerenciador, DialogoLote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './foco.html',
})
export class FocoPagina implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly avisos = inject(AvisosService);
  protected readonly catalogo = inject(CatalogoService);
  protected readonly me = inject(AutenticacaoService).me;
  private readonly dialogoLote = viewChild.required(DialogoLote);

  protected readonly fila = signal<Expediente[]>([]);
  protected readonly indice = signal(0);
  protected readonly detalhe = signal<DetalheExpediente | null>(null);
  protected readonly carregando = signal(true);
  protected somenteMeus = false;
  protected gerenciador = '';
  protected readonly rotuloAcao = ROTULO_ACAO;
  protected readonly dataBr = dataBr;

  protected readonly atual = computed(() => this.fila()[this.indice()] ?? null);
  protected readonly acao = computed(() => (this.atual() ? acaoDoItem(this.atual()!, this.me()?.usuario.perfil) : null));
  protected readonly selecionados = computed(() => (this.atual() ? [this.atual()!] : []));
  protected readonly gerenciadores = computed(() => this.me()?.setor.gerenciadores ?? []);

  async ngOnInit(): Promise<void> {
    this.somenteMeus = this.me()?.usuario.perfil === 'SERVIDOR';
    await this.carregar();
  }

  protected async carregar(): Promise<void> {
    this.carregando.set(true);
    try {
      const r = await this.api.fila({ gerenciador: this.gerenciador || undefined, meus: this.somenteMeus || undefined });
      this.fila.set(r.itens);
      this.indice.set(0);
      this.avisos.informar(`${r.total} expediente(s) na fila.`);
      await this.carregarDetalhe();
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    } finally {
      this.carregando.set(false);
    }
  }

  private async carregarDetalhe(): Promise<void> {
    const atual = this.atual();
    this.detalhe.set(null);
    if (!atual) return;
    try {
      this.detalhe.set(await this.api.detalhe(atual.idExpediente));
    } catch {
      // O cartão funciona com os dados da fila.
    }
  }

  protected async ir(direcao: 1 | -1): Promise<void> {
    const novo = this.indice() + direcao;
    if (novo < 0 || novo >= this.fila().length) return;
    this.indice.set(novo);
    const e = this.atual()!;
    this.avisos.informar(`${novo + 1} de ${this.fila().length}: ${e.etiqueta}.`);
    document.getElementById('cartao-foco')?.focus();
    await this.carregarDetalhe();
  }

  protected abrir(): void {
    const e = this.atual();
    if (e) void this.router.navigate(['/expedientes', e.idExpediente]);
  }

  protected executarAcao(): void {
    const acao = this.acao();
    if (acao) void this.dialogoLote().abrir(acao);
  }

  protected aoConcluir(resultado: ResultadoLote | null): void {
    if (!resultado?.aplicados.length) return;
    // O item tratado sai da fila; o próximo assume o lugar.
    const id = this.atual()?.idExpediente;
    const resto = this.fila().filter((e) => e.idExpediente !== id);
    this.fila.set(resto);
    this.indice.set(Math.min(this.indice(), Math.max(0, resto.length - 1)));
    void this.carregarDetalhe();
  }

  @HostListener('document:keydown', ['$event'])
  protected atalho(evento: KeyboardEvent): void {
    const alvo = evento.target as HTMLElement | null;
    if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
    if (alvo && (['INPUT', 'SELECT', 'TEXTAREA'].includes(alvo.tagName) || alvo.isContentEditable || alvo.closest('dialog'))) return;
    const tecla = evento.key.toLowerCase();
    if (tecla === 'n') { evento.preventDefault(); void this.ir(1); }
    else if (tecla === 'p') { evento.preventDefault(); void this.ir(-1); }
    else if (tecla === 'a') { evento.preventDefault(); this.abrir(); }
    else if (tecla === 'x' && this.acao()) { evento.preventDefault(); this.executarAcao(); }
  }
}
