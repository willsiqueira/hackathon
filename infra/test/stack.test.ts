// Verificações de segurança e arquitetura sobre o template sintetizado.

import { beforeAll, describe, expect, test } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { LexGabineteStack } from '../lib/lex-gabinete-stack.js';

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
