# Remote Kiro Agent — Setup Guide

Set up the Remote Kiro Agent on a separate machine to poll for jobs from the portal and execute them using `kiro-cli acp`.

## Architecture Overview

```
Portal (browser) → API Gateway → DynamoDB (job record) + SQS (job message)
                                                              ↓
Agent (this machine) ← polls SQS ← picks up job → kiro-cli acp → git push → create PR
```

The agent:
1. Polls the SQS queue for new job messages
2. Claims the job via the backend API (IAM SigV4 auth)
3. Clones the repo, applies the config bundle, runs `kiro-cli acp` to implement the feature
4. Commits, pushes, creates a PR, and marks the job complete

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | >= 20 | Runtime |
| Git | >= 2.x | Repo operations |
| kiro-cli | latest | Kiro ACP (Agent Communication Protocol) |
| AWS CLI v2 | latest | Credential management |

### Install kiro-cli

```bash
curl -fsSL https://cli.kiro.dev/install | bash
```

Verify it's on PATH:

```bash
kiro --version
```

### Configure AWS Credentials

The agent uses IAM SigV4 to authenticate with the backend API. You need credentials that can assume the agent IAM role.

**Agent IAM Role ARN:**
```
arn:aws:iam::183103430916:role/dev-remote-kiro-agent-role
```

Option A — Use SSO (recommended):
```bash
aws configure sso
# Region: ap-south-1
# Then assume the agent role or use your admin role
```

Option B — Use environment variables:
```bash
export AWS_ACCESS_KEY_ID=<your-key>
export AWS_SECRET_ACCESS_KEY=<your-secret>
export AWS_SESSION_TOKEN=<your-token>  # if using temporary creds
export AWS_REGION=ap-south-1
```

Verify credentials:
```bash
aws sts get-caller-identity
```

---

## Setup Steps

### 1. Clone the Repository

