# Design: painel de expedientes do gabinete

## Visão geral

```mermaid
flowchart LR
  U[Navegador<br/>SPA Angular] -->|HTTPS| CF[CloudFront<br/>CSP, HSTS]
  CF -->|/*| S3[(S3 privado<br/>OAC, SSE)]
  CF -->|/api/*| APIGW[API Gateway REST<br/>Cognito User Pool Authorizer]
  U -->|InitiateAuth| COG[Cognito<br/>custom:idUsuario, custom:siglaSetor, grupos]
  APIGW --> API[Lambda Api]
  API --> DDB[(DynamoDB Expedientes<br/>PK/SK + GSI1 + GSI2, KMS, PITR)]
  API -->|ExpedienteDesignado, LoteExecutado| EB[EventBridge<br/>barramento lex-gabinete]
  EB -->|regra + DLQ SQS| NOT[Lambda Notificador]
  NOT --> DDB
  SCH[EventBridge Scheduler<br/>dias úteis 7h] --> RES[Lambda ResumoDiario]
  RES --> DDB
  RES --> SES[Amazon SES]
  API -->|Converse, só dados minimizados| BR[Amazon Bedrock<br/>Nova Lite, perfil us.]
```

| Pasta | Conteúdo |
| --- | --- |
| `frontend/` | Angular 22 standalone + Bootstrap 5, padrão visual do Único e do protótipo `docs/hackathon-expedientes/Unico — Caixa do Gabinete.html` |
| `backend/` | TypeScript (Node.js 22), zod, Vitest. Três Lambdas (`api`, `notificador`, `resumo-diario`) e um servidor local com a mesma API |
| `infra/` | AWS CDK v2 em TypeScript, uma pilha (`LexGabinete`), `NodejsFunction` com esbuild local |
| `docs/hackathon-expedientes/` | Kit: requisitos, dicionário de dados, seed (`seed/saida/dynamodb/itens.json`) |

A SPA e a API ficam na mesma origem (CloudFront encaminha `/api/*`), então não há CORS.

## Camadas do backend

```text
backend/src
├── dominio/      regras puras, sem I/O (testes unitários)
│   ├── regras.ts        statusPrazo, pontuação com composição, prioridade, risco, recálculo, ordem da fila, chaves GSI
│   ├── criterios.ts     filtros (JSON de filtros_salvos) validados com zod, busca textual, ordenação
│   ├── acesso.ts        setor, sigilo, máscara para tela e para exportação
│   ├── lote.ts          esquema zod do lote, validação por item (prévia) e efeito de cada ação
│   ├── designacao.ts    índice de carga e distribuição balanceada
│   └── ia.ts            prompts, minimização dos itens e interpretação das respostas da IA
├── dados/        Tabela (interface) → TabelaMemoria | TabelaDynamo; repositorio.ts conhece as chaves
├── eventos/      eventos de domínio, publicador EventBridge, notificador (idempotente)
├── servicos/     painel (contadores, fila), lotes (prévia, execução, desfazer), resumo diário, ia (Bedrock, demonstração, cache)
├── api/          roteador, autenticação, http (zod, erros), formatos (CSV, ICS), handlers finos
├── lambdas/      api.ts (REST proxy), notificador.ts (EventBridge), resumo-diario.ts (Scheduler + SES)
└── local/        servidor HTTP local (tabela em memória carregada do itens.json)
```

## Modelo de dados

Mesmas chaves do `itens.json` (ver `docs/hackathon-expedientes/README.md`). Itens novos seguem o padrão:

