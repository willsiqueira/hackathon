# Hackathon AWS: painel de expedientes do Único

**Data do evento:** 07/10/2026


## Entregas

- Módulo implementado (MVP funcional)
- Modelo de dados
- Testes
- Acessibilidade
- Responsividade
- Privacidade de dados
- Segurança
- Specs do Kiro (requisitos, design e tarefas) e demonstração final

## Painel unificado de expedientes e nova tela inicial

Hoje o Único tem três gerenciadores de expedientes separados: **Judicial**, **Documento** e **Extrajudicial**. Cada um
tem tela, caixas e contadores próprios. Para acompanhar prazos e pendências, quem trabalha no gabinete precisa abrir os
três e montar a visão do dia por conta própria.

A proposta é construir um MVP de um painel que reúna os expedientes dos três gerenciadores, com foco nos **processos
judiciais dos gabinetes**. O painel pode ser visto de forma unificada ou separada por gerenciador. Junto vem uma
**nova tela inicial** com o resumo do dia: contadores, próximos prazos, alertas e informes.

É um MVP sobre um problema real da área de negócio, sem compromisso de implantação posterior.

**Público:** membros, chefes de gabinete e servidores.

## Dados

A base é **100% sintética**. Etiquetas, números, pessoas, datas e textos são fictícios. Só os volumes por caixa foram
calibrados com contagens agregadas de homologação, de dois setores:

| Setor | Tipo | Gerenciadores | A receber | No setor | Vencidos | Vencem hoje |
| --- | --- | --- | --- | --- | --- | --- |
| GABSUB3-DVT | Gabinete | Judicial, Documento, Extrajudicial | 20 | 389 | 50 | 24 |
| CIVINT/STIC | Coordenadoria | Documento, Extrajudicial | 669 | 1.408 | 230 | 90 |

A data de referência é **07/10/2026, 17h**. Os campos `diasRestantes` e `statusPrazo` já vêm calculados para esse dia.

### Arquivos

São 19 CSVs, que abrem em planilha, e um `dynamodb/itens.json` com 49.108 itens em DynamoDB JSON.

| Arquivo | Linhas | Conteúdo |
| --- | --- | --- |
| `expedientes.csv` | 4.109 | Expedientes dos três gerenciadores, num esquema único |
| `movimentacoes.csv` | 23.502 | Histórico: cadastro, envio, recebimento, designação, assinatura, arquivamento etc. |
| `prazos.csv` | 4.296 | Prazos abertos, prorrogados e cumpridos (no prazo ou com atraso) |
| `designacoes.csv` | 1.974 | Designações com prazo de devolução e situação |
| `anotacoes.csv` | 3.912 | Anotações dos usuários |
| `marcadores.csv` / `marcadores_expedientes.csv` | 22 / 1.229 | Marcadores por setor e gerenciador, e onde foram aplicados |
| `favoritos.csv` | 30 | Expedientes favoritados |
| `notificacoes.csv` | 7.907 | Alertas por usuário, com severidade e situação de leitura |
| `acoes_lote.csv` | 52 | Trilha de ações em lote (quem, quando, parâmetros, resultado) |
| `preferencias_usuario.csv` | 48 | Colunas, ordenação, agrupamento, densidade, tema e alertas |
| `filtros_salvos.csv` | 33 | Filtros pessoais e compartilhados (critérios em JSON) |
| `contadores.csv` | 7 | Contadores prontos por setor e gerenciador, incluindo `TODOS` |
| `estoque_diario.csv` | 450 | Série de 90 dias: entradas, recebimentos, saídas e estoque |
| `produtividade_diaria.csv` | 1.391 | Ações por pessoa e por dia |
| `usuarios.csv` / `setores.csv` | 14 / 2 | Pessoas fictícias (MEMBRO, CHEFE, SERVIDOR) e setores |
| `noticias.csv` | 4 | Informes da tela inicial |
| `catalogos.csv` | 126 | Rótulos e cores de todos os domínios |

### Principais campos de `expedientes.csv`

- **Identificação:** `gerenciador`, `etiqueta`, `numeroReferencia`, `classe` (RESP, AREsp, HC, RHC, AgInt, Ofício,
  Notícia de Fato etc.), `assunto`, `tema` e `orgaoOrigem`.
- **Situação:** `caixa` (A_RECEBER, NO_SETOR, ENVIADO_NAO_RECEBIDO, BAIXADO), `situacao`, `acaoPendente` e
  `requerAcao`.
