// Lambda agendada (EventBridge Scheduler, dias úteis às 7h): envia o resumo diário por SES.
// Sem REMETENTE configurado, só registra a contagem (útil na conta do evento, com SES em sandbox).
// DESTINATARIO_DEMO redireciona todos os e-mails para um endereço verificado (os e-mails da base são fictícios).

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { Repositorio } from '../dados/repositorio.js';
import { TabelaDynamo } from '../dados/tabela-dynamo.js';
import { destinatariosDoSetor, resumoDoUsuario } from '../servicos/resumo.js';
import { criarRelogio, variavelObrigatoria } from '../config.js';

const repo = new Repositorio(new TabelaDynamo(variavelObrigatoria('TABELA')));
const relogio = criarRelogio();
const ses = new SESv2Client({});

export async function handler(): Promise<{ resumos: number; enviados: number }> {
  const setores = variavelObrigatoria('SETORES').split(',').map((s) => s.trim()).filter(Boolean);
  const remetente = process.env.REMETENTE;
  const destinoDemo = process.env.DESTINATARIO_DEMO;
  const agora = relogio();
  let resumos = 0;
  let enviados = 0;
  for (const sigla of setores) {
    for (const usuario of await destinatariosDoSetor(repo, sigla)) {
      const resumo = await resumoDoUsuario(repo, usuario, agora);
      resumos += 1;
      const para = destinoDemo || resumo.email;
      if (!remetente || !para) continue;
      await ses.send(new SendEmailCommand({
        FromEmailAddress: remetente,
        Destination: { ToAddresses: [para] },
        Content: { Simple: { Subject: { Data: resumo.assunto, Charset: 'UTF-8' }, Body: { Text: { Data: resumo.texto, Charset: 'UTF-8' } } } },
      }));
      enviados += 1;
    }
  }
  // Só números no log: nada de e-mail, nome ou etiqueta.
  console.log(JSON.stringify({ nivel: 'INFO', mensagem: 'Resumo diário', setores: setores.length, resumos, enviados }));
  return { resumos, enviados };
}
