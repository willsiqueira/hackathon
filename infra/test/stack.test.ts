// Verificações de segurança e arquitetura sobre o template sintetizado.

import { beforeAll, describe, expect, test } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { LexGabineteStack } from '../lib/lex-gabinete-stack.js';
import { MODELO_IA_PADRAO, permissoesModeloIa, REGIOES_MODELO_IA_PADRAO } from '../lib/permissoes-ia.js';

let template: Template;

beforeAll(() => {
  const app = new App();
  const stack = new LexGabineteStack(app, 'Teste', {
    env: { account: '111111111111', region: 'us-east-1' },
    dataReferencia: '2026-10-07T17:00:00-03:00',
    publicarFrontend: false,
  });
  template = Template.fromStack(stack);
}, 120000);

describe('Dados', () => {
  test('tabela única com GSI1 e GSI2, sob demanda, PITR e KMS', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'Expedientes',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'GSI1' }), Match.objectLike({ IndexName: 'GSI2' })]),
      SSESpecification: Match.objectLike({ SSEEnabled: true, SSEType: 'KMS' }),
      Replicas: [Match.objectLike({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } })],
    });
  });
});

describe('Segurança', () => {
  test('nenhum método da API é anônimo', () => {
    const metodos = template.findResources('AWS::ApiGateway::Method');
    expect(Object.keys(metodos).length).toBeGreaterThan(0);
    for (const metodo of Object.values(metodos)) {
      expect(metodo.Properties.AuthorizationType).toBe('COGNITO_USER_POOLS');
    }
  });

  test('cadastro só pelo administrador e idUsuario imutável', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      Schema: Match.arrayWith([Match.objectLike({ Name: 'idUsuario', Mutable: false }), Match.objectLike({ Name: 'siglaSetor', Mutable: false })]),
    });
  });

  test('bucket privado, criptografado e só com HTTPS', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      BucketEncryption: Match.objectLike({ ServerSideEncryptionConfiguration: [Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } })] }),
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } })]) },
    });
  });

  test('CloudFront só com HTTPS e cabeçalhos de segurança', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
        CacheBehaviors: [Match.objectLike({ PathPattern: '/api/*', ViewerProtocolPolicy: 'https-only' })],
      }),
    });
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({ ContentSecurityPolicy: Match.objectLike({ ContentSecurityPolicy: Match.stringLikeRegexp("frame-ancestors 'none'") }) }),
      }),
    });
  });

  test('políticas IAM das funções da aplicação sem ação ou recurso "*"', () => {
    const politicas = template.findResources('AWS::IAM::Policy');
    const daAplicacao = Object.entries(politicas).filter(([id]) => /^(Api|Notificador|ResumoDiario)ServiceRole/.test(id));
    expect(daAplicacao.length).toBe(3);
    for (const [, politica] of daAplicacao) {
      for (const declaracao of politica.Properties.PolicyDocument.Statement) {
        const acoes = [declaracao.Action].flat();
        expect(acoes).not.toContain('*');
        expect(acoes.some((a: string) => a.endsWith(':*'))).toBe(false);
        // X-Ray exige "*" como recurso; para o resto, recurso explícito.
        if (!acoes.every((a: string) => a.startsWith('xray:'))) expect(declaracao.Resource).not.toBe('*');
      }
    }
  });
});

describe('IA (Bedrock)', () => {
  const PERFIL = 'arn:aws:bedrock:us-east-1:111111111111:inference-profile/us.amazon.nova-lite-v1:0';
  const MODELOS = ['us-east-1', 'us-east-2', 'us-west-2'].map((r) => `arn:aws:bedrock:${r}::foundation-model/amazon.nova-lite-v1:0`);
  const declaracoesDe = (padrao: RegExp) => Object.entries(template.findResources('AWS::IAM::Policy'))
    .filter(([id]) => padrao.test(id))
    .flatMap(([, politica]) => politica.Properties.PolicyDocument.Statement);
  const usaBedrock = (d: { Action: string | string[] }) => [d.Action].flat().some((a) => a.startsWith('bedrock:'));

  test('a. Api recebe o modelo e o timeout da IA', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ BEDROCK_MODEL_ID: 'us.amazon.nova-lite-v1:0', IA_TIMEOUT_MS: '10000' }) },
      Timeout: 15,
    });
  });

  test('b. role da Api: InvokeModel no profile e nos foundation models de destino, com condição', () => {
    const doBedrock = declaracoesDe(/^ApiServiceRole/).filter(usaBedrock);
    expect(doBedrock).toHaveLength(2);
    expect(doBedrock).toContainEqual(expect.objectContaining({ Action: 'bedrock:InvokeModel', Effect: 'Allow', Resource: PERFIL }));
    const modelos = doBedrock.find((d) => Array.isArray(d.Resource));
    expect(modelos).toMatchObject({
      Action: 'bedrock:InvokeModel',
      Condition: { StringEquals: { 'bedrock:InferenceProfileArn': PERFIL } },
    });
    expect([...modelos.Resource].sort()).toEqual([...MODELOS].sort());
  });

  test('c. só a Api fala com o Bedrock, sem curinga', () => {
    expect(declaracoesDe(/^(Notificador|ResumoDiario)ServiceRole/).some(usaBedrock)).toBe(false);
    const todas = declaracoesDe(/./).filter(usaBedrock);
    for (const d of todas) {
      expect([d.Action].flat()).toEqual(['bedrock:InvokeModel']);
      for (const recurso of [d.Resource].flat()) expect(String(recurso)).not.toContain('*');
    }
  });

  test('d. permissoesModeloIa: modelo sem profile e curinga recusado', () => {
    expect(permissoesModeloIa({ modelo: 'amazon.nova-lite-v1:0', regiao: 'us-east-1', conta: '111111111111', regioesDestino: REGIOES_MODELO_IA_PADRAO }))
      .toEqual([{ actions: ['bedrock:InvokeModel'], resources: ['arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0'] }]);
    expect(() => permissoesModeloIa({ modelo: '*', regiao: 'us-east-1', conta: '111111111111', regioesDestino: [] })).toThrow(/sem "\*"/);
    expect(() => permissoesModeloIa({ modelo: 'us.amazon.*', regiao: 'us-east-1', conta: '111111111111', regioesDestino: ['us-east-1'] })).toThrow();
    expect(() => permissoesModeloIa({ modelo: MODELO_IA_PADRAO, regiao: 'us-east-1', conta: '111111111111', regioesDestino: ['*'] })).toThrow();
  });
});

describe('Eventos', () => {
  test('designação vai do barramento ao notificador, com fila de mensagens mortas', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: { source: ['lex-gabinete.expedientes'], 'detail-type': ['ExpedienteDesignado'] },
      Targets: [Match.objectLike({ DeadLetterConfig: Match.anyValue(), RetryPolicy: Match.objectLike({ MaximumRetryAttempts: 3 }) })],
    });
  });

  test('resumo diário agendado em dias úteis no fuso de Brasília', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(0 7 ? * MON-FRI *)',
      ScheduleExpressionTimezone: 'America/Sao_Paulo',
    });
  });
});