- **Datas:** `dataAutuacao`, `dataChegada`, `dataRecebimento`, `dataUltimaMovimentacao`, `diasNoSetor` e
  `tempoParadoDias`.
- **Prazo:** `tipoPrazo`, `dataPrazo`, `diasRestantes` e `statusPrazo` (VENCIDO, VENCE_HOJE, CRITICO, ATENCAO,
  NO_PRAZO).
- **Prioridade:** `pontuacaoPrioridade`, `prioridade` (CRITICA, ALTA, MEDIA, BAIXA), `urgente`, `motivoUrgencia`,
  `reuPreso`, `idoso` e `novaIntimacao`.
- **Responsável:** `nomeResponsavel`, `tipoResponsabilidade` (TITULAR ou DESIGNADO) e `oficioResponsavel`.
- **Outros:** `marcadores` (separados por `;`), `nivelSigilo`, `favorito`, `qtdAnotacoes` e `qtdMinutasPendentes`.

### Regras para usar os dados

- A caixa `BAIXADO` é histórico e serve aos dashboards. No painel, filtre `caixa != BAIXADO`.
- A pontuação de prioridade soma pontos de prazo (vencido 50, vence hoje 45, crítico 35, atenção 20, no prazo 5),
  urgente (+30), nova intimação (+10), parado há mais de 30 dias (+10) e aguardando assinatura (+5). Itens enviados e
  ainda não recebidos contam metade. As faixas são: crítica ≥ 60, alta ≥ 35, média ≥ 20.
- As cores de prazo, prioridade e gerenciador estão em `catalogos.csv`.
- Para um MVP só com processos judiciais, filtre `gerenciador = JUDICIAL`. O gerador permite aumentar o volume e
  ajustar colunas.

### Gerar e carregar

```bash
cd hackathon-expedientes/seed
python3 gerar_seed.py                          # gera os CSVs e o itens.json (Python 3, sem dependências)
python3 gerar_seed.py --data-referencia agora  # usa a data e a hora atuais

# carga no DynamoDB da conta do evento (precisa de credenciais AWS configuradas)
uv run --no-project --with boto3 python gerar_seed.py --carregar --criar-tabela --tabela Expedientes --regiao us-east-1
```

### Modelo DynamoDB

É uma tabela única (`PK`/`SK`) com dois índices:

| Acesso | Chave |
| --- | --- |
| Expediente e seu histórico | `PK = EXP#<id>`; `SK = META`, `MOV#…`, `PRZ#…`, `DES#…`, `ANO#…` |
| Painel por setor e caixa (GSI1) | `GSI1PK = SETOR#<sigla>`; `GSI1SK = ATIVO#<ger>#<caixa>#<dataChegada>#<id>` |
| Fila por prazo e prioridade (GSI2) | `GSI2PK = SETOR#<sigla>`; `GSI2SK = PRAZO#<dataPrazo>#<100 - pontuação>#<id>` |
| Tela inicial | `PK = SETOR#<sigla>`; `SK = CONT#<gerenciador>` (inclui `CONT#TODOS`) |
| Alertas, preferências e filtros do usuário | `PK = USR#<id>`; `SK = NOT#…`, `PREF#…`, `FILTRO#…` |

## Arquitetura sugerida

- **Frontend:** SPA (Angular, como no Único, ou outra) hospedada em S3 + CloudFront.
- **API:** API Gateway + Lambda, com autorização pelo **Cognito User Pool Authorizer**.
- **Dados:** DynamoDB no modelo acima.
- **Alertas:** EventBridge Scheduler + Lambda + Amazon SES para o resumo diário.

## Requisitos funcionais

### 1. Painel unificado

- **RF01 - Visão unificada ou separada:** o sistema deve listar numa só tela os expedientes ativos dos três
  gerenciadores e permitir alternar para a visão de um único gerenciador.
- **RF02 - Caixas:** o sistema deve separar os expedientes nas caixas A receber, No setor, Enviados não recebidos e
  Baixados, cada uma com seu contador.
- **RF03 - Pesquisa e filtros avançados:** o sistema deve permitir pesquisar por texto livre e filtrar por gerenciador,
  situação, situação do prazo, prioridade, responsável, assunto, classe, tema, marcador, período de chegada e de prazo,
  tempo parado e sinalizações (urgente, réu preso, idoso, nova intimação, sigiloso, favorito).
- **RF04 - Filtros salvos:** o sistema deve permitir salvar combinações de filtros com nome, marcar uma como padrão e
  compartilhá-la com o setor.
