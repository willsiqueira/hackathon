// Lambda da API: API Gateway REST (proxy, payload 1.0) com Cognito User Pool Authorizer.

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { criarApi } from '../api/roteador.js';
import { identidadeDasClaims } from '../api/autenticacao.js';
import { lerCorpoJson } from '../api/http.js';
import { Repositorio } from '../dados/repositorio.js';
import { TabelaDynamo } from '../dados/tabela-dynamo.js';
import { PublicadorEventBridge } from '../eventos/publicador-eventbridge.js';
import { criarRelogio, variavelObrigatoria } from '../config.js';
import { criarIa } from '../servicos/ia.js';

const tratar = criarApi({
  repo: new Repositorio(new TabelaDynamo(variavelObrigatoria('TABELA'))),
  eventos: new PublicadorEventBridge(variavelObrigatoria('BARRAMENTO')),
  relogio: criarRelogio(),
  // BEDROCK_MODEL_ID e IA_TIMEOUT_MS vêm da stack; sem modelo, cai no modo demonstração.
  ia: criarIa(),
});

export async function handler(evento: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const texto = evento.body && evento.isBase64Encoded ? Buffer.from(evento.body, 'base64').toString('utf8') : evento.body;
  const resposta = await tratar({
    metodo: evento.httpMethod,
    caminho: evento.path,
    query: evento.queryStringParameters ?? {},
    corpo: () => lerCorpoJson(texto),
    obterIdentidade: () => identidadeDasClaims(evento.requestContext?.authorizer?.claims),
  });
  return { statusCode: resposta.status, headers: resposta.cabecalhos, body: resposta.corpo };
}
