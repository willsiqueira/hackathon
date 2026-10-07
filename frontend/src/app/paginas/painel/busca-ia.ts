import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import type { Criterios, RespostaBuscaIa } from '../../core/modelos';
import { AVISO_PRIVACIDADE_BUSCA, LIMITE_TEXTO_BUSCA_IA, mensagemFalhaIa, rotuloOrigemIa } from '../../compartilhado/ia';

/**
 * Busca em linguagem natural (Amazon Bedrock): o texto vira critérios que o usuário revisa, remove e só então aplica
 * no formulário de filtros existente. A resposta do modelo é exibida só por interpolação (nunca innerHTML).
 */
@Component({
  selector: 'app-busca-ia',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './busca-ia.html',
})
export class BuscaIa {
  private readonly api = inject(ApiService);

  readonly aplicar = output<Criterios>();

  protected readonly texto = signal('');
  protected readonly interpretando = signal(false);
  protected readonly erro = signal('');
  protected readonly resposta = signal<RespostaBuscaIa | null>(null);
  protected readonly criterios = signal<Criterios>({});

  protected readonly limite = LIMITE_TEXTO_BUSCA_IA;
  protected readonly aviso = AVISO_PRIVACIDADE_BUSCA;
  protected readonly rotuloOrigem = rotuloOrigemIa;

  /** Chips que ainda valem (o usuário pode remover alguns antes de aplicar). */
  protected readonly chips = computed(() => {
    const ativos = this.criterios();
    return (this.resposta()?.interpretacao ?? []).filter((c) => c.chave in ativos);
  });

  protected readonly status = computed(() => {
    if (this.interpretando()) return 'Interpretando…';
    if (!this.resposta()) return '';
    const n = this.chips().length;
    return n ? `Encontrei ${n} filtro(s). Revise antes de aplicar.` : 'Nenhum filtro restante. Reformule o pedido ou descarte.';
  });

  protected async interpretar(): Promise<void> {
    const texto = this.texto().trim();
    if (!texto || this.interpretando()) return;
    this.interpretando.set(true);
    this.erro.set('');
    this.resposta.set(null);
    this.criterios.set({});
    try {
      const r = await this.api.buscaIa(texto);
      this.resposta.set(r);
      this.criterios.set({ ...r.criterios });
      this.focar('resultado-busca-ia');
    } catch (e) {
      this.erro.set(mensagemFalhaIa(e));
    } finally {
      this.interpretando.set(false);
    }
  }

  protected remover(chave: string): void {
    this.criterios.update((c) => {
      const resto = { ...c };
      delete resto[chave];
      return resto;
    });
    // O botão clicado some da lista: o foco volta ao título do resultado.
    this.focar('resultado-busca-ia');
  }

  protected aplicarFiltros(): void {
    if (!this.chips().length) return;
    this.aplicar.emit({ ...this.criterios() });
  }

  protected descartar(): void {
    this.resposta.set(null);
    this.criterios.set({});
    this.erro.set('');
    this.focar('busca-ia');
  }

  private focar(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  }
}
