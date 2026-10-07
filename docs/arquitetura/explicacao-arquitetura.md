# AWS architecture by flow

The architecture is one CDK stack (`infra/lib/lex-gabinete-stack.ts`) in us-east-1, and it's all serverless. It follows four flows, which line up with the arrows in the diagram.

![AWS architecture](arquitetura-aws.png)

## 1. Opening the app

User → CloudFront (HTTPS only) → private S3 bucket holding the Angular SPA.

- Only CloudFront can read the bucket (OAC), and files are encrypted at rest.
- CloudFront adds security headers (CSP, HSTS, no iframes).
- A small CloudFront Function sends SPA routes like `/painel` to `index.html`.

## 2. Login

User → Cognito User Pool → gets a token.

- There's no self sign-up. Only the fictitious demo users exist.
- The token carries the user's identity and setor as read-only attributes, so the user can't change them from the browser. The perfil (MEMBRO, CHEFE or SERVIDOR) comes from the Cognito group.

## 3. Using the painel (each request)

Browser → CloudFront `/api/*` → API Gateway → Lambda Api → DynamoDB.

- The SPA and the API share one domain, so there's no CORS. API responses are never cached.
- API Gateway checks the Cognito token on every route, so nothing is anonymous. It also limits request rates.
- The single Lambda holds the business rules (RN1 to RN7). It validates input with zod and reads setor and perfil from the token, never from the request.
- DynamoDB is a single `Expedientes` table. Every query goes through GSI1 or GSI2, keyed by `SETOR#<sigla>`, so a user only ever sees their own setor. Sigiloso fields are removed before the response leaves the Lambda.

## 4. Background work (async)

- **Designation alerts:** when a processo is designated, the Api Lambda publishes an `ExpedienteDesignado` event to EventBridge. A Notificador Lambda writes the alert for the assigned user. Delivery is retried 3 times, and events that still fail go to an SQS dead-letter queue. The user's request never waits for this.
- **Daily digest:** EventBridge Scheduler runs the Resumo Lambda at 7h Brasília time on weekdays. It reads the vencidos and vencem hoje items and e-mails them through SES, without sigiloso content.

## Operations

- All of this is deployed with CDK; nothing was created in the console.
- Each Lambda has its own least-privilege role. For example, the digest Lambda can only read the table.
- Logs go to CloudWatch, and X-Ray traces the requests.

## Quick pitch

"The static site comes from CloudFront and S3. Cognito handles login. Every API call goes through API Gateway with the Cognito authorizer, then into a Lambda that enforces setor and sigilo before reading DynamoDB. Alerts and the daily e-mail run separately through EventBridge and SES. It all scales on demand and is defined in CDK."

## Glossary

### AWS services

| Term | Meaning |
| --- | --- |
| API Gateway | Managed front door for the API. It receives HTTP requests, checks the login token and forwards valid requests to Lambda. |
| CDK (Cloud Development Kit) | Lets us define the infrastructure in TypeScript code. It generates CloudFormation templates that create the resources. |
| CloudFormation | AWS service that creates and updates resources from a template, as one unit called a stack. |
| CloudFront | AWS content delivery network (CDN). It serves the site from locations close to the user and routes `/api/*` to the API. |
| CloudFront Function | Small piece of code that runs in CloudFront on each request. Here it rewrites SPA routes to `index.html`. |
| CloudWatch | Monitoring service. It stores the Lambda and API logs and their metrics. |
| Cognito User Pool | Managed user directory. It handles login and issues the tokens the API trusts. |
| Cognito group | Named set of users in the pool. We use one group per perfil: MEMBRO, CHEFE, SERVIDOR. |
| DynamoDB | Managed NoSQL database. It scales automatically and answers key-based queries quickly. |
| EventBridge | Event bus. One service publishes an event and rules deliver it to whoever is interested, without the two knowing each other. |
| EventBridge Scheduler | Runs a target on a schedule, like a cloud cron. Here it triggers the daily digest. |
| IAM role | Set of permissions an AWS resource uses. Each Lambda has its own role. |
| Lambda | Runs code without managing servers. It starts on demand and you pay per execution. |
| S3 | Object storage. Here it holds the built frontend files. |
| SES (Simple Email Service) | Service for sending e-mail. It sends the daily digest. |
| SQS (Simple Queue Service) | Managed message queue. Here it is used only as the dead-letter queue. |
| X-Ray | Tracing service. It shows the path and timing of a request across API Gateway, Lambda and DynamoDB. |