```bash
git clone <your-repo-url> remote-kiro-agent
cd remote-kiro-agent
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build All Packages

```bash
npm run build --workspaces
```

Or build individually:
```bash
cd packages/common && npm run build && cd ../..
cd packages/agent && npm run build && cd ../..
```

### 4. Create the Agent Config File

Create `agent-config.json` in the project root (or anywhere — you'll pass the path):

```json
{
  "machineId": "agent-machine-01",
  "machineLabel": "Dev Agent - MyMachine",
  "capabilities": ["implement_feature"],
  "repoAllowlist": [],
  "workspaceRoot": "/home/user/agent-workspace",
  "pollingIntervalMs": 10000,
  "maxConcurrentJobs": 1,
  "bundleCacheDir": "/home/user/agent-workspace/.bundle-cache",
  "backendApiUrl": "https://qkcm9eti1b.execute-api.ap-south-1.amazonaws.com/dev",
  "sqsQueueUrl": "https://sqs.ap-south-1.amazonaws.com/183103430916/dev-remote-kiro-job-queue",
  "logDir": "/home/user/agent-workspace/.logs"
}
```


**Config fields explained:**

| Field | Description |
|-------|-------------|
| `machineId` | Unique identifier for this agent machine |
| `machineLabel` | Human-readable label shown in the portal |
| `capabilities` | Job types this agent can handle (`implement_feature`, `review_pr`) |
| `repoAllowlist` | Restrict to specific repo IDs. Empty = accept all repos |
| `workspaceRoot` | Directory where repos are cloned and work happens |
| `pollingIntervalMs` | How often to poll SQS (default: 10s) |
| `maxConcurrentJobs` | Max parallel jobs (default: 1) |
| `bundleCacheDir` | Local cache for downloaded config bundles |
| `backendApiUrl` | The deployed API Gateway URL |
| `sqsQueueUrl` | The SQS queue URL for job messages |
| `logDir` | Directory for agent and job logs |

### 5. Create the Workspace Directory

```bash
mkdir -p /home/user/agent-workspace/.bundle-cache
mkdir -p /home/user/agent-workspace/.logs
```

### 6. Set Environment Variables

The agent also needs these env vars for the bundle cache (S3 access):

```bash
export BUNDLES_BUCKET=dev-remote-kiro-artifacts-183103430916
export AWS_REGION=ap-south-1
```

### 7. Configure Git (for PR creation)

```bash
git config --global user.name "Remote Kiro Agent"
git config --global user.email "kiro-agent@example.com"
```

Ensure the machine has SSH or HTTPS access to your GitHub repos:
```bash
# Test GitHub access
ssh -T git@github.com
# or for HTTPS, configure a credential helper / PAT
```

---

## Running the Agent

### Quick Start (using build script)

The easiest way to set up the agent on a remote machine:

```bash
# On your dev machine (where SAM was deployed):
chmod +x build-agent.sh
./build-agent.sh                              # uses defaults: remote-kiro-assistant, ap-south-1
# or with custom stack/region:
./build-agent.sh my-stack-name us-east-1
```

This creates `agent-deploy.zip` containing compiled code, config, and a start script.

```bash
# On the agent machine:
unzip agent-deploy.zip -d remote-kiro-agent
cd remote-kiro-agent
chmod +x start-agent.sh
curl -fsSL https://cli.kiro.dev/install | bash
# Edit agent.env with AWS credentials if needed
# Edit agent-config.json (machineId, workspaceRoot, etc.)
./start-agent.sh
```

### Manual Start

```bash
# From the project root
node packages/agent/dist/index.js agent-config.json
```

Or with tsx for development:
```bash
npx tsx packages/agent/src/index.ts agent-config.json
```

Expected output:
```
[2026-03-22T10:00:00.000Z] [INFO] Agent starting with config from agent-config.json
[2026-03-22T10:00:00.001Z] [INFO] Machine: Dev Agent - MyMachine (agent-machine-01)
[2026-03-22T10:00:00.002Z] [INFO] Validating prerequisites...
[2026-03-22T10:00:02.000Z] [INFO] Prerequisites validated: kiro-cli and git are available
[2026-03-22T10:00:02.500Z] [INFO] Registering agent with backend...
[2026-03-22T10:00:03.000Z] [INFO] Agent registered with ID: agent-machine-01
[2026-03-22T10:00:03.001Z] [INFO] Heartbeat started (interval: 10000ms)
[2026-03-22T10:00:03.002Z] [INFO] SQS poller started (queue: https://sqs.ap-south-1...)
[2026-03-22T10:00:03.003Z] [INFO] Agent is running. Press Ctrl+C to stop.
```

---

## Job Processing Pipeline

When the agent picks up an `implement_feature` job, it runs these stages:

| # | Stage | What it does |
|---|-------|-------------|
| 1 | VALIDATING_REPO | Validates the repo URL is accessible |
| 2 | PREPARING_WORKSPACE | Clones the repo, checks out base branch, creates work branch |
| 3 | APPLYING_BUNDLE | Downloads config bundle from S3, extracts to repo |
| 4 | RUNNING_KIRO | Spawns `kiro-cli acp`, sends the feature prompt, waits for completion |
| 5 | RUNNING_TESTS | Runs any test commands defined in the bundle |
| 6 | COMMITTING | Stages and commits all changes |
| 7 | PUSHING | Pushes the work branch to remote |
| 8 | CREATING_PR | Creates a pull request via GitHub API |
| 9 | FINALIZING | Marks job complete, uploads logs as artifacts |

Each stage posts progress events to the backend API, visible in the portal's job detail page.

---

## Kiro CLI ACP Integration

The agent communicates with `kiro-cli` via the Agent Communication Protocol (ACP) — a JSON-RPC protocol over stdin/stdout:

1. Agent spawns `kiro-cli acp`
2. Sends `initialize` with client capabilities
3. Creates a session with `session/new` (passing the repo directory and any MCP servers from the bundle)
4. Sends the feature prompt via `session/prompt`
5. Receives streaming updates (tool calls, agent messages, turn end)
6. Destroys the session when done

The agent handles timeouts (30 min for features, 15 min for reviews) and crashes gracefully.

---

## Deployed Infrastructure Reference

| Resource | Value |
|----------|-------|
| API Gateway URL | `https://qkcm9eti1b.execute-api.ap-south-1.amazonaws.com/dev` |
| SQS Job Queue | `https://sqs.ap-south-1.amazonaws.com/183103430916/dev-remote-kiro-job-queue` |
| S3 Artifacts Bucket | `dev-remote-kiro-artifacts-183103430916` |
| Agent IAM Role | `arn:aws:iam::183103430916:role/dev-remote-kiro-agent-role` |
| Cognito User Pool | `ap-south-1_kNNhYJntZ` |
| Region | `ap-south-1` |
| Stack Name | `remote-kiro-assistant` |

---

## Troubleshooting

**"kiro-cli is not installed or not on PATH"**
→ Install kiro-cli: `curl -fsSL https://cli.kiro.dev/install | bash`

**"The security token included in the request is expired"**
→ Refresh your AWS credentials. The agent caches the SDK client, so restart the agent after refreshing.

**"Backend API URL must use HTTPS"**
→ The agent's API client enforces HTTPS. Use the API Gateway URL, not localhost.

**Job stuck in QUEUED**
→ Check that the agent is polling the correct SQS queue URL and has permissions to receive/delete messages.

**"ENOENT" errors during git operations**
→ Ensure git is installed and the workspace directory exists with write permissions.

**Logs location**
→ Agent logs: `<logDir>/agent.log`
→ Per-job logs: `<logDir>/<jobId>.log`

---

## Running as a Service (Optional)

For production, run the agent as a systemd service or use PM2:

```bash
# Using PM2
npm install -g pm2
pm2 start packages/agent/dist/index.js --name remote-kiro-agent -- agent-config.json
pm2 save
pm2 startup
```

Or with systemd:
```ini
[Unit]
Description=Remote Kiro Agent
After=network.target

[Service]
Type=simple
User=kiro-agent
WorkingDirectory=/opt/remote-kiro-agent
ExecStart=/usr/bin/node packages/agent/dist/index.js agent-config.json
Restart=always
RestartSec=10
Environment=AWS_REGION=ap-south-1
Environment=BUNDLES_BUCKET=dev-remote-kiro-artifacts-183103430916

[Install]
WantedBy=multi-user.target
```
