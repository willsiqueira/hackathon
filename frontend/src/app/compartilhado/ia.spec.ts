import { describe, expect, it } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { AVISO_PRIVACIDADE_BUSCA, AVISO_PRIVACIDADE_RESUMO, mensagemFalhaIa, rotuloOrigemIa } from './ia';
import { NOMES_WIDGET } from '../paginas/inicio/inicio';
import type { Widget } from '../core/modelos';

const erroHttp = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

describe('Mensagens de falha da IA (a pesquisa manual continua)', () => {
  it('503 usa a mensagem do backend', () => {
    const mensagem = 'Muitas solicitações à IA agora. Tente de novo em instantes.';
    expect(mensagemFalhaIa(erroHttp(503, { erro: 'IA_INDISPONIVEL', mensagem }))).toBe(mensagem);
  });

  it('503 sem corpo cai na mensagem padrão, que orienta a usar os filtros', () => {
    expect(mensagemFalhaIa(erroHttp(503))).toBe('O assistente de IA está indisponível. Use a pesquisa e os filtros normalmente.');
  });

  it('422 usa a mensagem do backend', () => {
    const mensagem = 'Não consegui interpretar a resposta da IA. Reformule ou use os filtros.';
    expect(mensagemFalhaIa(erroHttp(422, { erro: 'RESPOSTA_IA_INVALIDA', mensagem }))).toBe(mensagem);
  });

  it('400 e sem conexão seguem o padrão da API', () => {
    expect(mensagemFalhaIa(erroHttp(400, { erro: 'VALIDACAO', mensagem: 'texto: Digite o que procura.' }))).toBe('texto: Digite o que procura.');
    expect(mensagemFalhaIa(erroHttp(0))).toBe('Sem conexão com o servidor.');
    expect(mensagemFalhaIa(new Error('x'))).toBe('Erro inesperado. Tente de novo.');
  });
});

describe('Identificação do texto gerado', () => {
  it('origem dita por extenso', () => {
    expect(rotuloOrigemIa('bedrock')).toBe('Gerado pelo Amazon Bedrock');
    expect(rotuloOrigemIa('demonstracao')).toBe('Modo demonstração: gerado localmente, sem IA');
  });

  it('avisos de privacidade citam o Bedrock e os sigilosos', () => {
    for (const aviso of [AVISO_PRIVACIDADE_BUSCA, AVISO_PRIVACIDADE_RESUMO]) {
      expect(aviso).toContain('Amazon Bedrock');
      expect(aviso).toMatch(/sigilosos/);
    }
  });
});

describe('Widgets da tela inicial (RF19)', () => {
  it('todo widget do backend, inclusive resumoIa, tem nome na personalização', () => {
    const ids: Widget['id'][] = ['contadores', 'resumoIa', 'proximo', 'prazos', 'alertas', 'informes', 'filtros'];
    expect(Object.keys(NOMES_WIDGET).sort()).toEqual([...ids].sort());
    for (const id of ids) expect(NOMES_WIDGET[id]).toBeTruthy();
    expect(NOMES_WIDGET.resumoIa).toBe('Resumo do dia (IA)');
  });
});
