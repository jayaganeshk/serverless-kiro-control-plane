# Deployment & Runbook

## Prerequisites

- AWS CLI v2 configured with credentials
- SAM CLI (`pip install aws-sam-cli`)
- Node.js 20+
- npm 9+

## Deploy Backend

```bash
npm install
npm run build

sam build
sam deploy --guided   # first time — saves config to samconfig.toml
sam deploy            # subsequent deploys

sam deploy --config-env dev
```

Required parameters on first deploy:
- `StageName` — `dev`, `staging`, or `prod`
- `GitHubWebhookSecret` — secret for validating GitHub webhook payloads

Note the outputs: `ApiUrl`, `CognitoUserPoolId`, `CognitoUserPoolClientId`, `CognitoDomain`, `SPABucketName`, `CloudFrontDistributionId`.

## Deploy Portal

```bash
cd packages/portal

# Create .env with values from SAM outputs
cat > .env <<EOF
VITE_API_URL=<ApiUrl>
VITE_COGNITO_USER_POOL_ID=<CognitoUserPoolId>
VITE_COGNITO_CLIENT_ID=<CognitoUserPoolClientId>
VITE_COGNITO_DOMAIN=<CognitoDomain>
VITE_REDIRECT_URI=https://<CloudFrontDomain>/callback
EOF

npm run build
aws s3 sync dist/ s3://<SPABucketName> --delete
aws cloudfront create-invalidation --distribution-id <CloudFrontDistributionId> --paths "/*"
```

## Run Local Agent

```bash
cd packages/agent

# Create agent-config.json
cat > agent-config.json <<EOF
{
  "region": "us-east-1",
  "queueUrl": "<JobQueueUrl from SAM outputs>",
  "apiBaseUrl": "<ApiUrl from SAM outputs>",
  "workDir": "/tmp/kiro-agent"
}
EOF

# Assume the agent IAM role (ARN from SAM outputs)
export AWS_PROFILE=<profile-with-assume-role>

node dist/index.js
```

## Monitoring

- CloudWatch metrics under `RemoteKiro` namespace: `JobCreatedCount`, `JobCompletedCount`, `JobFailedCount`, `JobTimedOutCount`
- DLQ alarm fires when messages land in the dead-letter queue
- Log groups: `/aws/lambda/{StageName}-remote-kiro-*`

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Jobs stuck in QUEUED | Agent running? SQS permissions? Check agent logs |
| 401 on portal API calls | Cognito token expired — re-login |
| Webhook not triggering jobs | Verify `GitHubWebhookSecret` matches GitHub config |
| Job TIMED_OUT | Increase `FeatureJobTimeoutMinutes` / `ReviewJobTimeoutMinutes` params |
| DLQ alarm | Inspect DLQ messages — likely a poison message or handler crash |
