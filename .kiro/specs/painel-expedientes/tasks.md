# Tarefas: painel de expedientes do gabinete

- [x] 1. Regras de domínio no backend (`backend/src/dominio`)
  - [x] 1.1 `regras.ts`: situação do prazo, pontuação com composição, prioridade, risco, recálculo pela data de
    referência, ordem da fila e chaves GSI
    - _Requisitos: 4.1–4.4, 4.6, 4.8_
  - [x] 1.2 `criterios.ts`: filtros por critérios JSON (listas, `Min`, `Max`, `$USUARIO`) validados com zod, busca e
    ordenação
    - _Requisitos: 3.1–3.3, 4.7_
  - [x] 1.3 `acesso.ts`: setor, sigilo e máscara para tela e exportação
    - _Requisitos: 1.4–1.6_
  - [x] 1.4 `lote.ts` e `designacao.ts`: esquema zod, validação por item, efeitos e distribuição balanceada
    - _Requisitos: 7.1–7.7, 8.1–8.2_
  - [x] 1.5 Testes unitários (Vitest) das regras, do lote, da designação, dos eventos e do resumo

- [x] 2. Acesso a dados (`backend/src/dados`)
  - [x] 2.1 Interface de tabela, implementação em memória com GSI1/GSI2 e carga do `itens.json`
  - [x] 2.2 Implementação DynamoDB (Query parametrizada, `TransactWriteItems` por expediente, sem Scan)
  - [x] 2.3 `repositorio.ts` com os padrões de acesso e regravação das chaves GSI

- [x] 3. API (`backend/src/api`, `backend/src/lambdas`)
  - [x] 3.1 Roteador, erros, validação de entrada e logs sem dados sensíveis
  - [x] 3.2 Autenticação: claims do Cognito (id, setor, grupo) conferidas com o cadastro; token local assinado
    - _Requisitos: 1.1–1.3_
  - [x] 3.3 Handlers: me, início, expedientes (lista, detalhe, CSV, histórico CSV), fila, ICS
    - _Requisitos: 2, 3, 4, 5, 6, 10, 12.1_
  - [x] 3.4 Handlers: lotes (prévia, execução, desfazer, trilha) e sugestão de designação
    - _Requisitos: 7, 8_
  - [x] 3.5 Handlers: filtros salvos, preferências, notificações, indicadores, catálogos, usuários, marcadores, resumo
    - _Requisitos: 9, 11, 12.3_
  - [x] 3.6 Eventos de domínio (EventBridge), notificador idempotente e Lambda do resumo diário (SES)
    - _Requisitos: 12.2, 12.3_
  - [x] 3.7 Adaptador Lambda (REST proxy) e servidor local
  - [x] 3.8 Testes de API (401, 403 de outro setor e de claims divergentes, sigilo, painel, lote ponta a ponta, filtros,
    CSV, ICS)

- [x] 4. Infraestrutura (`infra/`, CDK v2)
  - [x] 4.1 Pilha `LexGabinete`: DynamoDB, Cognito com grupos, API REST com authorizer, três Lambdas, EventBridge + DLQ,
    Scheduler, S3 + CloudFront (OAC, CSP), publicação do frontend
  - [x] 4.2 Testes da pilha (nenhum método anônimo, IAM sem `*`, criptografia, HTTPS, eventos)
  - [x] 4.3 Script de cadastro dos usuários fictícios no Cognito
  - [ ] 4.4 Deploy na conta do evento (`npm run deploy` em `infra/`, perfil `hackathon`) e carga do seed

- [x] 5. Frontend Angular (`frontend/`)
  - [x] 5.1 Projeto, Bootstrap com a paleta do Único, configuração, autenticação (guard, interceptor), layout acessível
  - [x] 5.2 Selos de prazo, prioridade e gerenciador (texto + símbolo + contraste) e serviço de avisos
  - [x] 5.3 Tela inicial com widgets configuráveis
    - _Requisitos: 5_
  - [x] 5.4 Painel: abas, caixas, busca, filtros, filtros salvos, colunas, paginação, seleção, CSV, ICS
    - _Requisitos: 2, 3, 4, 9, 12.1_
  - [x] 5.5 Diálogo de lote com prévia, sugestão por carga, distribuição e desfazer; tela de lotes
    - _Requisitos: 7, 8_
  - [x] 5.6 Detalhe do expediente com composição da prioridade, risco e histórico filtrável e exportável
    - _Requisitos: 6_
  - [x] 5.7 Modo foco, alertas (com prévia do resumo) e indicadores com tabela alternativa
    - _Requisitos: 10, 11, 12.3_
  - [x] 5.8 Testes (`ng test`): selos, contraste, filtros, ações por perfil, interceptor

- [x] 6. Verificação
  - [x] 6.1 Testes de backend, infra e frontend; build de produção; `cdk synth`
  - [x] 6.2 Roteiro da demo em navegador real com axe (WCAG 2.1 AA) em desktop e 390 px
  - [x] 6.3 README com arquitetura, execução local, deploy, custo, LGPD e próximos passos
  - [x] 6.4 Hooks do Kiro: testes do backend ao salvar e revisão de sigilo/acesso