| Acesso | Chave | Uso |
| --- | --- | --- |
| Usuário | `PK=USR#<id>`, `SK=PERFIL` | Conferência do usuário autenticado |
| Usuários do setor | `GSI1PK=SETOR#<sigla>`, `GSI1SK` begins `USR#` | Responsável, designação |
| Painel | `GSI1PK=SETOR#<sigla>`, `GSI1SK` begins `ATIVO#[<ger>#]` | Lista, contadores, tela inicial |
| Fila | `GSI2PK=SETOR#<sigla>`, `GSI2SK` begins `PRAZO#` | Modo foco |
| Detalhe | `PK=EXP#<id>` | `META`, `MOV#`, `PRZ#`, `DES#`, `ANO#`, `ROT#` numa só Query |
| Designações ativas | `GSI1PK=USR#<id>`, `GSI1SK` begins `DES#ATIVA#` | Carga por pessoa |
| Alertas, preferências, filtros, lotes | `PK=USR#<id>`, `SK` begins `NOT#`, `PREF#`, `FILTRO#`, `LOTE#` | |
| Lotes do setor | `GSI1PK=SETOR#<sigla>`, `GSI1SK` begins `LOTE#` | Trilha |
| Imagem para desfazer (novo) | `PK=LOTE#<id>`, `SK=UNDO#<seq>` | Estado anterior de cada item alterado |
| Estoque, produtividade, marcadores | `PK=SETOR#<sigla>`, `SK` begins `EST#`, `PROD#`, `ROT#` | Indicadores |
| Informes, catálogos | `PK=NOTICIA`; `PK=CATALOGO#<dominio>` | |

Nenhuma leitura usa `Scan`. Ao gravar um expediente, o repositório recalcula prazo e prioridade e regrava `GSI1SK`
(`ATIVO#…`/`HIST#…`), `GSI2PK` (`SETOR#<sigla>` ou `SETOR#<sigla>#HIST`) e `GSI2SK`. O atributo `versao` do `META`
cresce a cada alteração e protege o desfazer. Os contadores da tela inicial são calculados dos ativos (não de `CONT#`),
para refletir as ações da demonstração.

## Regras de domínio

- `diasRestantes` em dias de calendário no fuso −03:00; `tempoParadoDias` e `diasNoSetor` em dias decorridos (como o
  gerador). Todo ativo é recalculado pela data de referência antes de filtrar e ordenar. Com a referência do seed, os
  contadores batem com `contadores.csv` (teste de API).
- Pontuação, faixas e fila conforme RN1–RN3; a composição sai como `[{motivo, pontos}]` para explicar a prioridade.
- Risco: `null` para vencidos; nulos vão para o fim na ordenação.

### Ações em lote

| Ação | Caixa | Outras condições | Efeito |
| --- | --- | --- | --- |
| RECEBER | A_RECEBER | — | NO_SETOR, `EM_ANALISE`, `dataRecebimento`, MOV `RECEBIMENTO` |
| DESIGNAR | NO_SETOR | autor MEMBRO/CHEFE; destinatário ativo do setor; não repetir o designado | encerra designação ativa, cria `DES#`, MOV `DESIGNACAO`, evento `ExpedienteDesignado` |
| INCLUIR_MARCADOR | NO_SETOR | marcador do setor e do gerenciador; não repetido | `ROT#` + lista `marcadores`, MOV `MARCADOR_INCLUIDO` |
| DAR_CIENCIA | NO_SETOR | JUDICIAL com nova intimação ou `AGUARDANDO_CIENCIA` | `novaIntimacao=false`, MOV `CIENCIA` |
| ASSINAR | NO_SETOR | autor MEMBRO; `AGUARDANDO_ASSINATURA` | `PRONTO_PARA_ENVIO`, minutas = 0, MOV `ASSINATURA` |
| MOVIMENTAR | NO_SETOR | destino informado e diferente do setor | ENVIADO_NAO_RECEBIDO, MOV `ENVIO_PELO_SETOR` |
| ARQUIVAR | NO_SETOR | sem minuta pendente (RN5) | BAIXADO, encerra designação, MOV `ARQUIVAMENTO` |

`POST /api/lotes/previa` analisa sem gravar. `POST /api/lotes` valida de novo, grava cada expediente numa
`TransactWriteItems`, guarda as imagens anteriores e o registro do lote, e publica os eventos. `POST
/api/lotes/{id}/desfazer` só para o autor; restaura os expedientes cuja `versao` não mudou depois do lote. Prévia de
expediente de outro setor devolve só o id e o motivo.

### Designação balanceada

`carga = ativas + 2 × vencidas`; `capacidade = 1 + ações(30 dias) ÷ 30`; `índice = carga ÷ capacidade`. Distribuição
gulosa pelo menor índice, sem devolver o item a quem já é o designado. Candidatos: SERVIDOR ativos do setor.

