import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import type { Catalogos, ItemCatalogo } from './modelos';

const PADRAO = '#607D8B';

/** Luminância relativa (WCAG 2.1) de uma cor #RRGGBB. */
export function luminancia(hex: string): number {
  const valor = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '607D8B';
  const canais = [0, 2, 4].map((i) => parseInt(valor.slice(i, i + 2), 16) / 255);
  const [r, g, b] = canais.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a: string, b: string): number {
  const [maior, menor] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (maior + 0.05) / (menor + 0.05);
}

/** Texto preto ou branco, o que tiver mais contraste com o fundo (cores vêm de catalogos.csv). */
export function corTexto(fundo: string): '#000000' | '#FFFFFF' {
  return contraste(fundo, '#000000') >= contraste(fundo, '#FFFFFF') ? '#000000' : '#FFFFFF';
}

@Injectable({ providedIn: 'root' })
export class CatalogoService {
  private readonly api = inject(ApiService);
  private readonly dados = signal<Catalogos>({});
  private carregando: Promise<void> | null = null;

  carregar(): Promise<void> {
    this.carregando ??= this.api.catalogos().then((c) => this.dados.set(c)).catch(() => {
      this.carregando = null;
    });
    return this.carregando;
  }

  itens(dominio: string): ItemCatalogo[] {
    return [...(this.dados()[dominio] ?? [])].sort((a, b) => a.ordem - b.ordem);
  }

  private item(dominio: string, codigo: string | undefined): ItemCatalogo | undefined {
    return this.dados()[dominio]?.find((i) => i.codigo === codigo);
  }

  descricao(dominio: string, codigo: string | undefined): string {
    return this.item(dominio, codigo)?.descricao ?? codigo ?? '—';
  }

  cor(dominio: string, codigo: string | undefined): string {
    return this.item(dominio, codigo)?.cor || PADRAO;
  }
}
