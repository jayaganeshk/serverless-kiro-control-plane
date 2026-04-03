---
inclusion: manual
---

# Agent Troubleshooting Guide

## Common Issues & Solutions

### 1. HTTP 404 on Agent Registration

**Error:**
```
[FATAL] Agent failed to start: HTTP 404
```

**Cause:** The backend API endpoint `/agents/register` is not responding.

**Solutions:**

a) **Verify the API URL is correct:**
```bash
# Check agent-config.json
cat agent-config.json | grep backendApiUrl

# Should match the SAM output ApiUrl (from sam-output.json)
# Example: https://qkcm9eti1b.execute-api.ap-south-1.amazonaws.com/dev
```

b) **Test the API endpoint directly:**
```bash
# Replace with your actual API URL
curl -X POST https://qkcm9eti1b.execute-api.ap-south-1.amazonaws.com/dev/agents/register \
  -H "Content-Type: application/json" \
  -d '{"machineId":"test","machineLabel":"test","capabilities":["implement_feature"],"repoAllowlist":[],"workspaceRoot":"/tmp","maxConcurrentJobs":1}'
```

If you get 404, the backend isn't deployed or the route is wrong.

c) **Verify the backend is deployed:**
```bash
# Check if the SAM stack exists
aws cloudformation describe-stacks --stack-name remote-kiro-assistant --region ap-south-1

# Check if Lambda functions are deployed
aws lambda list-functions --region ap-south-1 | grep remote-kiro
```

d) **Check the API Gateway stage:**
The URL should end with `/dev` (the stage name). If your stage is different, update `agent-config.json`:
```json
{
  "backendApiUrl": "https://qkcm9eti1b.execute-api.ap-south-1.amazonaws.com/YOUR_STAGE"
}
```

### 2. "kiro-cli is not installed or not on PATH"

**Error:**
```
[INFO] Validating prerequisites...
[FATAL] Agent failed to start: kiro-cli is not installed or not on PATH
```

**Solution:**
```bash
# Install kiro-cli
curl -fsSL https://cli.kiro.dev/install | bash

# Verify it's on PATH
kiro-cli --version
```

### 3. "Cannot find module" errors

**Error:**
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...'
```

**Cause:** The compiled agent code has missing `.js` extensions in imports (ESM issue).

**Solution:** This should be fixed in the build. If you see this, rebuild the zip:
```bash
# On your dev machine
node build-agent.js
```

Then redeploy the new `agent-deploy.zip`.

### 4. Permission denied on start-agent.sh

**Error:**
```
bash: ./start-agent.sh: Permission denied
```

**Solution:**
```bash
chmod +x start-agent.sh
./start-agent.sh
```

### 5. "set: Illegal option -o pipefail"

**Error:**
```
start-agent.sh: 2: set: Illegal option -o pipefail
```

**Cause:** The script was run with `sh` (dash) instead of `bash`, and dash doesn't support `pipefail`.

**Solution:** The script should now be POSIX-compatible. Try:
```bash
./start-agent.sh
# or
bash start-agent.sh
```

### 6. AWS Credentials Not Found

**Error:**
```
[INFO] Registering agent with backend...
[FATAL] Agent failed to start: The security token included in the request is expired
```

**Cause:** AWS credentials are missing or expired.

**Solutions:**

a) **Using SSO:**
```bash
aws sso login --profile YOUR_PROFILE
export AWS_PROFILE=YOUR_PROFILE
./start-agent.sh
```

b) **Using environment variables:**
```bash
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_SESSION_TOKEN=your_token  # if using temporary creds
export AWS_REGION=ap-south-1
./start-agent.sh
```

c) **Using instance profile (on EC2):**
If running on an EC2 instance with an IAM role, credentials should be automatic. Verify the role has permissions to assume the agent role:
```bash
aws sts get-caller-identity
```

### 7. Agent Starts but No Jobs Appear

**Symptoms:**
- Agent logs show "Agent is running"
- But no jobs are being picked up from SQS

**Debugging:**

a) **Check SQS queue:**
```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-south-1.amazonaws.com/183103430916/dev-remote-kiro-job-queue \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-south-1
```

b) **Check agent logs:**
```bash
# Agent logs are in the logDir from agent-config.json
cat /home/ubuntu/agent-workspace/.logs/agent.log
```

c) **Verify SQS permissions:**
The agent IAM role needs `sqs:ReceiveMessage`, `sqs:DeleteMessage`, and `sqs:GetQueueAttributes` on the job queue.

### 8. Jobs Fail with "Repository Not Found"

**Error in job logs:**
```
VALIDATING_REPO: Repository URL not accessible
```

**Cause:** The agent can't clone the repo (SSH/HTTPS access issue).

**Solutions:**

a) **SSH access:**
```bash
# Ensure SSH key is configured
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519
# Add public key to GitHub
cat ~/.ssh/id_ed25519.pub
```

b) **HTTPS access:**
```bash
# Configure git credentials
git config --global credential.helper store
# Or use a personal access token
git clone https://YOUR_TOKEN@github.com/user/repo.git
```

c) **Test repo access:**
```bash
git clone <repo-url> /tmp/test-repo
```

### 9. Agent Crashes with "ENOENT" Errors

**Error:**
```
Error: ENOENT: no such file or directory
```

**Cause:** Workspace directories don't exist or aren't writable.

**Solution:**
```bash
# Verify workspace directories exist and are writable
ls -la /home/ubuntu/agent-workspace/
chmod 755 /home/ubuntu/agent-workspace/
```

### 10. Debugging with Verbose Logs

**Enable more detailed logging:**

Edit `agent-config.json` and increase polling frequency to see more activity:
```json
{
  "pollingIntervalMs": 5000
}
```

Check the agent log file:
```bash
tail -f /home/ubuntu/agent-workspace/.logs/agent.log
```

Check job-specific logs:
```bash
ls /home/ubuntu/agent-workspace/.logs/
cat /home/ubuntu/agent-workspace/.logs/<job-id>.log
```

## Getting Help

If you're still stuck:

1. **Collect logs:**
   ```bash
   tar czf agent-logs.tar.gz /home/ubuntu/agent-workspace/.logs/
   ```

2. **Check SAM stack:**
   ```bash
   aws cloudformation describe-stack-resources --stack-name remote-kiro-assistant --region ap-south-1
   ```

3. **Check API Gateway:**
   ```bash
   aws apigatewayv2 get-apis --region ap-south-1
   ```

4. **Check Lambda function logs:**
   ```bash
   aws logs tail /aws/lambda/dev-remote-kiro-agent --follow --region ap-south-1
   ```
