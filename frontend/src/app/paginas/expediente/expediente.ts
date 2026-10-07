import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ApiService } from '../../core/api.service';
import { AutenticacaoService } from '../../core/autenticacao.service';
import { AvisosService } from '../../core/avisos.service';
import { CatalogoService } from '../../core/catalogo.service';
import { mensagemDeErro } from '../../core/interceptadores';
import type { DetalheExpediente, ResultadoLote, TipoAcao } from '../../core/modelos';
import { SeloGerenciador, SeloPrazo, SeloPrioridade } from '../../compartilhado/selos';
import { DialogoLote, ROTULO_ACAO, acoesDoPerfil } from '../../compartilhado/dialogo-lote';
import { dataBr, dataHoraBr, rotuloEnum } from '../../compartilhado/formatos';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'app-expediente',
  imports: [FormsModule, SeloPrazo, SeloPrioridade, SeloGerenciador, DialogoLote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './expediente.html',
})
export class ExpedientePagina implements OnInit {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly location = inject(Location);
  protected readonly catalogo = inject(CatalogoService);
  protected readonly me = inject(AutenticacaoService).me;
  private readonly dialogoLote = viewChild.required(DialogoLote);

  readonly id = input.required<string>();
  protected readonly detalhe = signal<DetalheExpediente | null>(null);
  protected readonly negado = signal('');
  protected tipoHistorico = '';
  protected readonly filtroHistorico = signal('');
  protected readonly rotuloAcao = ROTULO_ACAO;
  protected readonly dataBr = dataBr;
  protected readonly dataHoraBr = dataHoraBr;
  protected readonly rotuloEnum = rotuloEnum;

  protected readonly e = computed(() => this.detalhe()?.expediente ?? null);
  protected readonly movimentacoes = computed(() => {
    const tipo = this.filtroHistorico();
    const lista = this.detalhe()?.movimentacoes ?? [];
    return [...(tipo ? lista.filter((m) => m.tipoMovimentacao === tipo) : lista)].reverse();
  });
  protected readonly tiposHistorico = computed(() => [...new Set((this.detalhe()?.movimentacoes ?? []).map((m) => m.tipoMovimentacao))]);
  protected readonly selecionados = computed(() => (this.e() ? [this.e()!] : []));
  protected readonly acoesPossiveis = computed<TipoAcao[]>(() => {
    const e = this.e();
    if (!e) return [];
    const doPerfil = acoesDoPerfil(this.me()?.usuario.perfil);
    if (e.caixa === 'A_RECEBER') return doPerfil.filter((a) => a === 'RECEBER');
    if (e.caixa !== 'NO_SETOR') return [];
    return doPerfil.filter((a) => a !== 'RECEBER'
      && (a !== 'ASSINAR' || e.situacao === 'AGUARDANDO_ASSINATURA')
      && (a !== 'DAR_CIENCIA' || (e.gerenciador === 'JUDICIAL' && (e.novaIntimacao || e.situacao === 'AGUARDANDO_CIENCIA'))));
  });

  async ngOnInit(): Promise<void> {
    await this.carregar();
  }

  private async carregar(): Promise<void> {
    try {
      this.detalhe.set(await this.api.detalhe(this.id()));
      this.negado.set('');
    } catch (erro) {
      if (erro instanceof HttpErrorResponse && (erro.status === 403 || erro.status === 404)) this.negado.set(mensagemDeErro(erro));
      else this.avisos.falhar(mensagemDeErro(erro));
    }
  }

  protected aplicarFiltroHistorico(): void {
    this.filtroHistorico.set(this.tipoHistorico);
    this.avisos.informar(`${this.movimentacoes().length} movimentação(ões) no histórico.`);
  }

  protected async exportarHistorico(): Promise<void> {
    try {
      await this.api.baixar(`expedientes/${encodeURIComponent(this.id())}/historico.csv`, { tipo: this.filtroHistorico() || undefined },
        `historico-${this.e()?.etiqueta ?? this.id()}.csv`);
    } catch (erro) {
      this.avisos.falhar(mensagemDeErro(erro));
    }
  }

  protected abrirAcao(tipo: TipoAcao): void {
    void this.dialogoLote().abrir(tipo);
  }

  protected aoConcluir(resultado: ResultadoLote | null): void {
    if (resultado) void this.carregar();
  }

  protected voltar(): void {
    this.location.back();
  }
}
