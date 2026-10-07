# Caso de uso: painel de expedientes judiciais do gabinete

Hackathon MPF & AWS 2026 · 07/10/2026

## 1. Identificação

| Campo | Preenchimento |
| --- | --- |
| Nome do caso | Painel de expedientes judiciais do gabinete e nova tela inicial |
| Área / subsecretaria | SUBGTU |
| Sistema ou processo de origem | Único: gerenciadores de expedientes Judicial, Documento e Extrajudicial |
| Ponto focal no dia do hackathon | Laercio e Pedro |

## 2. Problema

No Único, os expedientes de um gabinete ficam em três gerenciadores separados: Judicial, Documento e Extrajudicial.
Cada um tem caixas, contadores e filtros próprios. Para saber o que vence hoje, o que é urgente (réu preso, idoso,
nova intimação) e o que está parado, membros, chefes de gabinete e servidores abrem cada gerenciador e montam a
prioridade de cabeça. Prazos passam despercebidos, a distribuição de trabalho fica desigual e a tela inicial não mostra
o resumo do dia.

## 3. Objetivo da solução

Permitir que o gabinete veja, numa só tela, os processos judiciais (e, se quiser, os demais expedientes) ordenados por
prazo e prioridade, aja sobre eles e comece o dia por uma tela inicial com os números e alertas que importam.

**Resultado esperado na demonstração:** login de um usuário fictício; tela inicial com os contadores do setor e os
próximos prazos; painel com filtros por prazo, prioridade, responsável e assunto; selos visuais de prazo; abrir um
processo e ver seu histórico; receber ou designar processos em lote.

**Fora do escopo:** integrar com o Único ou com bancos internos; assinar, protocolar ou movimentar de verdade; emitir
documento oficial; usar dados reais.

## 4. Usuários

| Perfil | O que faz na solução |
| --- | --- |
| Membro (titular do ofício) | Acompanha prazos e prioridades dos processos do gabinete |
| Chefe de gabinete | Distribui (designa) processos, acompanha a carga da equipe e os indicadores |
| Servidor (assessor) | Trabalha a própria fila de processos designados, por prazo e prioridade |

## 5. Funcionalidades principais

| # | Funcionalidade | Prioridade |
| --- | --- | --- |
| F1 | Como servidor, quero ver os processos do gabinete numa lista única, com filtro por caixa, gerenciador e responsável, para não precisar abrir três telas | Essencial |
| F2 | Como servidor, quero filtrar por situação do prazo, prioridade, assunto, classe, data e urgência, para achar o que precisa de ação | Essencial |
| F3 | Como membro, quero ver a lista ordenada por prazo e prioridade, com selo visual de prazo, para saber o que fazer primeiro | Essencial |
| F4 | Como usuário, quero uma tela inicial com os contadores de todos os gerenciadores, os próximos prazos e os alertas não lidos, para começar o dia | Essencial |
| F5 | Como servidor, quero abrir um processo e ver o histórico de movimentações, prazos e designações, para entender o andamento | Essencial |
| F6 | Como chefe, quero receber e designar vários processos de uma vez, com pré-visualização e opção de desfazer | Desejável |
| F7 | Como chefe, quero que o sistema sugira a quem designar, pela carga atual de cada pessoa | Desejável |
| F8 | Como servidor, quero salvar filtros e escolher colunas e ordenação, para reaproveitar minha visão | Desejável |
| F9 | Como servidor, quero um modo "próximo processo", que mostre um item por vez na ordem da fila | Desejável |
| F10 | Como membro, quero um painel de indicadores (estoque, vencidos, cumprimento de prazos, produtividade) | Desejável |

## 6. Regras de negócio

| # | Regra | Exemplo | Fonte |
| --- | --- | --- | --- |
| RN1 | A situação do prazo vem dos dias restantes: < 0 vencido; 0 vence hoje; 1 a 3 crítico; 4 a 7 atenção; > 7 no prazo | Prazo em 09/10/2026, consultado em 07/10 → 2 dias → crítico | Definida para o hackathon |
| RN2 | A prioridade soma pontos de prazo (vencido 50, hoje 45, crítico 35, atenção 20, no prazo 5), urgente +30, nova intimação +10, parado há mais de 30 dias +10, aguardando assinatura +5. Crítica ≥ 60, alta ≥ 35, média ≥ 20, senão baixa | Vencido e com réu preso → 50 + 30 = 80 → crítica | Definida para o hackathon |
| RN3 | A fila ordena por data do prazo crescente; no empate, pela pontuação decrescente | Dois processos com prazo em 08/10: o de 80 pontos vem antes do de 45 | Definida para o hackathon |
| RN4 | Só se recebe processo da caixa "A receber"; só se designa, movimenta ou arquiva da caixa "No setor" | Tentar receber um processo "No setor" → ignorado na prévia, com o motivo | Comportamento atual do Único |
| RN5 | Não se arquiva processo com minuta pendente | Processo com 1 minuta pendente no lote de arquivamento → ignorado | Comportamento atual do Único |
| RN6 | O usuário só vê processos do próprio setor. Em processo sigiloso, servidor só vê o conteúdo se for o responsável | Servidor do CIVINT/STIC abrindo processo do GABSUB3-DVT → acesso negado | Simplificação definida para o hackathon |
| RN7 | Processos baixados são histórico: entram nos indicadores, não no painel | Caixa BAIXADO não aparece na lista nem nos contadores | Definida para o hackathon |

