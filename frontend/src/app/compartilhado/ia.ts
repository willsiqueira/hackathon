// Textos e mensagens dos recursos com IA generativa (Amazon Bedrock). Funções puras, testadas em ia.spec.ts.

import { HttpErrorResponse } from '@angular/common/http';
import { mensagemDeErro } from '../core/interceptadores';
import type { OrigemIa } from '../core/modelos';

export const LIMITE_TEXTO_BUSCA_IA = 300;

export const AVISO_PRIVACIDADE_BUSCA =
  'O texto digitado é enviado ao Amazon Bedrock só para virar filtros. Nenhum conteúdo de expediente, e nada de sigilosos, é enviado ao modelo.';

export const AVISO_PRIVACIDADE_RESUMO =
  'Gerado sob demanda pelo Amazon Bedrock só com contagens, etiquetas, situação do prazo e prioridade. Assunto e conteúdo de sigilosos não são enviados.';

const FALHA_PADRAO = 'O assistente de IA está indisponível. Use a pesquisa e os filtros normalmente.';

/** Mensagem legível de uma falha da IA: usa a mensagem do backend (503/422) e cai no padrão da API para o resto. */
export function mensagemFalhaIa(erro: unknown): string {
  if (erro instanceof HttpErrorResponse && (erro.status === 503 || erro.status === 422)) {
    const corpo = erro.error as { mensagem?: unknown } | null;
    if (corpo && typeof corpo === 'object' && typeof corpo.mensagem === 'string' && corpo.mensagem) return corpo.mensagem;
    return erro.status === 503 ? FALHA_PADRAO : 'Não consegui interpretar a resposta da IA. Reformule ou use os filtros.';
  }
  return mensagemDeErro(erro);
}

/** De onde veio o texto ou o filtro, dito por extenso (nunca só por ícone ou cor). */
export function rotuloOrigemIa(origem: OrigemIa | string | undefined): string {
  return origem === 'bedrock' ? 'Gerado pelo Amazon Bedrock' : 'Modo demonstração: gerado localmente, sem IA';
}
