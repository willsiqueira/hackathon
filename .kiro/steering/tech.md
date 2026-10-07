---
inclusion: always
---

# Tech stack and conventions

## Repository
- This workspace root is the app repo (git remote: github.com/willsiqueira/hackathon). Suggested layout:
  - `infra/` - AWS CDK v2 app (TypeScript)
  - `backend/` - Lambda handlers (TypeScript, Node.js 22.x runtime)
  - `frontend/` - Angular SPA + Bootstrap (matches Único's look; reference HTML in `../frontend/`)
  - `seed/` - copy of the seed generator / loader
- Do not commit generated build output, `cdk.out/`, `node_modules/`, `.env*` or any AWS credentials.

## AWS architecture
- Region: us-east-1 (event account). Always pass `--region us-east-1` or set it in CDK `env`.
- Frontend: S3 (private, OAC) + CloudFront, HTTPS only.
- API: API Gateway (REST) + Lambda, Cognito User Pool Authorizer on every route. No anonymous endpoints.
- Data: DynamoDB single table `Expedientes` (PK/SK, GSI1, GSI2) exactly as in docs/instrucoes-hackathon.md. On-demand billing, PITR on.
- Alerts (optional): EventBridge Scheduler + Lambda + SES daily digest.
- IaC: everything through CDK. Use `npx aws-cdk@2` (no global install). Run `cdk synth` before every `cdk deploy`.
- Least-privilege IAM: grant Lambdas only the table/index actions they use (`table.grantReadData`, etc.).
- Set `RemovalPolicy.DESTROY` and `autoDeleteObjects` only for the hackathon stacks so cleanup is easy.

## Security (backend is the authority)
- Derive user identity, setor and perfil from Cognito claims (custom attributes), never from request params.
- Every query is scoped to the user's setor (GSI1PK/GSI2PK = SETOR#<sigla>).
- Sigiloso: strip content fields unless the rule in RN6 allows it. Same filtering for exports, `.ics`, and e-mails.
- Validate all inputs (zod or equivalent); return 403 for cross-setor access, 400 for invalid input.

## Accessibility and responsiveness (graded)
- eMAG/WCAG 2.1 AA: keyboard navigation, visible focus, `label` on every field, tables with `caption`, `th id`, `td headers`.
- `aria-live="polite"` for notices, `role="alert"` for errors. Never convey info only by color: prazo/prioridade badges always include text.
- Colors from `catalogos.csv`; verify contrast. Mobile-first layouts with Bootstrap grid.

## Testing
- Unit tests for business rules (prioridade, risco, statusPrazo, lote validation) with Vitest (backend) / Angular default runner (frontend).
- API tests for main access paths, including authorization denials (cross-setor, sigiloso).
- Run tests in single-run mode (`vitest --run`), never watch mode.
- Use the Playwright MCP for accessibility/keyboard smoke checks of the running frontend.

## Local environment notes (Windows + pwsh)
- An antivirus intercepts TLS. Root CAs are exported to `%USERPROFILE%\.certs\windows-roots.pem` and wired through `NODE_EXTRA_CA_CERTS`, `AWS_CA_BUNDLE`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `UV_SYSTEM_CERTS`, and npm `cafile`. If a tool fails with a certificate error, point it at that bundle.
- Python is provided by uv (`uv run`, `uvx`). Seed load: `uv run --no-project --with boto3 python ../docs/seed/gerar_seed.py --carregar --criar-tabela --tabela Expedientes --regiao us-east-1`.
- Docker is not installed: prefer CDK `NodejsFunction` with local esbuild bundling (add `esbuild` as a devDependency).
