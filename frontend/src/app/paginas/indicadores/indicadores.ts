import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AutenticacaoService } from '../../core/autenticacao.service';
import { AvisosService } from '../../core/avisos.service';
import { CatalogoService } from '../../core/catalogo.service';
import { mensagemDeErro } from '../../core/interceptadores';
import type { Indicadores } from '../../core/modelos';
import { dataBr } from '../../compartilhado/formatos';

/** Indicadores (RF17): cada gráfico tem tabela alternativa logo abaixo. */
@Component({
  selector: 'app-indicadores',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './indicadores.html',
})
export class IndicadoresPagina implements OnInit {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  protected readonly catalogo = inject(CatalogoService);
  protected readonly me = inject(AutenticacaoService).me;
  protected readonly dados = signal<Indicadores | null>(null);
  protected readonly mostrarTabela = signal<Record<string, boolean>>({});
  protected gerenciador = '';
  protected dias = 30;
  protected readonly dataBr = dataBr;

  protected readonly maxFluxo = computed(() => Math.max(1, ...(this.dados()?.serie ?? []).flatMap((d) => [d.entradas, d.saidas])));
  protected readonly maxEstoque = computed(() => Math.max(1, ...(this.dados()?.serie ?? []).map((d) => d.aReceber + d.noSetor)));
  protected readonly maxPrazo = computed(() => Math.max(1, ...(this.dados()?.prazosPorSituacao ?? []).map((p) => p.quantidade)));
  protected readonly maxAssunto = computed(() => Math.max(1, ...(this.dados()?.pendenciasPorAssunto ?? []).map((p) => p.quantidade)));
  protected readonly maxProd = computed(() => Math.max(1, ...(this.dados()?.produtividade ?? []).map((p) => Number(p['totalAcoes']))));

  async ngOnInit(): Promise<void> {
    await this.carregar();
  }

  protected async carregar(): Promise<void> {
    try {
      this.dados.set(await this.api.indicadores({ gerenciador: this.gerenciador || undefined, dias: this.dias }));
      this.avisos.informar('Indicadores atualizados.');
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    }
  }

  protected alternarTabela(chave: string): void {
    this.mostrarTabela.update((m) => ({ ...m, [chave]: !m[chave] }));
  }

  protected pct(valor: number, max: number): number {
    return Math.round((100 * valor) / max);
  }

  protected kpi(chave: string): number | string {
    const v = this.dados()?.kpis[chave];
    return v === null || v === undefined ? '—' : v;
  }
}
