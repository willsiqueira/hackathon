---
inclusion: always
---

# Diretrizes de implementação orientadas aos critérios de avaliação

O projeto (painel unificado de expedientes + nova tela inicial do Único) será avaliado pela banca do Hackathon AWS × MPF em 6 critérios, nota 0–10 cada (máx. 60). Toda decisão de implementação deve maximizar esses critérios. Em caso de dúvida entre duas opções, escolha a que gera mais pontos na demonstração.

Documentos de referência (fonte da verdade para requisitos e regras):
- `docs/hackathon-expedientes/caso-de-uso-hackathon.md` — problema, usuários, F1–F10, RN1–RN7
- `docs/hackathon-expedientes/instrucoes-hackathon.md` — RF01–RF19, RNFs, modelo DynamoDB, arquitetura sugerida
- `docs/hackathon-expedientes/README.md` — dicionário de dados
- `docs/hackathon-expedientes/criterios-avaliacao-hackathon.html` — critérios da banca
- `seed/saida/` — dados sintéticos (CSV e `dynamodb/itens.json`)

## 1. Atendimento aos requisitos

- Priorize o fluxo de ponta a ponta da demo antes de qualquer extra: login (usuário fictício de `usuarios.csv`) → tela inicial com contadores e próximos prazos → painel com filtros → selo de prazo → abrir processo e ver histórico → receber/designar em lote.
- Ordem de entrega: Essencial (RF01, RF02, RF03, RF06, RF07, RF18) → Desejável (RF04, RF05, RF09, RF11, RF12, RF13, RF15) → Se sobrar tempo (RF08, RF10, RF14, RF16, RF17, RF19).
- Implemente as regras de negócio exatamente como especificado e cubra com testes unitários:
  - RN1 situação do prazo: `< 0` VENCIDO; `0` VENCE_HOJE; `1–3` CRITICO; `4–7` ATENCAO; `> 7` NO_PRAZO.
  - RN2 pontuação: vencido 50, hoje 45, crítico 35, atenção 20, no prazo 5; urgente +30; nova intimação +10; parado > 30 dias +10; aguardando assinatura +5; enviados não recebidos contam metade. Faixas: CRITICA ≥ 60, ALTA ≥ 35, MEDIA ≥ 20, senão BAIXA.
  - RN3 ordenação: `dataPrazo` crescente, empate por pontuação decrescente (GSI2).
  - RN4 receber só de A_RECEBER; designar/movimentar/arquivar só de NO_SETOR. Itens inválidos aparecem na prévia como ignorados, com motivo.
  - RN5 não arquivar com `qtdMinutasPendentes > 0`.
  - RN6 usuário só vê o próprio setor; em sigiloso, servidor só vê conteúdo se for o responsável.
  - RN7 BAIXADO fica fora do painel e dos contadores, mas entra nos indicadores.
- Use os dados sintéticos do kit (`seed/saida`) e o modelo de tabela única com GSI1/GSI2 já definido no `itens.json`. Não invente esquema paralelo.
- Ofereça saídas úteis: exportação CSV do histórico, `.ics` de prazos (se RF10), JSON consistente na API.

## 2. Arquitetura AWS

- Serverless e gerenciado: SPA em S3 + CloudFront; API Gateway + Lambda; DynamoDB tabela única; Cognito User Pool Authorizer.
- Orientação a eventos onde fizer sentido: EventBridge Scheduler para resumo diário (SES), eventos de domínio (ação em lote executada, designação criada) publicados em EventBridge/SNS/SQS para gerar notificações de forma desacoplada.
- Toda infraestrutura em código (preferência: AWS CDK ou SAM). Nada criado manualmente no console.
- Separe responsabilidades: handlers Lambda finos; regras de negócio (prioridade, risco, validação de lote, autorização) em módulos puros e testáveis; acesso a dados isolado em uma camada de repositório.
- Use o Amazon Bedrock quando agregar valor real ao usuário (ex.: resumo em linguagem natural do processo ou do dia, explicação da prioridade, busca em linguagem natural convertida em filtros). Nunca envie conteúdo de expediente sigiloso ao modelo sem autorização do usuário.

## 3. Inovação e criatividade

- Diferenciais desejados: modo foco "próximo processo" (RF09), explicação de por que cada item tem sua prioridade (RF06), sugestão de designação por carga (RF14), índice de risco (RF08), recursos com Bedrock.
- UX pensada por perfil: membro (prazos e indicadores), chefe (distribuição e carga da equipe), servidor (própria fila).
- Use os recursos do Kiro como parte da solução e deixe-os versionados: specs (requisitos, design, tarefas) em `.kiro/specs/`, hooks em `.kiro/hooks/` (ex.: rodar testes e lint ao salvar), steering em `.kiro/steering/`.
- Padrão visual próximo ao Único (Angular + Bootstrap) é bem-vindo, não obrigatório. Cores de prazo, prioridade e gerenciador vêm de `catalogos.csv`.

## 4. Segurança

- Nenhum endpoint anônimo. Autenticação via Cognito (perfis MEMBRO, CHEFE, SERVIDOR como grupos/claims).
- Autorização por setor, perfil e sigilo sempre no backend (RN6), nunca só na tela. Considere Amazon Verified Permissions para as políticas.
- IAM com menor privilégio: uma role por função Lambda, permissões restritas à tabela/índices e ações necessárias. Sem `*` em recursos ou ações.
- Valide e sanitize toda entrada (schemas no API Gateway e/ou validação no handler); use expressões parametrizadas do DynamoDB; limite tamanho de lote e de página.
- Não logue nem retorne dados sensíveis: sem conteúdo de sigilosos em logs, exportações, e-mails ou `.ics`. Mascarar campos em logs estruturados.
- HTTPS em tudo (CloudFront + API Gateway); criptografia em repouso (DynamoDB com KMS, S3 SSE, bucket privado com OAC).
- LGPD: somente dados sintéticos; nunca versionar credenciais; documentar minimização de dados e finalidade.

## 5. Apresentação do MVP

- A demo precisa rodar ao vivo em até 5 minutos. Mantenha um roteiro: problema → solução → demo → resultados → próximos passos.
- Garanta dados e usuários de demonstração estáveis (um de cada perfil) e um caminho feliz sem erros.
- Mantenha um diagrama de arquitetura atualizado no README para explicar decisões técnicas rapidamente.
- Prepare respostas curtas para perguntas prováveis: segurança/sigilo, custo, escalabilidade, uso do Kiro.

## 6. Viabilidade e escalabilidade

- Arquitetura que escala sem re-arquitetura: DynamoDB on-demand, Lambda, consultas sempre por chave/GSI (evite `Scan` no caminho da requisição), paginação.
- Documente no README: o que falta para produção (integração com o Único, auditoria, observabilidade), estimativa de custo mensal na AWS e potencial de reuso por outros setores/órgãos.
- Manutenibilidade: código modular, tipado, com testes unitários nas regras (prioridade, risco, validação de lote, autorização) e testes de API nos principais acessos. README com instruções de build, deploy e carga do seed.

## Requisitos não funcionais obrigatórios

- Acessibilidade (eMAG/WCAG): navegação completa por teclado; `label` em todo campo; tabelas com `caption`, `th id` e `td headers`; `aria-live` para avisos e `role="alert"` para erros; contraste adequado; nenhuma informação só por cor (selos de prazo sempre com texto); gráficos com tabela alternativa.
- Responsividade: desktop e telas menores sem perda de função.

## Fora do escopo

Integração com o Único ou bancos internos; assinar, protocolar ou movimentar de verdade; emitir documento oficial; usar dados reais.
