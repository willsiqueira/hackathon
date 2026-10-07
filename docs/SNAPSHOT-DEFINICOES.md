# Snapshot of project definitions

Taken on 2026-10-07 at commit `8e3f262` (`main`, same as `origin/main`). Use it to check whether the work in progress follows what is defined here. Mark each line: ✅ agreed, ❌ disagree (write what you are doing instead), ❓ needs discussion.

Sources: `.kiro/steering/product.md`, `.kiro/steering/tech.md`, `.kiro/steering/criterios-avaliacao.md` and `docs/hackathon-expedientes/`.

## Current state of the repo

- Only docs, seed data, the HTML prototype, steering files and MCP config are in the repo. There is no code, Kiro spec (`.kiro/specs/`), CDK app or hook yet.
- If anyone already has code or specs locally, push them to a branch so we can compare.

## 1. Product and scope

| # | Definition | Status |
| --- | --- | --- |
| P1 | UI text, specs and user messages in pt-BR. Code identifiers use the dataset field names (`statusPrazo`, `pontuacaoPrioridade`) | |
| P2 | Profiles: MEMBRO, CHEFE, SERVIDOR. Fictitious users from `usuarios.csv` (one demo user per profile) | |
| P3 | Order of delivery: Essential RF01, RF02, RF03, RF06, RF07, RF18 → Desired RF04, RF05, RF09, RF11, RF12, RF13, RF15 → If time allows RF08, RF10, RF14, RF16, RF17, RF19 | |
| P4 | Demo path: login → tela inicial (contadores + próximos prazos) → painel with filtros and selos de prazo → open processo and see histórico → receber/designar em lote | |
| P5 | Reference date for the data: `2026-10-07T17:00-03:00` | |
| P6 | Out of scope: integration with Único or internal databases, real signing/protocol, official documents, real data | |

## 2. Business rules (pure functions with unit tests)

| # | Rule | Status |
| --- | --- | --- |
| RN1 | `statusPrazo` from `diasRestantes`: `<0` VENCIDO, `0` VENCE_HOJE, `1–3` CRITICO, `4–7` ATENCAO, `>7` NO_PRAZO | |
| RN2 | Pontuação: prazo 50/45/35/20/5, urgente +30, novaIntimacao +10, parado >30 dias +10, aguardando assinatura +5. ENVIADO_NAO_RECEBIDO counts half. Faixas: CRITICA ≥60, ALTA ≥35, MEDIA ≥20, else BAIXA | |
| RN3 | Queue order: `dataPrazo` ascending, ties by pontuação descending (GSI2) | |
| RN4 | Receber only from A_RECEBER. Designar/movimentar/arquivar only from NO_SETOR. Invalid items appear in the preview as ignored, with the reason | |
| RN5 | Never archive with `qtdMinutasPendentes > 0` | |
| RN6 | User sees only their own setor. Sigiloso content is visible to a SERVIDOR only if they are the responsável. Enforced in the backend | |
| RN7 | BAIXADO is history: in indicadores/dashboards only, never in painel or contadores | |

## 3. AWS architecture

| # | Definition | Status |
| --- | --- | --- |
| A1 | Region us-east-1, event account 698271685662, AWS profile `hackathon`. Never the `default` profile | |
| A2 | Frontend: Angular + Bootstrap SPA in a private S3 bucket (OAC) + CloudFront, HTTPS only | |
| A3 | API: API Gateway **REST** + Lambda (TypeScript, Node.js 22.x). Cognito User Pool Authorizer on every route, no anonymous endpoint | |
| A4 | Data: one DynamoDB table `Expedientes` (PK/SK, GSI1, GSI2) exactly as in `instrucoes-hackathon.md` / `itens.json`. On-demand, PITR on. No parallel schema. No `Scan` in request paths | |
| A5 | IaC: **AWS CDK v2 in TypeScript** via `npx aws-cdk@2`. `cdk synth` before every `cdk deploy`. Nothing created in the console | |
| A6 | Lambdas bundled with `NodejsFunction` + local esbuild (no Docker needed) | |
| A7 | IAM least privilege: one role per Lambda, only the table/index actions it uses, no `*` | |
| A8 | `RemovalPolicy.DESTROY` / `autoDeleteObjects` on hackathon stacks for easy cleanup | |
| A9 | Optional: EventBridge Scheduler + Lambda + SES daily digest. Domain events (batch action done, designação created) via EventBridge/SNS/SQS | |
| A10 | Optional: Amazon Bedrock (process summary, priority explanation, natural-language search). Never send sigiloso content without authorization | |
| A11 | Code layout: thin handlers, business rules in pure modules, data access in a repository layer | |

