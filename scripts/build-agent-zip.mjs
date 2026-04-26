/**
 * Creates a self-contained agent ZIP package.
 * 
 * Structure inside the zip:
 *   packages/agent/dist/          - compiled agent code
 *   packages/agent/package.json
 *   packages/common/dist/         - compiled common code
 *   packages/common/package.json
 *   node_modules/                 - production dependencies
 *   package.json                  - root package.json (workspace)
 *   agent-config.template.json    - config template
 *   start-agent.sh                - Linux/Mac startup script
 *   start-agent.bat               - Windows startup script
 *   README-AGENT.md               - Quick start guide
 */
import { createWriteStream, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import archiver from 'archiver';

const OUT = resolve('remote-kiro-agent.zip');

const archive = archiver('zip', { zlib: { level: 6 } });
const output = createWriteStream(OUT);

output.on('close', () => {
  const mb = (archive.pointer() / 1024 / 1024).toFixed(2);
  console.log(`✅ Agent ZIP created: ${OUT} (${mb} MB)`);
});

archive.on('error', (err) => { throw err; });
archive.pipe(output);

const STAGING = '.aws-sam/agent-staging';

// 1. Agent dist + package.json
archive.directory(`${STAGING}/packages/agent/dist/`, 'packages/agent/dist');
archive.file(`${STAGING}/packages/agent/package.json`, { name: 'packages/agent/package.json' });

// 2. Common dist + package.json
archive.directory(`${STAGING}/packages/common/dist/`, 'packages/common/dist');
archive.file(`${STAGING}/packages/common/package.json`, { name: 'packages/common/package.json' });

// 3. Agent node_modules (production deps — installed standalone)
archive.directory(`${STAGING}/packages/agent/node_modules/`, 'packages/agent/node_modules');

// 4. Config template
const configTemplate = {
  machineId: "agent-001",
  machineLabel: "My Coding Agent",
  capabilities: ["implement_feature", "review_pr"],
  repoAllowlist: [],
  workspaceRoot: "/home/user/workspace",
  pollingIntervalMs: 10000,
  maxConcurrentJobs: 1,
  bundleCacheDir: "./bundle-cache",
  backendApiUrl: "https://<api-id>.execute-api.<region>.amazonaws.com/<stage>",
  sqsQueueUrl: "https://sqs.<region>.amazonaws.com/<account-id>/<stack-name>-job-queue",
  logDir: "./logs"
};
archive.append(JSON.stringify(configTemplate, null, 2), { name: 'agent-config.template.json' });

// 5. Startup scripts
const startSh = `#!/bin/bash
# Remote Kiro Agent — Start Script
set -e

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Install deps if needed
if [ ! -d "packages/agent/node_modules" ]; then
  echo "Installing dependencies..."
  cd packages/agent && npm install --omit=dev && cd ../..
fi

# Copy config template if no config exists
if [ ! -f "agent-config.json" ]; then
  cp agent-config.template.json agent-config.json
  echo "⚠️  Created agent-config.json from template. Please edit it before running."
  exit 1
fi

echo "Starting Remote Kiro Agent..."
node packages/agent/dist/index.js agent-config.json
`;

const startBat = `@echo off
REM Remote Kiro Agent — Start Script
cd /d "%~dp0"

if not exist "packages\\agent\\node_modules" (
  echo Installing dependencies...
  cd packages\\agent
  call npm install --omit=dev
  cd ..\\..
)

if not exist "agent-config.json" (
  copy agent-config.template.json agent-config.json
  echo WARNING: Created agent-config.json from template. Please edit it before running.
  exit /b 1
)

echo Starting Remote Kiro Agent...
node packages\\agent\\dist\\index.js agent-config.json
`;

archive.append(startSh, { name: 'start-agent.sh', mode: 0o755 });
archive.append(startBat, { name: 'start-agent.bat' });

// 6. Quick README
const readme = `# Remote Kiro Agent — Quick Start

## Setup

1. Extract this ZIP to a directory
2. Copy \`agent-config.template.json\` to \`agent-config.json\`
3. Edit \`agent-config.json\`:
   - Set \`machineId\` to a unique identifier
   - Set \`workspaceRoot\` to your workspace directory
   - Set \`sqsQueueUrl\` to your SQS queue URL
   - Set \`backendApiUrl\` if different from default
4. Ensure \`kiro-cli\` and \`git\` are on your PATH
5. Configure AWS credentials (the agent needs SQS + API Gateway access)

## Run

**Linux/Mac:**
\`\`\`bash
chmod +x start-agent.sh
./start-agent.sh
\`\`\`

**Windows:**
\`\`\`cmd
start-agent.bat
\`\`\`

**Or directly:**
\`\`\`bash
node packages/agent/dist/index.js agent-config.json
\`\`\`

## Prerequisites
- Node.js 20+
- kiro-cli (installed and on PATH)
- git
- AWS credentials configured (for SQS polling and API access)

## See AGENT-SETUP.md for the full guide.
`;

archive.append(readme, { name: 'README-AGENT.md' });

await archive.finalize();
