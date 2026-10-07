import {
  ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AvisosService } from '../core/avisos.service';
import { mensagemDeErro } from '../core/interceptadores';
import type { Carga, Expediente, Marcador, ParametrosLote, PessoaSetor, PreviaLote, ResultadoLote, TipoAcao } from '../core/modelos';

export const ROTULO_ACAO: Record<TipoAcao, string> = {
  RECEBER: 'Receber', DESIGNAR: 'Designar', INCLUIR_MARCADOR: 'Incluir marcador', DAR_CIENCIA: 'Dar ciência',
  ASSINAR: 'Assinar', MOVIMENTAR: 'Movimentar', ARQUIVAR: 'Arquivar',
};

/** Ações que cada perfil vê (o backend valida de novo). */
export function acoesDoPerfil(perfil: string | undefined): TipoAcao[] {
  const base: TipoAcao[] = ['RECEBER', 'INCLUIR_MARCADOR', 'DAR_CIENCIA', 'MOVIMENTAR', 'ARQUIVAR'];
  if (perfil === 'CHEFE') return ['RECEBER', 'DESIGNAR', ...base.slice(1)];
  if (perfil === 'MEMBRO') return ['RECEBER', 'DESIGNAR', 'ASSINAR', ...base.slice(1)];
  return base;
}

type Etapa = 'parametros' | 'previa' | 'resultado';

/**
 * Lote com prévia e desfazer (RF11, RF12). Usa <dialog> nativo: prende o foco e o devolve ao fechar.
 */
@Component({
  selector: 'app-dialogo-lote',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dialogo-lote.html',
})
export class DialogoLote {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');

  readonly selecionados = input<Expediente[]>([]);
  readonly concluido = output<ResultadoLote | null>();

  protected readonly tipo = signal<TipoAcao>('RECEBER');
  protected readonly etapa = signal<Etapa>('parametros');
  protected readonly ocupado = signal(false);
  protected readonly erro = signal('');
  protected readonly previa = signal<PreviaLote | null>(null);
  protected readonly resultado = signal<ResultadoLote | null>(null);
  protected readonly desfeito = signal<string>('');
  protected readonly pessoas = signal<PessoaSetor[]>([]);
  protected readonly cargas = signal<Carga[]>([]);
  protected readonly marcadores = signal<Marcador[]>([]);
  protected readonly rotuloAcao = ROTULO_ACAO;

  protected modoDesignacao: 'sugerido' | 'pessoa' | 'distribuir' = 'sugerido';
  protected idUsuarioDesignado = '';
  protected prazoDevolucao = '';
  protected idRotulo = '';
  protected setorDestino = '';
  protected motivo = '';

  protected readonly titulo = computed(() => `${ROTULO_ACAO[this.tipo()]} ${this.selecionados().length} expediente(s)`);
  protected readonly gerenciadoresSelecionados = computed(() => new Set(this.selecionados().map((e) => e.gerenciador)));
  protected readonly marcadoresAplicaveis = computed(() => this.marcadores().filter((m) => this.gerenciadoresSelecionados().has(m.gerenciador)));
  protected readonly sugerido = computed(() => this.cargas()[0] ?? null);

  async abrir(tipo: TipoAcao): Promise<void> {
    this.tipo.set(tipo);
    this.etapa.set('parametros');
    this.erro.set('');
    this.previa.set(null);
    this.resultado.set(null);
    this.desfeito.set('');
    this.modoDesignacao = 'sugerido';
    this.idUsuarioDesignado = '';
    this.prazoDevolucao = '';
    this.idRotulo = '';
    this.setorDestino = '';
    this.motivo = '';
    this.dialogo().nativeElement.showModal();
    try {
      if (tipo === 'DESIGNAR') {
        const [pessoas, sugestao] = await Promise.all([this.api.usuarios(), this.api.sugestao()]);
        this.pessoas.set(pessoas.filter((p) => p.ativo !== false));
        this.cargas.set(sugestao.cargas);
      }
      if (tipo === 'INCLUIR_MARCADOR') {
        this.marcadores.set(await this.api.marcadores());
        this.idRotulo = this.marcadoresAplicaveis()[0]?.idRotulo ?? '';
      }
      // Ações sem parâmetros vão direto para a prévia.
      if (['RECEBER', 'DAR_CIENCIA', 'ASSINAR'].includes(tipo)) await this.verPrevia();
    } catch (e) {
      this.erro.set(mensagemDeErro(e));
    }
  }

  protected parametros(): ParametrosLote {
    switch (this.tipo()) {
      case 'DESIGNAR': {
        const p: ParametrosLote = this.prazoDevolucao ? { prazoDevolucao: this.prazoDevolucao } : {};
        if (this.modoDesignacao === 'distribuir') return { ...p, distribuir: true };
        const id = this.modoDesignacao === 'sugerido' ? this.sugerido()?.idUsuario : this.idUsuarioDesignado;
        return { ...p, idUsuarioDesignado: id };
      }
      case 'INCLUIR_MARCADOR': return { idRotulo: this.idRotulo };
      case 'MOVIMENTAR': return { setorDestino: this.setorDestino };
      case 'ARQUIVAR': return this.motivo ? { motivo: this.motivo } : {};
      default: return {};
    }
  }

  protected async verPrevia(): Promise<void> {
    await this.executarComCarga(async () => {
      this.previa.set(await this.api.previaLote(this.tipo(), this.selecionados().map((e) => e.idExpediente), this.parametros()));
      this.etapa.set('previa');
      const p = this.previa()!;
      this.avisos.informar(`Prévia: ${p.aplicaveis.length} serão alterados e ${p.ignorados.length} ignorados.`);
      this.focar('titulo-previa');
    });
  }

  protected async confirmar(): Promise<void> {
    await this.executarComCarga(async () => {
      const r = await this.api.executarLote(this.tipo(), this.selecionados().map((e) => e.idExpediente), this.parametros());
      this.resultado.set(r);
      this.etapa.set('resultado');
      this.avisos.informar(`${ROTULO_ACAO[r.tipoAcao]}: ${r.aplicados.length} alterado(s), ${r.ignorados.length} ignorado(s).`);
      this.focar('titulo-resultado');
    });
  }

  protected async desfazer(): Promise<void> {
    const r = this.resultado();
    if (!r) return;
    await this.executarComCarga(async () => {
      const d = await this.api.desfazerLote(r.idLote);
      const texto = `Desfeito: ${d.restaurados.length} restaurado(s)` + (d.naoRestaurados.length ? `, ${d.naoRestaurados.length} já alterado(s) depois e mantido(s).` : '.');
      this.desfeito.set(texto);
      this.avisos.informar(texto);
    });
  }

  protected fechar(): void {
    this.dialogo().nativeElement.close();
  }

  protected aoFechar(): void {
    this.concluido.emit(this.resultado());
  }

  private async executarComCarga(acao: () => Promise<void>): Promise<void> {
    this.erro.set('');
    this.ocupado.set(true);
    try {
      await acao();
    } catch (e) {
      this.erro.set(mensagemDeErro(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  private focar(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  }
}