### Technical concepts

| Term | Meaning |
| --- | --- |
| Async (asynchronous) | Work done in the background, after the user's request has already been answered. |
| Authorizer | API Gateway step that validates the token before any code runs. Without a valid token, the call gets 401. |
| Cache | Stored copy of a response, reused to answer faster. API responses skip it so data is always current. |
| CORS | Browser rule that blocks calls to another domain unless the server allows them. Using one domain for SPA and API avoids it. |
| CSP (Content Security Policy) | Header that tells the browser which sources of scripts, styles and connections are allowed. It reduces XSS risk. |
| Dead-letter queue (DLQ) | Queue that keeps events that failed every retry, so they are not lost and can be inspected. |
| Encryption at rest | Data is encrypted while stored on disk, with keys managed by AWS (KMS). |
| GSI (Global Secondary Index) | Extra index on a DynamoDB table, with its own keys. GSI1 serves the painel by caixa; GSI2 serves the queue by prazo and prioridade. |
| HSTS | Header that forces the browser to use HTTPS for the site from then on. |
| HTTPS | HTTP encrypted with TLS. All traffic uses it. |
| iframe | Page embedded inside another page. Blocking it prevents clickjacking. |
| Least privilege | Grant only the permissions a component actually needs, nothing more. |
| OAC (Origin Access Control) | CloudFront feature that lets only that distribution read the private S3 bucket. |
| On demand | Capacity grows and shrinks with usage, and you pay for what is used. |
| Partition key (`SETOR#<sigla>`) | Key that groups items in DynamoDB. Querying by the user's setor key means other setores' data is never read. |
| Rate limiting (throttling) | Cap on requests per second, protecting the API from abuse or overload. |
| Region (us-east-1) | AWS geographic location where the resources run (N. Virginia, the event account). |
| Retry | Automatic new attempt after a failure. |
| Security headers | HTTP response headers that tell the browser to apply protections (CSP, HSTS, frame blocking). |
| Self sign-up | Users creating their own accounts. It is disabled; only the demo users exist. |
| Serverless | No servers to manage. AWS runs, scales and patches the infrastructure. |
| Single table | DynamoDB design that keeps all entities (expedientes, histórico, alertas, preferências) in one table, told apart by keys. |
| SPA (Single Page Application) | Web app loaded once in the browser that changes screens without reloading the page. Ours is Angular. |
| Stack | Group of resources created and removed together. |
| Token (ID token) | Signed proof of login issued by Cognito. It carries the user's identity, setor and groups. |
| Token attributes | Fields inside the token. `idUsuario` and `siglaSetor` are read-only, so the browser cannot change them. |
| zod | TypeScript library that validates input. Invalid requests are rejected with 400. |

### Domain terms

| Term | Meaning |
| --- | --- |
| Angular | Frontend framework used by Único and by this SPA (with Bootstrap). |
| Business rules (RN1 to RN7) | Rules from the use case: situação do prazo, pontuação de prioridade, queue order, which caixa allows each action, archiving with minuta, access by setor and sigilo, and BAIXADO as history. |
| Designação | Assigning a processo to a person, with a return date. It triggers the `ExpedienteDesignado` event. |
| Expediente / processo | A case or document handled by the gabinete. |
| Painel | Main list of active expedientes, with filters and prazo badges. |
| Perfil | User role: MEMBRO (titular), CHEFE (chefe de gabinete) or SERVIDOR (assessor). |
| Setor | Organizational unit, such as GABSUB3-DVT. Users only see their own setor's data. |
| Sigiloso | Confidential expediente. Its content is hidden unless the rules allow it, including in exports, `.ics` files and e-mails. |
| Vencidos / vencem hoje | Items whose prazo has already passed / ends today. |
