// Perfis de demonstração da tela de login (usuários fictícios de usuarios.csv, setor GABSUB3-DVT).
// O cartão só preenche o e-mail (Cognito) ou o usuário (modo local); a senha continua obrigatória na AWS.

export interface PerfilDemo {
  idUsuario: string;
  nome: string;
  perfil: 'MEMBRO' | 'CHEFE' | 'SERVIDOR';
  rotulo: string;
  foco: string;
  email: string;
}

export const PERFIS_DEMO: readonly PerfilDemo[] = Object.freeze([
  { idUsuario: 'GABSUB3-DVT-U01', nome: 'Ana Exemplo', perfil: 'MEMBRO', rotulo: 'Membro', foco: 'Prazos e indicadores', email: 'usuario01@exemplo.org' },
  { idUsuario: 'GABSUB3-DVT-U02', nome: 'Bruno Teste', perfil: 'CHEFE', rotulo: 'Chefe de gabinete', foco: 'Distribuição e carga da equipe', email: 'usuario02@exemplo.org' },
  { idUsuario: 'GABSUB3-DVT-U03', nome: 'Carla Modelo', perfil: 'SERVIDOR', rotulo: 'Servidor', foco: 'A própria fila de trabalho', email: 'usuario03@exemplo.org' },
]);

/** Perfil de demonstração com esse e-mail (sem diferenciar maiúsculas e espaços), se houver. */
export function perfilPorEmail(email: string): PerfilDemo | undefined {
  const normalizado = email.trim().toLowerCase();
  return PERFIS_DEMO.find((p) => p.email === normalizado);
}

/** Perfil de demonstração com esse id de usuário, se houver. */
export function perfilPorId(idUsuario: string): PerfilDemo | undefined {
  return PERFIS_DEMO.find((p) => p.idUsuario === idUsuario);
}

/** Iniciais para o avatar: primeira letra do primeiro e do último nome. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '';
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (primeira + ultima).toUpperCase();
}
