// Permissões do Amazon Bedrock para a Lambda da API (busca em linguagem natural e resumo do dia).
// Função pura, para testar os ARNs sem sintetizar a pilha.
//
// Converse (sem streaming) é autorizado pela ação bedrock:InvokeModel. Com inference profile geográfico
// (ex.: us.amazon.nova-lite-v1:0), a doc "Geographic cross-Region inference" pede InvokeModel no ARN do profile
// e no foundation model de cada região de destino, este com a condição bedrock:InferenceProfileArn
// (o modelo só pode ser chamado por meio do profile). Nenhum "*" em ação, região, conta ou modelo.

import type * as iam from 'aws-cdk-lib/aws-iam';

export const MODELO_IA_PADRAO = 'us.amazon.nova-lite-v1:0';
/** Destinos do profile us. com origem em us-east-1 (model card do Nova Lite). */
export const REGIOES_MODELO_IA_PADRAO = ['us-east-1', 'us-east-2', 'us-west-2'];

const PREFIXO_GEOGRAFICO = /^(us|eu|apac|jp|au|ca|us-gov)\./;
const ACAO = 'bedrock:InvokeModel';

export function permissoesModeloIa(args: {
  modelo: string;
  regiao: string;
  conta: string;
  regioesDestino: string[];
}): iam.PolicyStatementProps[] {
  const modelo = args.modelo?.trim();
  if (!modelo || modelo.includes('*')) throw new Error(`Modelo de IA inválido: "${args.modelo}". Use um ID explícito, sem "*".`);
  const regioes = args.regioesDestino.map((r) => r.trim()).filter(Boolean);
  if (regioes.some((r) => r.includes('*'))) throw new Error('Regiões do modelo de IA não podem conter "*".');

  const prefixo = PREFIXO_GEOGRAFICO.exec(modelo);
  if (!prefixo) {
    return [{ actions: [ACAO], resources: [`arn:aws:bedrock:${args.regiao}::foundation-model/${modelo}`] }];
  }
  if (!regioes.length) throw new Error('Informe as regiões de destino do inference profile.');
  const perfil = `arn:aws:bedrock:${args.regiao}:${args.conta}:inference-profile/${modelo}`;
  const semPrefixo = modelo.slice(prefixo[0].length);
  return [
    { actions: [ACAO], resources: [perfil] },
    {
      actions: [ACAO],
      resources: regioes.map((r) => `arn:aws:bedrock:${r}::foundation-model/${semPrefixo}`),
      conditions: { StringEquals: { 'bedrock:InferenceProfileArn': perfil } },
    },
  ];
}