### Eventos e resumo diário

- `ExpedienteDesignado` → regra do EventBridge → Lambda Notificador (3 tentativas, DLQ SQS) → `NOT#` para o
  designado. O id da notificação deriva da designação: reentregas não duplicam.
- Resumo diário (dias úteis, 7h de Brasília): para quem marcou `notificarPorEmail`, envia por SES vencidos, vencem hoje,
  novos e devoluções vencidas, mais as etiquetas dos próprios prazos. Nunca assunto ou conteúdo. `GET
  /api/resumo-diario` mostra a prévia na tela de alertas.

## API (todas exigem Cognito; nenhuma rota anônima)

| Método e rota | Descrição |
| --- | --- |
| `GET /api/me`, `GET /api/inicio`, `GET /api/resumo-diario` | Usuário e setor, tela inicial, prévia do resumo |
| `GET /api/expedientes` | `gerenciador`, `caixa`, `q`, `criterios` (JSON), `ordenacao`, `pagina`, `tamanho` (10–100) |
| `GET /api/expedientes/exportar`, `GET /api/prazos.ics` | CSV e iCal (sigilosos mascarados) |
| `GET /api/expedientes/{id}`, `GET /api/expedientes/{id}/historico.csv` | Detalhe e histórico (RF13) |
| `GET /api/fila` | Fila do GSI2 (`gerenciador`, `meus`) |
| `POST /api/lotes/previa`, `POST /api/lotes`, `GET /api/lotes`, `POST /api/lotes/{id}/desfazer` | Lotes |
| `GET /api/designacao/sugestao` | Cargas e distribuição sugerida |
| `GET/POST /api/filtros`, `PUT/DELETE /api/filtros/{id}` | Filtros salvos (só o autor altera) |
| `GET/PUT /api/preferencias/{contexto}` | `PAINEL_UNIFICADO`, `INICIO` |
| `GET /api/notificacoes`, `POST /api/notificacoes/lidas` | Alertas |
| `GET /api/indicadores`, `GET /api/catalogos`, `GET /api/usuarios`, `GET /api/marcadores` | Apoio |
| `POST /api/ia/busca` | Corpo `{texto}` (1–300 caracteres) → `{criterios, interpretacao, descartados, origem}`; `criterios` aceito por `GET /api/expedientes?criterios=` |
| `POST /api/ia/resumo-dia` | Corpo vazio → `{texto, geradoEm, origem, itensConsiderados, sigilososSemConteudo, doCache}` |

Erros: `{erro, mensagem}` com 400 (zod), 401, 403, 404, 405, 409, 422 (`RESPOSTA_IA_INVALIDA`) e 503
(`IA_INDISPONIVEL`). Corpo até 100 KB; lote até 200 itens.

## IA generativa (Bedrock)

Dois recursos, ambos sob demanda e no escopo do setor do usuário: busca em linguagem natural convertida em filtros
(no painel) e resumo do dia em texto (widget `resumoIa` da tela inicial).

- **Camadas:** `dominio/ia.ts` (puro, sem rede) monta os prompts, minimiza os itens e interpreta as respostas;
  `servicos/ia.ts` tem a interface `ModeloLinguagem` com `ModeloBedrock` (Converse) e `ModeloDemonstracao`
  (determinístico, sem rede), `criarIa(env)`, `CacheCurto` e a orquestração (`buscarComIa`, `resumoDoDiaComIa`);
  `api/handlers/ia.ts` é o handler fino. O roteador recebe `ia` por injeção (padrão: demonstração), então testes e
  servidor local rodam sem credenciais.
- **Minimização:** na busca vão só o texto do usuário (num campo JSON `pedido`), as listas de domínio do catálogo, as
  datas de referência pré-calculadas (hoje, amanhã, fim da semana, fim do mês, +7 e +30 dias) e os responsáveis do
  próprio setor (id e nome). No resumo vão contadores por gerenciador, alertas não lidos e até 8 itens da fila
  montados campo a campo (`etiqueta`, `gerenciador`, `statusPrazo`, `diasRestantes`, `prioridade`, `acaoPendente`,
  `motivos`). Item restrito (`conteudoRestrito === true` ou `nivelSigilo > 0`, também para MEMBRO e CHEFE) vai só com
  `etiqueta`, `statusPrazo`, `prioridade` e `sigiloso: true`. Nunca vão assunto, resumo, tema, número de referência,
  órgão de origem, `motivoUrgencia` cru, nomes, e-mails ou ids; do usuário, só o perfil.
