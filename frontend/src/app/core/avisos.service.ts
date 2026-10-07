import { Injectable, signal } from '@angular/core';

/**
 * Avisos para leitor de tela: "status" sai numa região aria-live="polite";
 * "erro" sai numa região role="alert". Ambas ficam no layout principal.
 */
@Injectable({ providedIn: 'root' })
export class AvisosService {
  readonly status = signal('');
  readonly erro = signal('');

  informar(mensagem: string): void {
    // Limpa e repõe para que a mesma mensagem seja anunciada de novo.
    this.status.set('');
    queueMicrotask(() => this.status.set(mensagem));
  }

  falhar(mensagem: string): void {
    this.erro.set('');
    queueMicrotask(() => this.erro.set(mensagem));
  }

  limparErro(): void {
    this.erro.set('');
  }
}
