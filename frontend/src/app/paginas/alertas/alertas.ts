import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AvisosService } from '../../core/avisos.service';
import { CatalogoService } from '../../core/catalogo.service';
import { mensagemDeErro } from '../../core/interceptadores';
import type { Notificacao, ResumoDiario } from '../../core/modelos';
import { dataHoraBr } from '../../compartilhado/formatos';

/** Central de alertas (RF15) e prévia do resumo diário por e-mail (RF16). */
@Component({
  selector: 'app-alertas',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="titulo-pagina h2">Alertas</h1>
    <div class="row g-3">
      <section class="col-12 col-xl-8" aria-labelledby="titulo-lista-alertas">
        <div class="cartao">
          <div class="d-flex flex-wrap align-items-end gap-2 mb-3">
            <h2 id="titulo-lista-alertas" class="h5 mb-0 me-auto">{{ total() }} alerta(s) · {{ naoLidas() }} não lido(s)</h2>
            <form class="d-flex flex-wrap align-items-end gap-2" (ngSubmit)="filtrar()">
              <div>
                <label for="al-lida" class="form-label small mb-0">Mostrar</label>
                <select id="al-lida" name="lida" class="form-select form-select-sm" [(ngModel)]="lida">
                  <option value="false">Não lidos</option><option value="true">Lidos</option><option value="">Todos</option>
                </select>
              </div>
              <div>
                <label for="al-sev" class="form-label small mb-0">Severidade</label>
                <select id="al-sev" name="severidade" class="form-select form-select-sm" [(ngModel)]="severidade">
                  <option value="">Todas</option>
                  @for (s of catalogo.itens('SEVERIDADE'); track s.codigo) { <option [value]="s.codigo">{{ s.descricao }}</option> }
                </select>
              </div>
              <button type="submit" class="btn btn-sm btn-outline-primary">Filtrar</button>
            </form>
            <button type="button" class="btn btn-sm btn-primary" [disabled]="!naoLidas()" (click)="marcarTodas()">Marcar todos como lidos</button>
          </div>
          <ul class="list-unstyled mb-0">
            @for (n of itens(); track n.idNotificacao) {
              <li class="d-flex gap-2 py-2 border-bottom" [class.fw-semibold]="!n.lida">
                <span class="badge align-self-start" [class.text-bg-danger]="n.severidade === 'CRITICO'" [class.text-bg-warning]="n.severidade === 'ATENCAO'" [class.text-bg-primary]="n.severidade === 'INFO'">
                  {{ catalogo.descricao('SEVERIDADE', n.severidade) }}</span>
                <div class="flex-grow-1">
                  <div>{{ n.titulo }} <span class="visually-hidden">{{ n.lida ? '(lido)' : '(não lido)' }}</span></div>
                  <div class="small fw-normal">{{ n.mensagem }} · <span class="text-secondary">{{ dataHoraBr(n.dataHora) }}</span></div>
                  <a class="small fw-normal" [routerLink]="['/expedientes', n.idExpediente]">Abrir {{ n.etiqueta }}</a>
                </div>
                <button type="button" class="btn btn-sm btn-outline-secondary align-self-start" (click)="alternar(n)">
                  {{ n.lida ? 'Marcar como não lido' : 'Marcar como lido' }}<span class="visually-hidden">: {{ n.titulo }}, {{ n.etiqueta }}</span>
                </button>
              </li>
            } @empty {
              <li>Nenhum alerta com esses filtros.</li>
            }
          </ul>
          @if (itens().length < total()) {
            <button type="button" class="btn btn-link mt-2" (click)="maisItens()">Mostrar mais</button>
          }
        </div>
      </section>
      <section class="col-12 col-xl-4" aria-labelledby="titulo-resumo">
        <div class="cartao">
          <h2 id="titulo-resumo" class="h5">Resumo diário por e-mail</h2>
          <p class="small text-secondary">Enviado em dias úteis às 7h (EventBridge Scheduler + SES) para quem optou. Leva só etiquetas e números: nunca assunto ou conteúdo sigiloso.</p>
          @if (resumo(); as r) {
            <p class="mb-1"><strong>Assunto:</strong> {{ r.assunto }}</p>
            <pre class="small bg-light p-2 rounded mb-0" style="white-space: pre-wrap">{{ r.texto }}</pre>
          }
        </div>
      </section>
    </div>
  `,
})
export class AlertasPagina implements OnInit {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  protected readonly catalogo = inject(CatalogoService);
  protected readonly itens = signal<Notificacao[]>([]);
  protected readonly total = signal(0);
  protected readonly naoLidas = signal(0);
  protected readonly resumo = signal<ResumoDiario | null>(null);
  protected lida = 'false';
  protected severidade = '';
  private pagina = 1;
  protected readonly dataHoraBr = dataHoraBr;

  async ngOnInit(): Promise<void> {
    await this.carregar();
    try {
      this.resumo.set(await this.api.resumoDiario());
    } catch {
      // opcional
    }
  }

  private async carregar(acumular = false): Promise<void> {
    try {
      const r = await this.api.notificacoes({ lida: this.lida || undefined, severidade: this.severidade || undefined, pagina: this.pagina, tamanho: 30 });
      this.itens.set(acumular ? [...this.itens(), ...r.itens] : r.itens);
      this.total.set(r.total);
      this.naoLidas.set(r.naoLidas);
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    }
  }

  protected async filtrar(): Promise<void> {
    this.pagina = 1;
    await this.carregar();
    this.avisos.informar(`${this.total()} alerta(s).`);
  }

  protected async maisItens(): Promise<void> {
    this.pagina += 1;
    await this.carregar(true);
  }

  protected async alternar(n: Notificacao): Promise<void> {
    try {
      await this.api.marcarLidas({ ids: [n.idNotificacao], lida: !n.lida });
      this.itens.update((lista) => lista.map((x) => (x.idNotificacao === n.idNotificacao ? { ...x, lida: !n.lida } : x)));
      this.naoLidas.update((v) => v + (n.lida ? 1 : -1));
      this.avisos.informar(n.lida ? 'Marcado como não lido.' : 'Marcado como lido.');
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    }
  }

  protected async marcarTodas(): Promise<void> {
    try {
      const { atualizadas } = await this.api.marcarLidas({ todas: true });
      this.avisos.informar(`${atualizadas} alerta(s) marcados como lidos.`);
      this.pagina = 1;
      await this.carregar();
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    }
  }
}