- **Saída não confiável:** a busca aceita só JSON com chaves de `CAMPOS_BUSCA_IA` (sem `siglaSetor`, ids ou chaves da
  tabela), valores conferidos contra os domínios e depois `validarCriterios`; o que sobra vai para `descartados`.
  Nada aproveitável → 422. O resumo é texto puro, sem markdown, até 1.500 caracteres, exibido só por interpolação.
- **Prompt injection:** o system prompt manda tratar `pedido` como dado. O pior efeito é um filtro dentro do próprio
  setor, porque os ativos já vêm escopados e mascarados antes de filtrar.
- **Modelo e IAM:** padrão `us.amazon.nova-lite-v1:0` (inference profile geográfico, processamento em us-east-1,
  us-east-2 e us-west-2). `infra/lib/permissoes-ia.ts` dá à role da Api só `bedrock:InvokeModel` em
  `arn:aws:bedrock:us-east-1:<conta>:inference-profile/us.amazon.nova-lite-v1:0` e em
  `arn:aws:bedrock:{us-east-1,us-east-2,us-west-2}::foundation-model/amazon.nova-lite-v1:0`, este com a condição
  `bedrock:InferenceProfileArn`. Modelo sem prefixo geográfico recebe só o foundation model da região. Configurável por
  `-c modeloIa` e `-c regioesModeloIa`; nenhum `*`.
- **Limites:** busca com `maxTokens` 400 e `temperature` 0; resumo com `maxTokens` 500, `temperature` 0.2 e `topP`
  0.9. `IA_TIMEOUT_MS` (padrão 10000) por `AbortSignal.timeout`, 2 tentativas; a Lambda Api tem 15 s.
- **Falhas e logs:** erros do SDK viram `IA_INDISPONIVEL` (503) com mensagem pt-BR (modelo não habilitado, excesso de
  chamadas ou indisponível); o log registra só o nome do erro, nunca prompt, resposta ou mensagem do SDK.
- **Cache:** o resumo fica em cache na instância por 5 min (chave `idUsuario` + SHA-256 da entrada, até 500 entradas);
  a busca não tem cache.
- **Modo demonstração:** sem `BEDROCK_MODEL_ID` ou com `IA_MODO=fake`, `ModeloDemonstracao` responde localmente e a
  tela informa "Modo demonstração: gerado localmente, sem IA".
- **Frontend:** `app-busca-ia` no painel (botão "Buscar com IA") mostra os critérios como chips removíveis e, ao
  aplicar, preenche o formulário de filtros avançados existente (gerenciador único vira a aba de gerenciador e caixa
  única vira a aba de caixa, com aviso em `aria-live`; várias caixas deixam a aba em "Todas as caixas" e aparecem
  como chips removíveis "Filtro de caixa", nunca escondidas); o widget "Resumo do dia (IA)" gera o texto ao clicar,
  com o selo "Gerado por IA, confira antes de agir". Avisos de privacidade visíveis, `aria-live`, `role="alert"` e
  foco no resultado.

## Segurança e privacidade

- Cognito com cadastro só pelo administrador; `custom:idUsuario` e `custom:siglaSetor` imutáveis e não graváveis pelo
  cliente; perfil no grupo (`cognito:groups`). A Lambda lê as claims e confere com o cadastro: divergência → 403.
- Toda consulta usa `SETOR#<sigla>` do usuário; detalhe de outro setor → 403.
- RN6 aplicado antes de filtrar (o filtro por assunto não revela o sigiloso). CSV, ICS e e-mail sempre mascarados.
- CSV protegido contra injeção de fórmula. Logs estruturados sem corpo de requisição nem conteúdo de expediente; log de
  acesso do API Gateway sem query string.
