// Pilha única do hackathon: SPA (S3 + CloudFront), API REST (API Gateway + Lambda + Cognito),
// DynamoDB tabela única, eventos de domínio (EventBridge) e resumo diário (EventBridge Scheduler + SES).
// RemovalPolicy.DESTROY em tudo para facilitar a limpeza da conta do evento.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  CfnOutput, Duration, RemovalPolicy, Stack, TimeZone, type StackProps,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url)); // raiz do repositório
const BACKEND = join(RAIZ, 'backend');
const FRONTEND_DIST = join(RAIZ, 'frontend', 'dist', 'frontend', 'browser');
export const SETORES_DEMO = ['GABSUB3-DVT', 'CIVINT/STIC'];
export const PERFIS = ['MEMBRO', 'CHEFE', 'SERVIDOR'];

export interface LexGabineteProps extends StackProps {
  remetente?: string;
  destinatarioDemo?: string;
  dataReferencia: string;
  /** Permite sintetizar nos testes sem o build do frontend. */
  publicarFrontend?: boolean;
}

export class LexGabineteStack extends Stack {
  constructor(scope: Construct, id: string, props: LexGabineteProps) {
    super(scope, id, props);

    // ---------- dados ----------
    const tabela = new dynamodb.TableV2(this, 'Tabela', {
      tableName: 'Expedientes',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      encryption: dynamodb.TableEncryptionV2.awsManagedKey(), // KMS (aws/dynamodb)
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      globalSecondaryIndexes: ['GSI1', 'GSI2'].map((nome) => ({
        indexName: nome,
        partitionKey: { name: `${nome}PK`, type: dynamodb.AttributeType.STRING },
        sortKey: { name: `${nome}SK`, type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      })),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ---------- autenticação ----------
    const usuarios = new cognito.UserPool(this, 'Usuarios', {
      userPoolName: 'lex-gabinete-usuarios',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: false }, fullname: { required: false, mutable: true } },
      // Identidade e setor no ID token, imutáveis; o perfil vem do grupo (cognito:groups).
      customAttributes: {
        idUsuario: new cognito.StringAttribute({ minLen: 1, maxLen: 40, mutable: false }),
        siglaSetor: new cognito.StringAttribute({ minLen: 1, maxLen: 40, mutable: false }),
      },
      passwordPolicy: { minLength: 12, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.NONE,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    for (const perfil of PERFIS) {
      new cognito.CfnUserPoolGroup(this, `Grupo${perfil}`, { userPoolId: usuarios.userPoolId, groupName: perfil });
    }
    const cliente = usuarios.addClient('Spa', {
      userPoolClientName: 'lex-gabinete-spa',
      generateSecret: false,
      authFlows: { userPassword: true },
      preventUserExistenceErrors: true,
      idTokenValidity: Duration.hours(8),
      accessTokenValidity: Duration.hours(8),
      refreshTokenValidity: Duration.days(1),
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true, fullname: true })
        .withCustomAttributes('idUsuario', 'siglaSetor'),
      // custom:idUsuario e custom:siglaSetor não são graváveis pelo cliente: a identidade não pode ser trocada pela tela.
      // email entra porque é obrigatório (o Cognito exige atributos obrigatórios graváveis); como é imutável e não há
      // autocadastro, o cliente não consegue alterá-lo.
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({ email: true, fullname: true }),
    });

    // ---------- eventos de domínio ----------
    const barramento = new events.EventBus(this, 'Barramento', { eventBusName: 'lex-gabinete' });

    // ---------- funções ----------
    const funcao = (nome: string, arquivo: string, ambiente: Record<string, string>, timeout = 15) =>
      new nodejs.NodejsFunction(this, nome, {
        entry: join(BACKEND, 'src', 'lambdas', arquivo),
        projectRoot: BACKEND,
        depsLockFilePath: join(BACKEND, 'package-lock.json'),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.seconds(timeout),
        tracing: lambda.Tracing.ACTIVE,
        environment: { TABELA: tabela.tableName, DATA_REFERENCIA: props.dataReferencia, NODE_OPTIONS: '--enable-source-maps', ...ambiente },
        logGroup: new logs.LogGroup(this, `${nome}Logs`, { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY }),
        bundling: {
          format: nodejs.OutputFormat.ESM,
          target: 'node22',
          minify: true,
          sourceMap: true,
          mainFields: ['module', 'main'],
          // AWS SDK v3 já vem no runtime; o resto (zod) vai no pacote.
          externalModules: ['@aws-sdk/*'],
          banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        },
      });

    const api = funcao('Api', 'api.ts', { BARRAMENTO: barramento.eventBusName });
    tabela.grantReadWriteData(api);
    barramento.grantPutEventsTo(api);

    const notificador = funcao('Notificador', 'notificador.ts', {});
    tabela.grantWriteData(notificador);

    const resumo = funcao('ResumoDiario', 'resumo-diario.ts', {
      SETORES: SETORES_DEMO.join(','),
      ...(props.remetente ? { REMETENTE: props.remetente } : {}),
      ...(props.destinatarioDemo ? { DESTINATARIO_DEMO: props.destinatarioDemo } : {}),
    }, 60);
    tabela.grantReadData(resumo);
    if (props.remetente) {
      // Só as identidades verificadas usadas no envio (remetente e, em sandbox, o destinatário).
      const identidades = [props.remetente, props.destinatarioDemo].filter((e): e is string => !!e)
        .map((e) => `arn:aws:ses:${this.region}:${this.account}:identity/${e}`);
      resumo.addToRolePolicy(new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: identidades }));
    }

    // Designação → notificação, fora do caminho da requisição, com nova tentativa e fila de mensagens mortas.
    const mortas = new sqs.Queue(this, 'EventosNaoEntregues', {
      retentionPeriod: Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    new events.Rule(this, 'RegraDesignacao', {
      eventBus: barramento,
      eventPattern: { source: ['lex-gabinete.expedientes'], detailType: ['ExpedienteDesignado'] },
      targets: [new eventTargets.LambdaFunction(notificador, { retryAttempts: 3, maxEventAge: Duration.hours(1), deadLetterQueue: mortas })],
    });

    // Resumo diário: dias úteis, 7h de Brasília.
    new scheduler.Schedule(this, 'AgendaResumoDiario', {
      description: 'Resumo diário de prazos por e-mail (RF16)',
      schedule: scheduler.ScheduleExpression.cron({ minute: '0', hour: '7', weekDay: 'MON-FRI', timeZone: TimeZone.AMERICA_SAO_PAULO }),
      target: new schedulerTargets.LambdaInvoke(resumo, { retryAttempts: 2 }),
    });

    // ---------- API REST ----------
    const autorizador = new apigw.CognitoUserPoolsAuthorizer(this, 'Autorizador', {
      cognitoUserPools: [usuarios],
      identitySource: 'method.request.header.Authorization',
      resultsCacheTtl: Duration.minutes(5),
    });
    const logsApi = new logs.LogGroup(this, 'ApiAcessoLogs', { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY });
    const restApi = new apigw.RestApi(this, 'ApiRest', {
      restApiName: 'lex-gabinete-api',
      description: 'API do painel de expedientes (todas as rotas exigem Cognito)',
      endpointTypes: [apigw.EndpointType.REGIONAL],
      cloudWatchRole: true,
      cloudWatchRoleRemovalPolicy: RemovalPolicy.DESTROY,
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
        metricsEnabled: true,
        // Log de acesso sem corpo, sem cabeçalhos e sem query string.
        accessLogDestination: new apigw.LogGroupLogDestination(logsApi),
        accessLogFormat: apigw.AccessLogFormat.custom(JSON.stringify({
          requestId: '$context.requestId', ip: '$context.identity.sourceIp', metodo: '$context.httpMethod',
          recurso: '$context.resourcePath', status: '$context.status', latenciaMs: '$context.responseLatency',
          usuario: '$context.authorizer.claims.custom:idUsuario',
        })),
      },
      defaultMethodOptions: { authorizer: autorizador, authorizationType: apigw.AuthorizationType.COGNITO },
    });
    restApi.root.addResource('api').addProxy({ anyMethod: true, defaultIntegration: new apigw.LambdaIntegration(api, { proxy: true }) });
    // Respostas de erro do próprio API Gateway em JSON, no mesmo formato da aplicação.
    for (const [tipo, codigo] of [[apigw.ResponseType.UNAUTHORIZED, 'NAO_AUTENTICADO'], [apigw.ResponseType.ACCESS_DENIED, 'ACESSO_NEGADO']] as const) {
      restApi.addGatewayResponse(`Resposta${codigo}`, {
        type: tipo,
        templates: { 'application/json': JSON.stringify({ erro: codigo, mensagem: 'Autenticação necessária.' }) },
      });
    }

    // ---------- frontend ----------
    const site = new s3.Bucket(this, 'Site', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const reescritaSpa = new cloudfront.Function(this, 'ReescritaSpa', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Rotas da SPA (sem extensão) vão para index.html',
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event) { var r = event.request; if (r.uri.indexOf('.') === -1) { r.uri = '/index.html'; } return r; }",
      ),
    });