## 4. Security

| # | Definition | Status |
| --- | --- | --- |
| S1 | Identity, setor and perfil come from Cognito claims (custom attributes / groups), never from request params | |
| S2 | Every query scoped to the user's setor (`GSI1PK`/`GSI2PK = SETOR#<sigla>`) | |
| S3 | Sigiloso fields stripped by RN6 in API responses, exports, `.ics` and e-mails. No sigiloso content in logs | |
| S4 | Input validation with zod (or equivalent). 400 for invalid input, 403 for cross-setor access. Limits on batch and page size | |
| S5 | Encryption at rest (DynamoDB with KMS, S3 SSE). Amazon Verified Permissions is suggested but not decided | |
| S6 | No credentials, `.env*`, `cdk.out/`, `node_modules/` or build output in git | |

## 5. Accessibility, responsiveness and tests

| # | Definition | Status |
| --- | --- | --- |
| U1 | eMAG/WCAG 2.1 AA: keyboard navigation, visible focus, `label` on every field, tables with `caption`, `th id`, `td headers` | |
| U2 | `aria-live="polite"` for notices, `role="alert"` for errors. Prazo/prioridade badges always include text. Charts have an alternative table | |
| U3 | Colors from `catalogos.csv` with contrast checked. Mobile-first Bootstrap grid | |
| T1 | Vitest for backend rules (single run, `vitest --run`). Angular default runner for frontend | |
| T2 | API tests for main access paths, including denials (cross-setor, sigiloso) | |
| T3 | Playwright MCP for accessibility/keyboard smoke checks | |

## 6. Repository and process

| # | Definition | Status |
| --- | --- | --- |
| R1 | Folders: `infra/` (CDK), `backend/` (Lambdas), `frontend/` (Angular). Kit docs and seed only in `docs/hackathon-expedientes/` | |
| R2 | Kiro spec (requirements → design → tasks) in `.kiro/specs/` before code, plus hooks in `.kiro/hooks/` | |
| R3 | README with architecture diagram, build/deploy/seed steps, cost estimate and what is missing for production | |

## Points likely to cause disagreement

1. **`.kiro/settings/mcp.json` is committed with paths from one machine** (`C:\Users\Abraão Pessoa\...`, `C:\Program Files\nodejs\npx.cmd`). On other machines the MCP servers won't start. Options: each person keeps a local copy and we stop tracking the file, or we commit a portable version (`uvx` / `npx`) and each person sets full paths in their user-level config.
2. **`tech.md` "Local environment notes" describe one machine** (Avast certificate bundle, no Docker, uv via winget). These notes don't apply to other teammates. Proposal: move them to a personal file or mark them as specific to one machine.
3. **Everything lives inside the repo now.** The folders outside it (`../docs`, `../frontend`) are gone. The steering points to `docs/hackathon-expedientes/`, and the visual reference is `docs/hackathon-expedientes/Unico — Caixa do Gabinete.html`. Nothing should reference `../`.
4. **Docs and seed have one location: `docs/hackathon-expedientes/`.** The root copies (`instrucoes-hackathon.md`, `caso-de-uso-hackathon.md`, `seed/`) were identical and have been removed. All steering files point there. If a branch still uses `seed/...` at the root, update it to `docs/hackathon-expedientes/seed/...`.
5. **Stack choices that the official instructions leave open.** The instructions allow "Angular or another" SPA and don't fix the IaC tool. The steering chose Angular, CDK (TypeScript), REST API and Vitest. If anyone started with SAM, HTTP API, React or Python Lambdas, agree on one option now.
6. **Optional items with no owner yet:** Bedrock, Verified Permissions, KMS keys, EventBridge/SES. Decide what goes into the MVP.
