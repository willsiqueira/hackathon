// Cadastra no Cognito os usuários fictícios de docs/hackathon-expedientes/seed/saida/csv/usuarios.csv (idempotente).
//   USER_POOL_ID=us-east-1_xxx SENHA_DEMO='Senha-Forte-123' npm run usuarios
// A senha vem do ambiente e não é gravada em arquivo. custom:idUsuario e custom:siglaSetor ligam a conta ao cadastro;
// o perfil (MEMBRO, CHEFE, SERVIDOR) vira grupo do Cognito e chega ao backend em cognito:groups.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AdminAddUserToGroupCommand, AdminCreateUserCommand, AdminSetUserPasswordCommand, CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';

const CSV = fileURLToPath(new URL('../../docs/hackathon-expedientes/seed/saida/csv/usuarios.csv', import.meta.url));

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`Defina ${nome}.`);
    process.exit(1);
  }
  return valor;
}

const poolId = exigir('USER_POOL_ID');
const senha = exigir('SENHA_DEMO');
if (senha.length < 12 || !/[a-z]/.test(senha) || !/[A-Z]/.test(senha) || !/\d/.test(senha)) {
  console.error('SENHA_DEMO precisa de 12+ caracteres, com maiúscula, minúscula e número.');
  process.exit(1);
}

const [cabecalho, ...linhas] = readFileSync(CSV, 'utf8').trim().split(/\r?\n/);
const colunas = cabecalho.split(',');
const usuarios = linhas.map((l) => Object.fromEntries(l.split(',').map((v, i) => [colunas[i], v])));
// Perfil da conta do evento por padrão (funciona igual em Bash e PowerShell); AWS_PROFILE explícito prevalece.
process.env.AWS_PROFILE ??= 'hackathon';
const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1' });

for (const u of usuarios) {
  if (u.ativo !== 'true') continue;
  try {
    await cognito.send(new AdminCreateUserCommand({
      UserPoolId: poolId,
      Username: u.email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: u.email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: u.nome },
        { Name: 'custom:idUsuario', Value: u.idUsuario },
        { Name: 'custom:siglaSetor', Value: u.siglaSetor },
      ],
    }));
  } catch (erro) {
    if (!(erro instanceof UsernameExistsException)) throw erro;
  }
  await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: poolId, Username: u.email, Password: senha, Permanent: true }));
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: poolId, Username: u.email, GroupName: u.perfil }));
  console.log(`${u.email}  ${u.perfil.padEnd(8)} ${u.siglaSetor}  ${u.nome}`);
}
