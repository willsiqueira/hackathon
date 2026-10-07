import { describe, expect, it } from 'vitest';
import { iniciais, PERFIS_DEMO, perfilPorEmail, perfilPorId } from './perfis-demo';

describe('Perfis de demonstração do login', () => {
  it('tem um usuário de cada perfil, todos do mesmo setor fictício', () => {
    expect(PERFIS_DEMO.map((p) => p.perfil)).toEqual(['MEMBRO', 'CHEFE', 'SERVIDOR']);
    expect(PERFIS_DEMO.every((p) => p.idUsuario.startsWith('GABSUB3-DVT-'))).toBe(true);
    expect(PERFIS_DEMO.every((p) => p.email.endsWith('@exemplo.org'))).toBe(true);
  });

  it('encontra o perfil pelo e-mail, ignorando maiúsculas e espaços', () => {
    expect(perfilPorEmail('  USUARIO02@exemplo.org ')?.perfil).toBe('CHEFE');
    expect(perfilPorEmail('outra.pessoa@exemplo.org')).toBeUndefined();
    expect(perfilPorEmail('')).toBeUndefined();
  });

  it('encontra o perfil pelo id', () => {
    expect(perfilPorId('GABSUB3-DVT-U03')?.nome).toBe('Carla Modelo');
    expect(perfilPorId('CIVINT-STIC-U01')).toBeUndefined();
  });

  it.each([
    ['Ana Exemplo', 'AE'],
    ['Bruno Teste', 'BT'],
    ['maria da silva', 'MS'],
    ['Cher', 'C'],
    ['   ', ''],
  ])('iniciais de "%s" → "%s"', (nome, esperado) => {
    expect(iniciais(nome)).toBe(esperado);
  });
});