    const cabecalhos = new cloudfront.ResponseHeadersPolicy(this, 'CabecalhosSeguranca', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: [
            "default-src 'self'",
            `connect-src 'self' https://cognito-idp.${this.region}.amazonaws.com`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self' data:",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join('; '),
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
      },
    });

    const distribuicao = new cloudfront.Distribution(this, 'Distribuicao', {
      comment: 'Painel de expedientes (hackathon)',
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cabecalhos,
        functionAssociations: [{ function: reescritaSpa, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
        compress: true,
      },
      additionalBehaviors: {
        // Mesma origem para SPA e API: sem CORS. Sem cache; o Authorization chega ao API Gateway.
        '/api/*': {
          origin: new origins.RestApiOrigin(restApi),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: cabecalhos,
        },
      },
    });

    const configuracao = { modoAutenticacao: 'cognito', regiao: this.region, userPoolClientId: cliente.userPoolClientId };
    if (props.publicarFrontend !== false && existsSync(join(FRONTEND_DIST, 'index.html'))) {
      new s3deploy.BucketDeployment(this, 'PublicacaoFrontend', {
        destinationBucket: site,
        sources: [s3deploy.Source.asset(FRONTEND_DIST, { exclude: ['config.json'] }), s3deploy.Source.jsonData('config.json', configuracao)],
        distribution: distribuicao,
        distributionPaths: ['/*'],
        memoryLimit: 512,
      });
    }

    new CfnOutput(this, 'Url', { value: `https://${distribuicao.distributionDomainName}` });
    new CfnOutput(this, 'TabelaNome', { value: tabela.tableName });
    new CfnOutput(this, 'UserPoolId', { value: usuarios.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: cliente.userPoolClientId });
    new CfnOutput(this, 'BarramentoNome', { value: barramento.eventBusName });
  }
}
