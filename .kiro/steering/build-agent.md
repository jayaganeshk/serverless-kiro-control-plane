---
inclusion: manual
---

# Build Agent Script (`build-agent.js`)

Cross-platform Node.js script that packages the Remote Kiro Agent into a deployable zip file.

## What It Does

1. Fetches SAM CloudFormation stack outputs (API URL, SQS queue URL, S3 bucket, IAM role ARN) and saves them to `sam-output.json`
2. Clean-builds `packages/common` and `packages/agent` (deletes old dist + tsbuildinfo first)
3. Assembles a staging directory with compiled code, package files, and generated configs
4. Creates `agent-deploy.zip` containing everything needed to run the agent on a remote Linux machine

## Usage

```bash
node build-agent.js [--stack <stack-name>] [--region <region>]
```

Defaults: `--stack remote-kiro-assistant`, `--region ap-south-1`.

## Prerequisites

- AWS CLI v2 configured with credentials that can read CloudFormation outputs
- Node.js 20+
- npm (for workspace builds)
- The SAM stack must already be deployed

## Zip Contents

| File | Purpose |
|------|---------|
| `packages/common/dist/` + `package.json` | Compiled shared types and utilities |
| `packages/agent/dist/` + `package.json` | Compiled agent code |
| `package.json` + `package-lock.json` | Root workspace config for `npm install` |
| `agent-config.json` | Pre-filled config with SAM output values (edit machineId, workspaceRoot) |
| `agent.env` | Environment variables (AWS_REGION, BUNDLES_BUCKET) |
| `start-agent.sh` | Entrypoint script — installs deps on first run, creates workspace dirs, starts agent |

## Deploy Flow

```
[Dev machine]                    [Agent machine (Linux)]
node build-agent.js              unzip agent-deploy.zip -d remote-kiro-agent
  → agent-deploy.zip             cd remote-kiro-agent
  → sam-output.json              chmod +x start-agent.sh
                                 curl -fsSL https://cli.kiro.dev/install | bash
                                 # edit agent.env, agent-config.json
                                 ./start-agent.sh
```

## How start-agent.sh Works

1. Sources `agent.env` for AWS_REGION and BUNDLES_BUCKET
2. On first run: runs `npm install --omit=dev` to install AWS SDK and other dependencies
3. Creates workspace directories (workspaceRoot, bundleCacheDir, logDir) from config
4. Starts the agent: `node packages/agent/dist/index.js <config-path>`

## Generated Files (gitignored)

- `sam-output.json` — raw CloudFormation stack outputs
- `agent-deploy.zip` — the deployable archive
- `.agent-stage/` — temporary staging directory (cleaned up after zip creation)

## Config Customization

After unzipping on the agent machine, edit `agent-config.json`:

- `machineId` — unique ID for this agent instance
- `machineLabel` — human-readable name shown in the portal
- `workspaceRoot` — where repos get cloned (default: `/home/ubuntu/agent-workspace`)
- `capabilities` — job types to accept (`implement_feature`, `review_pr`)
- `repoAllowlist` — restrict to specific repo IDs (empty = accept all)

## ESM Build Note

The agent package uses `"type": "module"` in package.json. The tsconfig uses `"module": "ES2022"` with `"moduleResolution": "node"` to emit proper ESM output (import/export).

A post-build script (`fix-esm-imports.cjs`) automatically adds `.js` extensions to all relative imports in the compiled output. This is required because Node.js ESM with `"type": "module"` enforces explicit file extensions for local imports.
