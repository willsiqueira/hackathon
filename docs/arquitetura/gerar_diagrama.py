"""Gera o diagrama de arquitetura AWS do painel (docs/arquitetura/arquitetura-aws.png).

Reflete a pilha infra/lib/lex-gabinete-stack.ts. Requer Graphviz (dot no PATH).
Uso, na raiz do repositório (PowerShell):
    $env:Path = "C:\\Program Files\\Graphviz\\bin;$env:Path"
    $env:UV_CACHE_DIR = "C:\\uv-cache"   # só se o caminho do usuário tiver acento (ver abaixo)
    uv run --no-project --with diagrams==0.25.1 python docs/arquitetura/gerar_diagrama.py

Se o diagrama sair sem ícones, o Graphviz não conseguiu ler os PNGs do pacote: aponte UV_CACHE_DIR para uma pasta
com caminho só em ASCII (por exemplo C:\\uv-cache).
"""
from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb
from diagrams.aws.devtools import XRay
from diagrams.aws.engagement import SimpleEmailServiceSes
from diagrams.aws.integration import Eventbridge, EventbridgeScheduler, SimpleQueueServiceSqs
from diagrams.aws.management import Cloudformation, Cloudwatch
from diagrams.aws.ml import Bedrock
from diagrams.aws.network import APIGateway, CloudFront
from diagrams.aws.security import Cognito
from diagrams.aws.storage import SimpleStorageServiceS3
from diagrams.onprem.client import Users

SAIDA = Path(__file__).with_name("arquitetura-aws")

grafo = {"pad": "0.5", "nodesep": "0.9", "ranksep": "1.3", "fontsize": "22", "labelloc": "t", "splines": "spline"}
nos = {"fontsize": "13"}

with Diagram(
    "Painel do gabinete: arquitetura na AWS (us-east-1)",
    filename=str(SAIDA),
    outformat="png",
    show=False,
    direction="LR",
    graph_attr=grafo,
    node_attr=nos,
):
    usuarios = Users("Membro, chefe\ne servidor\n(navegador)")

    with Cluster("Borda e frontend"):
        cdn = CloudFront("CloudFront\nHTTPS, CSP, HSTS")
        site = SimpleStorageServiceS3("S3 privado (OAC, SSE)\nSPA Angular + Bootstrap")

    cognito = Cognito("Cognito User Pool\ngrupos MEMBRO, CHEFE,\nSERVIDOR")

    with Cluster("API (nenhuma rota anônima)"):
        api_gw = APIGateway("API Gateway REST\nautorizador Cognito\nthrottling")
        api = Lambda("Lambda Api\nNode.js 22\nRN1–RN7, sigilo, zod")

    with Cluster("Dados"):
        tabela = Dynamodb("DynamoDB Expedientes\ntabela única, GSI1, GSI2\nsob demanda, KMS, PITR")

    with Cluster("IA generativa"):
        bedrock = Bedrock("Amazon Bedrock\nNova Lite (perfil us.)\nbusca e resumo do dia")

    with Cluster("Eventos e notificações (assíncrono)"):
        barramento = Eventbridge("EventBridge\nExpedienteDesignado")
        notificador = Lambda("Lambda Notificador")
        dlq = SimpleQueueServiceSqs("SQS (DLQ)")
        agenda = EventbridgeScheduler("Scheduler\ndias úteis, 7h")
        resumo = Lambda("Lambda Resumo diário")
        ses = SimpleEmailServiceSes("SES\nresumo por e-mail")

    with Cluster("Operação"):
        cdk = Cloudformation("AWS CDK v2\n(CloudFormation)")
        logs = Cloudwatch("CloudWatch Logs")
        xray = XRay("X-Ray")

    # Caminho da requisição
    usuarios >> Edge(xlabel="HTTPS") >> cdn
    cdn >> Edge(xlabel="/*") >> site
    cdn >> Edge(xlabel="/api/*") >> api_gw
    usuarios >> Edge(xlabel="login", style="dashed") >> cognito
    cognito >> Edge(style="dashed") >> api_gw
    api_gw >> api
    api >> Edge(xlabel="Query por SETOR#") >> tabela
    api >> Edge(xlabel="Converse, só dados\nminimizados") >> bedrock

    # Assíncrono
    api >> Edge(xlabel="evento") >> barramento
    barramento >> notificador
    barramento >> Edge(style="dashed", xlabel="falhas") >> dlq
    notificador >> tabela
    agenda >> resumo
    resumo >> tabela
    resumo >> ses

    # Operação (sem setas para não poluir: CDK implanta tudo; logs e X-Ray recebem das Lambdas)
    cdk - Edge(style="invis") - logs - Edge(style="invis") - xray
    api >> Edge(style="dotted", color="gray") >> logs

print(f"Diagrama gerado em {SAIDA}.png")