- Uma role por Lambda, só com as ações usadas (`grantReadWriteData`, `grantWriteData`, `grantReadData`,
  `events:PutEvents` no barramento, `ses:SendEmail` nas identidades, `bedrock:InvokeModel` só na Api e só no modelo
  configurado). Teste da pilha garante ausência de `*`.
- DynamoDB com KMS (chave gerenciada) e PITR; S3 privado com OAC, SSE e só HTTPS; CloudFront com CSP, HSTS,
  `X-Frame-Options: DENY`. Throttling no estágio da API.
- Modo local: token HMAC com segredo aleatório por execução; o login local não existe na AWS.

## Frontend

| Rota | Tela |
| --- | --- |
| `/entrar` | Cognito (e-mail e senha) ou seletor de usuário fictício no modo local |
| `/inicio` | Widgets configuráveis: contadores por gerenciador (atalhos para o painel), resumo do dia (IA), próximo processo, próximos prazos, alertas, informes, filtros salvos |
| `/painel` | Abas por gerenciador, caixas com contador, busca, busca com IA, filtros avançados, filtros salvos, colunas, densidade, ordenação, paginação, seleção e lote, CSV, ICS |
| `/expedientes/:id` | Prazo e prioridade com composição, risco, dados, prazos, designações, histórico filtrável e exportável, anotações, ações |
| `/foco` | Um por vez na ordem da fila, atalhos N, P, A, X |
| `/alertas` | Central com filtros e marcação de lido; prévia do resumo diário |
| `/indicadores` | KPIs, gráficos em barras com tabela alternativa, produtividade (membro e chefe) |
| `/lotes` | Trilha própria (com desfazer) e do setor |

Acessibilidade: link "pular para o conteúdo", foco visível, foco movido ao conteúdo a cada navegação, `<dialog>`
nativo, `aria-live` e `role="alert"`, tabelas com `caption`/`th id`/`td headers`, `aria-sort`, selos com texto e
símbolo e contraste calculado pela cor do catálogo, áreas de rolagem focáveis. Verificado com axe (WCAG 2.1 AA) em
todas as telas, em desktop e em 390 px.

## Testes

- `backend/test/regras.test.ts`, `lote.test.ts`: RN1–RN5, risco, filtros, sigilo, designação, eventos, resumo.
- `backend/test/api.test.ts`: base completa em memória; 401, 403 (outro setor, claims divergentes), sigilo em lista,
  detalhe, CSV, histórico e ICS, painel sem BAIXADO, contadores = `contadores.csv`, lote ponta a ponta com desfazer.
- `backend/test/ia.test.ts`: domínio da IA (validação do pedido, datas, item minimizado, prompts, interpretação e
  422), adaptadores (Converse com limites e timeout, erros → 503 sem prompt no log, `criarIa`, modo demonstração,
  cache) e API sobre a base completa (401, 400, 422/503, critérios aceitos pelo painel, widget `resumoIa`). Os testes
  de sigilo capturam o texto exato enviado ao modelo e provam, para MEMBRO e SERVIDOR, que não há conteúdo de
  sigiloso nem dados de outro setor.
- `infra/test/stack.test.ts`: nenhum método anônimo, IAM sem `*`, KMS/PITR, bucket privado, HTTPS, eventos e agenda;
  variáveis da IA na Api, `bedrock:InvokeModel` só na role da Api, nos ARNs do profile e dos foundation models, com
  condição, e `permissoesModeloIa` recusando curinga.
- `frontend`: selos (texto e contraste), filtros ↔ critérios (inclusive `separarCriteriosIa`), mensagens e rótulos
  da IA, ações por perfil, interceptor (`ng test`).

## Decisões e limites

- O painel lê o GSI1 do setor (até ~2.700 ativos) e filtra na Lambda: simples e rápido para o volume. Para setores
  maiores: projeção reduzida no índice, cache dos ativos por setor ou OpenSearch.
- O desfazer confere `versao` na Lambda, sem `ConditionExpression`; corrida simultânea no mesmo item é aceita no MVP.
- SES em sandbox na conta do evento: `destinatarioDemo` redireciona os resumos a um e-mail verificado.
- Verified Permissions ficou fora do MVP (ver README).
