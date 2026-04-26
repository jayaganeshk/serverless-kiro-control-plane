---
inclusion: manual
---

# Agent Deployment Checklist

Before deploying the agent, verify these prerequisites:

## 1. Backend Deployment

- [ ] SAM stack is deployed: `aws cloudformation describe-stacks --stack-name remote-kiro-assistant --region ap-south-1`
- [ ] API Gateway is accessible: `curl https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/agents/register` (should return 400 or 401, not 404)
- [ ] Lambda functions are deployed: `aws lambda list-functions --region ap-south-1 | grep remote-kiro`

## 2. Agent Machine Setup

- [ ] Node.js 20+ installed: `node --version`
- [ ] npm installed: `npm --version`
- [ ] Git installed: `git --version`
- [ ] kiro-cli installed: `kiro-cli --version`
- [ ] AWS CLI v2 installed: `aws --version`

## 3. AWS Credentials

- [ ] AWS credentials configured (SSO, env vars, or instance profile)
- [ ] Credentials can assume the agent IAM role: `aws sts get-caller-identity`
- [ ] Agent role has SQS permissions: `aws sqs get-queue-attributes --queue-url <queue-url> --attribute-names ApproximateNumberOfMessages`

## 4. Agent Configuration

- [ ] `agent-config.json` has correct `backendApiUrl` (from SAM outputs)
- [ ] `agent-config.json` has correct `sqsQueueUrl` (from SAM outputs)
- [ ] `agent-config.json` has correct `workspaceRoot` (writable directory)
- [ ] `agent.env` has correct `AWS_REGION` and `BUNDLES_BUCKET`

## 5. Deployment Steps

```bash
# 1. Extract the zip
unzip agent-deploy.zip -d remote-kiro-agent
cd remote-kiro-agent

# 2. Make start script executable
chmod +x start-agent.sh

# 3. Install kiro-cli (if not already installed)
curl -fsSL https://cli.kiro.dev/install | bash

# 4. Configure AWS credentials
# Option A: SSO
aws sso login --profile YOUR_PROFILE
export AWS_PROFILE=YOUR_PROFILE

# Option B: Environment variables
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=ap-south-1

# 5. Verify configuration
cat agent-config.json
cat agent.env

# 6. Start the agent
./start-agent.sh
```

## 6. Verification

After starting the agent, you should see:

```
[2026-03-25T15:09:31.948Z] [INFO] Agent starting with config from ...
[2026-03-25T15:09:31.949Z] [INFO] Machine: Remote Agent - ...
[2026-03-25T15:09:31.950Z] [INFO] Validating prerequisites...
[2026-03-25T15:09:33.965Z] [INFO] Prerequisites validated: kiro-cli and git are available
[2026-03-25T15:09:33.966Z] [INFO] Registering agent with backend...
[2026-03-25T15:09:34.000Z] [INFO] Agent registered with ID: ...
[2026-03-25T15:09:34.001Z] [INFO] Heartbeat started (interval: 10000ms)
[2026-03-25T15:09:34.002Z] [INFO] SQS poller started (queue: ...)
[2026-03-25T15:09:34.003Z] [INFO] Agent is running. Press Ctrl+C to stop.
```

If you see an error, check `.kiro/steering/agent-troubleshooting.md` for solutions.

## 7. Monitoring

- [ ] Agent logs: `tail -f /home/ubuntu/agent-workspace/.logs/agent.log`
- [ ] Job logs: `ls /home/ubuntu/agent-workspace/.logs/`
- [ ] Portal shows agent as online: Check the portal admin page

## 8. Running as a Service (Optional)

To run the agent as a systemd service:

```bash
sudo tee /etc/systemd/system/remote-kiro-agent.service > /dev/null <<EOF
[Unit]
Description=Remote Kiro Agent
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/repos/kiro-remote-assistant/remote-kiro-agent
ExecStart=/home/ubuntu/repos/kiro-remote-assistant/remote-kiro-agent/start-agent.sh
Restart=always
RestartSec=10
Environment=AWS_REGION=ap-south-1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable remote-kiro-agent
sudo systemctl start remote-kiro-agent
sudo systemctl status remote-kiro-agent
```

View logs:
```bash
sudo journalctl -u remote-kiro-agent -f
```
