#!/usr/bin/env node
// App CDK. Região fixa us-east-1 (conta do evento). Parâmetros opcionais por contexto:
//   -c remetente=email@verificado      remetente do resumo diário (SES)
//   -c destinatarioDemo=email@verificado redireciona os resumos (os e-mails da base são fictícios)
//   -c dataReferencia=2026-10-07T17:00:00-03:00   "hoje" da API (padrão: data do evento)

import { App, Tags } from 'aws-cdk-lib';
import { LexGabineteStack } from '../lib/lex-gabinete-stack.js';

const app = new App();
const stack = new LexGabineteStack(app, 'LexGabinete', {
  // Conta do evento (perfil AWS "hackathon"); nunca o perfil default.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT ?? '698271685662', region: 'us-east-1' },
  description: 'Painel de expedientes do gabinete - Hackathon MPF & AWS 2026 (dados sintéticos)',
  remetente: app.node.tryGetContext('remetente'),
  destinatarioDemo: app.node.tryGetContext('destinatarioDemo'),
  dataReferencia: app.node.tryGetContext('dataReferencia') ?? '2026-10-07T17:00:00-03:00',
});
Tags.of(stack).add('projeto', 'lex-gabinete');
Tags.of(stack).add('evento', 'hackathon-mpf-aws-2026');
Tags.of(stack).add('dados', 'sinteticos');
