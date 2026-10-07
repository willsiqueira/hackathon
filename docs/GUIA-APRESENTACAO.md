# Guia de apresentação: Painel do gabinete

Hackathon MPF & AWS 2026. Demonstração ao vivo de até 5 minutos, seguida de perguntas da banca.

- **Aplicação:** <https://d3ruzott08qnzm.cloudfront.net>. QR code para o slide final:
  [`docs/qrcode-app.png`](qrcode-app.png) (ou `qrcode-app.svg`, que não perde nitidez ao ampliar)
- **Conta AWS:** 698271685662 (us-east-1), pilha `LexGabinete`
- **Senha dos usuários de demonstração:** combinada com quem fez o cadastro. Passe por canal privado e nunca no
  repositório, no slide ou no chat do evento.

## 1. O que está pronto

### Atendimento aos requisitos

- **Essenciais, todos entregues:** RF01 e RF02 (painel unificado ou por gerenciador), RF03 (busca e filtros), RF06 e
  RF07 (fila por prazo e prioridade, com selos), RF18 (tela inicial).
- **Desejáveis, todos entregues:** RF04 e RF05 (filtros salvos, colunas e ordenação), RF09 (próximo processo),
  RF11 e RF12 (ações em lote com prévia e desfazer), RF13 (histórico com CSV), RF15 (alertas).
- **"Se sobrar tempo", todos entregues:** RF08 (risco de vencimento), RF10 (`.ics`), RF14 (sugestão de designação por
  carga), RF16 (resumo diário), RF17 (indicadores), RF19 (widgets configuráveis).
- **Regras de negócio:** RN1 a RN7 implementadas como funções puras, com 82 testes automatizados passando.

### Arquitetura AWS

Tudo é serverless e está em código (AWS CDK v2, TypeScript), sem nada criado no console.

- **Frontend:** CloudFront com o SPA Angular + Bootstrap em S3 privado (OAC).
- **API:** API Gateway REST com autorizador Cognito → Lambda Node.js 22.
- **Dados:** DynamoDB em tabela única (`Expedientes`, GSI1 e GSI2), sob demanda e com PITR.
- **Eventos:** EventBridge (designar → notificação, com DLQ). EventBridge Scheduler + SES para o resumo diário.
- Diagrama com ícones AWS para o slide: [`docs/arquitetura/arquitetura-aws.png`](arquitetura/arquitetura-aws.png).
  Também aparece no `README.md`.

### Segurança

- Nenhuma rota anônima: sem login, a API responde 401.
- Setor e perfil vêm das claims do Cognito e são conferidos com o cadastro. Acesso a outro setor responde 403.
- Sigilo (RN6) aplicado no backend: o servidor só vê o conteúdo se for o responsável. CSV, `.ics` e e-mail nunca levam
  conteúdo sigiloso.
- Validação com zod, lote de no máximo 200 itens e página de no máximo 100.
- Uma role IAM por Lambda, sem `*`. Criptografia KMS no DynamoDB, CSP e HSTS no CloudFront.

### Inovação

- "Por que esta prioridade": composição da pontuação item a item.
- Modo foco "próximo processo", com atalhos de teclado.
- Distribuição equilibrada da designação pela carga de cada pessoa.
- Lote com prévia (itens ignorados aparecem com o motivo) e opção de desfazer.

### Acessibilidade

- Navegação completa por teclado e foco visível.
- Tabelas com `caption`, `th id` e `td headers`.
- Selos de prazo e prioridade sempre com texto, e gráficos com tabela alternativa.
- Verificado com axe (WCAG 2.1 AA) em desktop e em 390 px.

### Uso do Kiro

- **Spec:** requisitos, design e tarefas em `.kiro/specs/painel-expedientes/`.
- **Steering:** produto, tecnologia e critérios de avaliação.
- **Hooks:** testes ao salvar e revisão de sigilo e acesso.
- **MCP:** documentação AWS, modelagem DynamoDB, CDK e Playwright.

## 2. Usuários de demonstração (setor GABSUB3-DVT)

| Perfil | Nome | Login |
| --- | --- | --- |
| CHEFE | Bruno Teste | `usuario02@exemplo.org` |
| MEMBRO | Ana Exemplo | `usuario01@exemplo.org` |
| SERVIDOR | Carla Modelo | `usuario03@exemplo.org` |

Todos os dados são sintéticos: nomes fictícios e e-mails `@exemplo.org`.

## 3. Checklist antes de subir no palco

1. Abrir a URL e entrar como Bruno. A tela inicial deve carregar com contadores.
2. Deixar duas abas prontas: uma logada como Bruno (CHEFE) e outra anônima para entrar como Carla (SERVIDOR).
3. Zoom do navegador em 125% para a banca enxergar. Fechar notificações e outras abas.
4. Se o roteiro foi ensaiado e alterou dados, recarregar a base (seção 6) para os números voltarem aos do roteiro.
5. Ter o plano B pronto (seção 7) e o `README.md` aberto no diagrama de arquitetura.
6. Definir quem fala e quem opera o computador. Sugestão: uma pessoa narra e outra clica.

## 4. Roteiro de 5 minutos

