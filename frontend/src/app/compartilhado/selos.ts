import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CatalogoService, corTexto } from '../core/catalogo.service';
import type { Prioridade, StatusPrazo } from '../core/modelos';

/** Texto do selo de prazo: sempre legível sem a cor (RF07). */
export function textoPrazo(status: StatusPrazo | undefined, dias: number | undefined): string {
  if (status === undefined) return 'Sem prazo';
  switch (status) {
    case 'VENCIDO': return dias !== undefined ? `Vencido há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? '' : 's'}` : 'Vencido';
    case 'VENCE_HOJE': return 'Vence hoje';
    case 'CRITICO':
    case 'ATENCAO': return dias !== undefined ? `Vence em ${dias} dia${dias === 1 ? '' : 's'}` : status === 'CRITICO' ? 'Até 3 dias' : 'Até 7 dias';
    case 'NO_PRAZO': return dias !== undefined ? `No prazo (${dias} dias)` : 'No prazo';
    case 'CUMPRIDO': return 'Cumprido';
    case 'CUMPRIDO_COM_ATRASO': return 'Cumprido com atraso';
    default: return status;
  }
}

const SIMBOLO_PRAZO: Record<string, string> = {
  VENCIDO: '⛔', VENCE_HOJE: '⏰', CRITICO: '▲', ATENCAO: '●', NO_PRAZO: '✓', CUMPRIDO: '✓', CUMPRIDO_COM_ATRASO: '✓',
};
const SIMBOLO_PRIORIDADE: Record<string, string> = { CRITICA: '▲▲', ALTA: '▲', MEDIA: '■', BAIXA: '▽' };

@Component({
  selector: 'app-selo-prazo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="selo" [style.background]="fundo()" [style.color]="texto()">
    <span aria-hidden="true">{{ simbolo() }}</span> {{ rotulo() }}</span>`,
})
export class SeloPrazo {
  private readonly catalogo = inject(CatalogoService);
  readonly status = input<StatusPrazo | undefined>();
  readonly dias = input<number | undefined>();
  protected readonly fundo = computed(() => this.catalogo.cor('STATUS_PRAZO', this.status()));
  protected readonly texto = computed(() => corTexto(this.fundo()));
  protected readonly rotulo = computed(() => textoPrazo(this.status(), this.dias()));
  protected readonly simbolo = computed(() => SIMBOLO_PRAZO[this.status() ?? ''] ?? '•');
}

@Component({
  selector: 'app-selo-prioridade',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="selo selo-contorno" [style.border-color]="cor()" [style.color]="'#1f1e1d'">
    <span aria-hidden="true" [style.color]="corSimbolo()">{{ simbolo() }}</span>
    {{ rotulo() }}@if (pontos() !== undefined) {<span class="visually-hidden">, </span><span class="pontos">{{ pontos() }} pts</span>}</span>`,
})
export class SeloPrioridade {
  private readonly catalogo = inject(CatalogoService);
  readonly prioridade = input<Prioridade | undefined>();
  readonly pontos = input<number | undefined>();
  protected readonly cor = computed(() => this.catalogo.cor('PRIORIDADE', this.prioridade()));
  protected readonly corSimbolo = computed(() => this.cor());
  protected readonly rotulo = computed(() => `Prioridade ${this.catalogo.descricao('PRIORIDADE', this.prioridade()).toLowerCase()}`);
  protected readonly simbolo = computed(() => SIMBOLO_PRIORIDADE[this.prioridade() ?? ''] ?? '');
}

@Component({
  selector: 'app-selo-gerenciador',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="selo selo-pequeno" [style.background]="fundo()" [style.color]="texto()">{{ rotulo() }}</span>`,
})
export class SeloGerenciador {
  private readonly catalogo = inject(CatalogoService);
  readonly gerenciador = input<string | undefined>();
  protected readonly fundo = computed(() => this.catalogo.cor('GERENCIADOR', this.gerenciador()));
  protected readonly texto = computed(() => corTexto(this.fundo()));
  protected readonly rotulo = computed(() => this.catalogo.descricao('GERENCIADOR', this.gerenciador()));
}
