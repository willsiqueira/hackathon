import { Injectable, signal } from '@angular/core';

/** Conteúdo de /config.json (gerado pelo CDK na publicação; no modo local vem de public/config.json). */
export interface Configuracao {
  modoAutenticacao: 'local' | 'cognito';
  regiao?: string;
  userPoolClientId?: string;
}

@Injectable({ providedIn: 'root' })
export class ConfiguracaoService {
  private readonly atual = signal<Configuracao>({ modoAutenticacao: 'local' });
  readonly valor = this.atual.asReadonly();

  async carregar(): Promise<void> {
    try {
      const resposta = await fetch('/config.json', { cache: 'no-store' });
      if (resposta.ok) this.atual.set(await resposta.json());
    } catch {
      // Sem config.json: modo local.
    }
  }
}