## 7. Normativos e documentos de referência

| Documento | Arquivo na pasta | Para que serve |
| --- | --- | --- |
| Descrição da base e dos campos | `README.md` | Dicionário de dados, domínios e modelo DynamoDB |
| Instruções e requisitos do caso | `instrucoes-hackathon.pdf` | Requisitos funcionais detalhados e arquitetura sugerida |
| Gerador da base | `seed/gerar_seed.py` | Regerar os dados com outra data ou volume |

## 8. Dados preparados

### 8.1 Visão geral

| Item | Preenchimento |
| --- | --- |
| Origem dos dados | Fictícios, gerados por script. Só os volumes por caixa foram calibrados com contagens agregadas de dois setores de homologação |
| Volume aproximado | 19 arquivos, cerca de 49.000 linhas no total (4.109 expedientes) |
| Período coberto | Chegadas de out/2025 a 07/10/2026; séries diárias de 10/07 a 07/10/2026. Data de referência: 07/10/2026, 17h |
| Limitações conhecidas | Poucos processos judiciais (76, dos quais 56 ativos), porque o perfil do gabinete é majoritariamente Documento; o gerador pode aumentar esse volume. `dataRecebimento` vazia na caixa "A receber"; `marcadores` vazio quando não há marcador. Dias restantes já calculados para 07/10/2026 |

### 8.2 Arquivos

Todos em CSV com separador `,`, UTF-8 e cabeçalho. Datas em ISO 8601 com fuso −03:00. Há também
`dynamodb/itens.json` (DynamoDB JSON, 49.108 itens).

| Arquivo | Formato | Conteúdo (cada linha é…) | Linhas |
| --- | --- | --- | --- |
| `expedientes.csv` | CSV, separador `,` | Um expediente (processo judicial, documento ou procedimento) | 4.109 |
| `movimentacoes.csv` | CSV, separador `,` | Uma movimentação no histórico de um expediente | 23.502 |
| `prazos.csv` | CSV, separador `,` | Um prazo de um expediente | 4.296 |
| `designacoes.csv` | CSV, separador `,` | Uma designação a uma pessoa, com prazo de devolução | 1.974 |
| `notificacoes.csv` | CSV, separador `,` | Um alerta enviado a um usuário | 7.907 |
| Outros 14 arquivos | CSV, separador `,` | Anotações, contadores, estoque e produtividade diários, usuários, setores, marcadores, favoritos, filtros, preferências, lotes, informes e catálogos (ver `README.md`) | 7.320 no total |

### 8.3 Privacidade (LGPD)

- [x] Não há dados pessoais reais. Nomes, e-mails (`@exemplo.org`) e números são fictícios.
- [x] Não há informação sigilosa real nem de processo sob segredo. O campo `nivelSigilo` só simula a regra.
- [x] A área autoriza o uso destes dados no ambiente da AWS durante o evento.

## 9. Restrições técnicas e observações

- Não há integração com o Único: tudo vem dos arquivos da pasta. Ações como receber, designar e arquivar só mudam
  os dados da própria solução.
- Autenticação pelo Cognito, com usuários fictícios de `usuarios.csv` (perfis MEMBRO, CHEFE e SERVIDOR). A
  autorização por setor e sigilo deve ficar no backend.
- Sugestão de arquitetura: frontend em S3 + CloudFront; API Gateway + Lambda; DynamoDB em tabela única (o
  `itens.json` já traz as chaves e os índices GSI1 e GSI2); SES para o resumo diário, se houver tempo.
- O Único usa Angular e Bootstrap; seguir esse padrão visual é bem-vindo, mas não obrigatório.
- Acessibilidade conta na avaliação: navegação por teclado, `label` em todo campo, tabelas com cabeçalhos associados
  e nenhuma informação só por cor.
