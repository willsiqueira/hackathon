import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { AvisosService } from '../../core/avisos.service';
import { mensagemDeErro } from '../../core/interceptadores';
import type { RegistroLote } from '../../core/modelos';
import { ROTULO_ACAO } from '../../compartilhado/dialogo-lote';
import { dataHoraBr } from '../../compartilhado/formatos';

/** Trilha de lotes (RF12): os meus, com desfazer, e os do setor. */
@Component({
  selector: 'app-lotes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="titulo-pagina h2">Ações em lote</h1>
    @for (grupo of grupos; track grupo.chave) {
      <section class="cartao mb-3" [attr.aria-labelledby]="'titulo-' + grupo.chave">
        <h2 [id]="'titulo-' + grupo.chave" class="h5">{{ grupo.titulo }}</h2>
        <div tabindex="0" class="table-responsive">
          <table class="table table-sm mb-0">
            <caption class="visually-hidden">{{ grupo.titulo }}, do mais recente ao mais antigo</caption>
            <thead><tr>
              <th [id]="grupo.chave + '-quando'" scope="col">Quando</th>
              <th [id]="grupo.chave + '-quem'" scope="col">Quem</th>
              <th [id]="grupo.chave + '-acao'" scope="col">Ação</th>
              <th [id]="grupo.chave + '-qtd'" scope="col" class="text-end">Expedientes</th>
              <th [id]="grupo.chave + '-res'" scope="col">Resultado</th>
              <th [id]="grupo.chave + '-par'" scope="col" class="d-none d-md-table-cell">Parâmetros</th>
              @if (grupo.chave === 'meus') { <th [id]="grupo.chave + '-op'" scope="col">Desfazer</th> }
            </tr></thead>
            <tbody>
              @for (l of (grupo.chave === 'meus' ? meus() : setor()); track l.idLote) {
                <tr>
                  <td [attr.headers]="grupo.chave + '-quando'" class="text-nowrap">{{ dataHoraBr(l.dataHora) }}</td>
                  <td [attr.headers]="grupo.chave + '-quem'">{{ l.nomeUsuario }}</td>
                  <td [attr.headers]="grupo.chave + '-acao'">{{ rotulo(l.tipoAcao) }}</td>
                  <td [attr.headers]="grupo.chave + '-qtd'" class="text-end">{{ l.qtdSucesso }} de {{ l.qtdExpedientes }}</td>
                  <td [attr.headers]="grupo.chave + '-res'">{{ l.desfeito ? 'Desfeito' : l.resultado === 'PARCIAL' ? 'Parcial' : 'Sucesso' }}</td>
                  <td [attr.headers]="grupo.chave + '-par'" class="d-none d-md-table-cell small text-break">{{ l.parametros || '—' }}</td>
                  @if (grupo.chave === 'meus') {
                    <td [attr.headers]="grupo.chave + '-op'">
                      @if (!l.desfeito) {
                        <button type="button" class="btn btn-sm btn-outline-danger" (click)="desfazer(l)">Desfazer<span class="visually-hidden"> lote de {{ dataHoraBr(l.dataHora) }}</span></button>
                      }
                    </td>
                  }
                </tr>
              } @empty {
                <tr><td colspan="7">Nenhum lote.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
})
export class LotesPagina implements OnInit {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  protected readonly meus = signal<RegistroLote[]>([]);
  protected readonly setor = signal<RegistroLote[]>([]);
  protected readonly dataHoraBr = dataHoraBr;
  protected readonly grupos = [
    { chave: 'meus', titulo: 'Meus lotes' },
    { chave: 'setor', titulo: 'Histórico do setor' },
  ] as const;

  async ngOnInit(): Promise<void> {
    await this.carregar();
  }

  private async carregar(): Promise<void> {
    try {
      const r = await this.api.lotes();
      this.meus.set(r.meus);
      this.setor.set(r.setor);
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    }
  }

  protected rotulo(tipo: string): string {
    return ROTULO_ACAO[tipo as keyof typeof ROTULO_ACAO] ?? tipo;
  }

  protected async desfazer(l: RegistroLote): Promise<void> {
    if (!confirm(`Desfazer o lote de ${this.rotulo(l.tipoAcao).toLowerCase()} com ${l.qtdSucesso} expediente(s)?`)) return;
    try {
      const r = await this.api.desfazerLote(l.idLote);
      this.avisos.informar(`Desfeito: ${r.restaurados.length} restaurado(s), ${r.naoRestaurados.length} mantido(s) por terem mudado depois.`);
      await this.carregar();
    } catch (e) {
      this.avisos.falhar(mensagemDeErro(e));
    }
  }
}
