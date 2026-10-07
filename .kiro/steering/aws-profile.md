# AWS CLI profile

- Always use the `hackathon` AWS profile for every AWS command (AWS CLI, CDK, SDK scripts, seed loader).
  - AWS CLI: pass `--profile hackathon` on every call (e.g. `aws sts get-caller-identity --profile hackathon`).
  - CDK: `npx aws-cdk@2 <synth|deploy|destroy> --profile hackathon`.
  - Python/boto3 and Node SDK scripts: run with `AWS_PROFILE=hackathon` set for that command.
- Region is `us-east-1` (already set in the profile; still pass `--region us-east-1` when the tool requires it).
- Never use the `default` profile or other profiles, and never rely on `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN` env vars. If they are set, they override `AWS_PROFILE`; unset them or use explicit `--profile hackathon`.
- Never write credential values into repository files, specs, logs or chat output.
- Credentials are temporary. On `ExpiredToken` or `InvalidClientTokenId`, stop and ask the user for new credentials to update the `hackathon` profile (`aws configure set ... --profile hackathon`). Do not retry with other credentials.
- Before any deploy, confirm the account with `aws sts get-caller-identity --profile hackathon` (expected account `698271685662`).