| Tempo | Bloco | O que mostrar | Fala-chave |
| --- | --- | --- | --- |
| 0:00–0:40 | Problema | Slide ou fala | "O gabinete trabalha em três gerenciadores separados. Para saber o que vence hoje, a equipe abre três telas e monta a prioridade de cabeça." |
| 0:40–1:00 | Solução | Slide com o diagrama | "Um painel único, ordenado por prazo e prioridade, que explica a prioridade, age em lote e roda 100% serverless na AWS." |
| 1:00–4:15 | Demo | Passos abaixo | |
| 4:15–4:45 | Resultados | Slide | Todos os RFs entregues, RN1–RN7 testadas, nenhuma rota anônima, custo estimado de US$ 5 a 15 por mês por gabinete. |
| 4:45–5:00 | Próximos passos | Slide | Integração com o Único, login federado do MPF, auditoria de sigilosos, Bedrock para resumo do dia. |

### Passos da demo

1. **Tela inicial (Bruno, CHEFE), 30 s.** Mostrar os contadores por gerenciador, os próximos prazos e os alertas.
   Clicar em "Vencidos": o painel abre já filtrado.
   > "Em vez de três telas, o dia começa aqui."
2. **Painel, 40 s.** Mostrar os selos com texto e cor, e a ordem por prazo e prioridade. Aplicar um filtro avançado (por
   exemplo, urgentes) e salvá-lo.
   > "A cor nunca é a única informação, e cada filtro pode ser salvo e compartilhado com o setor."
3. **Receber em lote, 30 s.** Caixa "A receber": marcar dois itens → Receber → mostrar a prévia → Confirmar →
   **Desfazer**.
   > "Toda ação em lote tem prévia. O que não pode ser feito aparece com o motivo, e dá para desfazer."
4. **Designar com distribuição equilibrada, 30 s.** Caixa "No setor": marcar três itens → Designar → "Distribuir de forma
   equilibrada" → mostrar a tabela de carga → Confirmar.
   > "A sugestão considera a carga e a produtividade de cada pessoa."
5. **Detalhe do processo, 30 s.** Abrir um processo e mostrar a composição da prioridade ("por que está no topo"), o
   risco, os prazos e o histórico. Filtrar o histórico e exportar o CSV.
6. **Próximo processo, 15 s.** Abrir o modo foco e avançar com a tecla N.
   > "O servidor pode trabalhar um processo por vez, só pelo teclado."
7. **Segurança ao vivo, 20 s.** Na outra aba, entrar como Carla (SERVIDOR) e filtrar "Sigiloso": o conteúdo aparece
   como restrito. Abrir `/expedientes/EXP003000`, que é de outro setor: acesso negado.
   > "A regra está no backend. Mesmo chamando a API direto, o servidor não vê o que não pode."

## 5. Perguntas prováveis da banca

| Pergunta | Resposta curta |
| --- | --- |
| Como garantem o sigilo? | Setor e perfil vêm do token Cognito e são conferidos com o cadastro. A máscara é aplicada no backend antes dos filtros. Exportações e e-mails nunca levam conteúdo sigiloso. Há testes automatizados de 401 e 403 e de mascaramento. |
| Quanto custa? | Para um gabinete, cerca de US$ 5 a 15 por mês sob demanda. O maior custo é a leitura do DynamoDB. Detalhes no README. |
| Escala? | Lambda e DynamoDB sob demanda escalam sozinhos, e as consultas usam chave e índice, sem `Scan`. Para setores muito grandes: projeção reduzida no GSI ou cache por setor. |
| E a integração com o Único? | Fora do escopo do hackathon. O caminho é publicar eventos de entrada e saída de expedientes no lugar da carga do seed. O modelo de dados já segue as consultas reais. |
| Por que não usaram IA? | Priorizamos as regras verificáveis (RN1–RN7). O Bedrock está no plano para o resumo do dia e a busca em linguagem natural, sem enviar conteúdo sigiloso. |
| Como usaram o Kiro? | Spec (requisitos, design e tarefas), steering com as regras de negócio e os critérios, hooks que rodam os testes e revisam o sigilo a cada alteração, e MCPs da AWS para CDK e DynamoDB. |
| Acessibilidade? | Teclado, foco visível, tabelas semânticas, `aria-live` e selos com texto, verificados com axe. A validação completa ainda depende de teste com leitor de tela. |
| LGPD? | Só dados sintéticos, mínimo de dados em eventos e e-mails, sessão em `sessionStorage` e nenhuma credencial no repositório. |

## 6. Recarregar a base depois de ensaiar

As ações da demo (receber, designar) alteram a base. Para voltar ao estado inicial, rode na raiz do repositório:

```powershell
$env:AWS_PROFILE = 'hackathon'
uv run --no-project --with boto3 python docs/hackathon-expedientes/seed/gerar_seed.py --carregar --tabela Expedientes --regiao us-east-1 --saida "$env:TEMP\seed"
```

Isso regrava os expedientes com os valores originais. As movimentações e os lotes criados no ensaio continuam no
histórico; para zerar tudo, use `npm run destroy` e `npm run deploy` em `infra/`, recarregue a base e recadastre os
usuários. Isso leva cerca de 15 minutos.

## 7. Plano B (sem internet ou com a AWS fora do ar)

```powershell
cd backend; npm start      # API e SPA em http://127.0.0.1:3000 (rode antes o build do frontend)
```

No modo local, o login é um seletor de usuário fictício, sem senha. O roteiro é o mesmo; diga à banca que é o mesmo
código rodando localmente.

## 8. Divisão de papéis (preencher)

| Papel | Pessoa |
| --- | --- |
| Narração (problema, solução, resultados) | |
| Operação da demo | |
| Perguntas de arquitetura e segurança | |
| Perguntas de produto e acessibilidade | |
| Cronômetro | |