- **RF05 - Personalização:** o sistema deve permitir escolher e reordenar colunas, definir ordenação, agrupamento,
  densidade e itens por página, e guardar essas preferências por usuário.

### 2. Priorização e prazos

- **RF06 - Priorização:** o sistema deve destacar os expedientes urgentes, os próximos do vencimento e os que demandam
  ação, e mostrar por que cada item recebeu sua prioridade.
- **RF07 - Indicadores visuais de prazo:** o sistema deve exibir a situação do prazo com cor e texto (vencido, vence
  hoje, até 3 dias, até 7 dias, no prazo), sem depender só da cor.
- **RF08 - Risco de vencimento:** o sistema deve calcular um índice de risco que combine tempo parado e dias restantes
  e permitir ordenar e filtrar por ele.
- **RF09 - Próximo expediente (modo foco):** o sistema deve apresentar um item por vez, na ordem de prazo e
  prioridade (GSI2), com a ação pendente e o atalho para executá-la.
- **RF10 - Calendário de prazos:** o sistema deve exibir os prazos num calendário mensal e exportá-los em iCal
  (`.ics`), com lembrete configurável.

### 3. Ações em lote e rastreabilidade

- **RF11 - Ações em lote:** o sistema deve permitir receber, designar, incluir marcador, dar ciência, assinar,
  movimentar e arquivar vários expedientes de uma vez.
- **RF12 - Pré-visualizar e desfazer:** antes de executar um lote, o sistema deve mostrar o que será alterado e o que
  será ignorado, e por quê. Depois, deve permitir desfazer, registrando a trilha em `acoes_lote`.
- **RF13 - Histórico:** o sistema deve exibir as movimentações de cada expediente (quem, quando, de onde e para onde),
  com filtro por tipo e exportação.
- **RF14 - Designação balanceada:** o sistema deve sugerir o servidor com menor carga, considerando designações
  ativas, devoluções atrasadas e produtividade recente, e distribuir vários itens de forma equilibrada.

### 4. Alertas e notificações

- **RF15 - Central de alertas:** o sistema deve notificar novos expedientes, novas intimações, prazos vencidos ou
  próximos, designações, devoluções vencidas e alterações, com marcação de lido e não lido.
- **RF16 - Resumo diário por e-mail:** o sistema deve enviar, a quem optar, um resumo com vencidos, vencem hoje,
  novos e devoluções vencidas.

### 5. Indicadores

- **RF17 - Dashboards:** o sistema deve apresentar volume, estoque, pendências, cumprimento de prazos e produtividade
  por pessoa, com filtro por período e gerenciador. Cada gráfico deve ter uma tabela alternativa.

### 6. Nova tela inicial

- **RF18 - Widgets:** a tela inicial deve mostrar os contadores de todos os gerenciadores, os próximos prazos, os
  alertas não lidos, o próximo expediente e os informes.
- **RF19 - Configuração da tela inicial:** o usuário deve poder escolher quais widgets aparecem e em que ordem.

## Requisitos não funcionais

- **Acessibilidade:** navegação completa por teclado; `label` em todo campo; tabelas com `caption`, `th id` e
  `td headers`; `aria-live` para avisos e `role="alert"` para erros; contraste adequado; nenhuma informação só por cor.
  Seguir as regras de acessibilidade do Único (eMAG/WCAG).
- **Responsividade:** uso em desktop e em telas menores, sem perda de função.
- **Segurança:** autenticação pelo Cognito. A autorização por setor e por nível de sigilo fica **no backend**, nunca
  só na tela. Endpoints sem acesso anônimo.
- **Privacidade:** somente dados sintéticos. O conteúdo de expedientes sigilosos não deve vazar em exportações, e-mails
  ou arquivos `.ics`.
- **Testes:** unitários nas regras (prioridade, risco, validação de lote) e testes de API nos principais acessos.

## Escopo sugerido para o dia

| Prioridade | Requisitos |
| --- | --- |
| Essencial | RF01, RF02, RF03, RF06, RF07 e RF18 |
| Desejável | RF04, RF05, RF09, RF11, RF12, RF13 e RF15 |
| Se sobrar tempo | RF08, RF10, RF14, RF16, RF17 e RF19 |

## Regras

- Usar só a base sintética. **Não levar dados reais** de homologação ou de produção, nem credenciais do MPF, para a
  conta AWS do evento.
- Não versionar credenciais da conta do evento.
- Começar pelo spec no Kiro (requisitos, design e tarefas) antes de implementar.
