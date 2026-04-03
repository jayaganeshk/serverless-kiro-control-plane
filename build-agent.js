#!/usr/bin/env node

/**
 * build-agent.js — Cross-platform build & package script for the Remote Kiro Agent.
 *
 * Fetches SAM stack outputs, clean-builds the monorepo, and produces agent-deploy.zip
 * with a pre-filled agent-config.json, agent.env, and start-agent.sh.
 *
 * Usage:
 *   node build-agent.js [--stack <name>] [--region <region>]
 *
 * Defaults:
 *   --stack   remote-kiro-assistant
 *   --region  ap-south-1
 */

const { execSync } = require("node:child_process");
const {
  mkdirSync,
  rmSync,
  writeFileSync,
  cpSync,
  existsSync,
  statSync,
} = require("node:fs");
const { join, resolve } = require("node:path");
const { hostname } = require("node:os");

// ─── Helpers ───

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { stack: "remote-kiro-assistant", region: "ap-south-1" };
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--stack" || args[i] === "-s") && args[i + 1]) {
      parsed.stack = args[++i];
    } else if ((args[i] === "--region" || args[i] === "-r") && args[i + 1]) {
      parsed.region = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log("Usage: node build-agent.js [--stack <name>] [--region <region>]");
      process.exit(0);
    }
  }
  return parsed;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Main ───

async function main() {
  const ROOT = resolve(__dirname);
  const { stack, region } = parseArgs();
  const SAM_OUTPUT = join(ROOT, "sam-output.json");
  const STAGE_DIR = join(ROOT, ".agent-stage");
  const ZIP_PATH = join(ROOT, "agent-deploy.zip");

  // 1. Fetch SAM outputs
  console.log(`\n==> Fetching SAM stack outputs: ${stack} (${region})`);
  const rawOutputs = runCapture(
    `aws cloudformation describe-stacks --stack-name ${stack} --region ${region} --query "Stacks[0].Outputs" --output json`,
  );
  writeFileSync(SAM_OUTPUT, rawOutputs, "utf8");
  console.log("    Saved to sam-output.json");

  const outputs = JSON.parse(rawOutputs);
  const getOutput = (key) => {
    const entry = outputs.find((o) => o.OutputKey === key);
    if (!entry) {
      console.error(`ERROR: Output "${key}" not found in stack outputs.`);
      process.exit(1);
    }
    return entry.OutputValue;
  };

  const API_URL = getOutput("ApiUrl");
  const QUEUE_URL = getOutput("JobQueueUrl");
  const ARTIFACTS_BUCKET = getOutput("ArtifactsBucketName");
  const AGENT_ROLE_ARN = getOutput("AgentRoleArn");

  console.log(`    ApiUrl:          ${API_URL}`);
  console.log(`    JobQueueUrl:     ${QUEUE_URL}`);
  console.log(`    ArtifactsBucket: ${ARTIFACTS_BUCKET}`);
  console.log(`    AgentRoleArn:    ${AGENT_ROLE_ARN}`);

  // 2. Clean old builds
  console.log("\n==> Cleaning old builds...");
  for (const pkg of ["packages/common", "packages/agent"]) {
    const dist = join(ROOT, pkg, "dist");
    const info = join(ROOT, pkg, "tsconfig.tsbuildinfo");
    if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
    if (existsSync(info)) rmSync(info, { force: true });
  }

  // 3. Build
  console.log("\n==> Building packages...");
  run("npm run build --workspace=packages/common", { cwd: ROOT });
  run("npm run build --workspace=packages/agent", { cwd: ROOT });

  // 4. Assemble staging directory
  console.log("\n==> Assembling agent package...");
  if (existsSync(STAGE_DIR)) rmSync(STAGE_DIR, { recursive: true, force: true });

  const dirs = [
    join(STAGE_DIR, "packages", "common"),
    join(STAGE_DIR, "packages", "agent"),
  ];
  for (const d of dirs) mkdirSync(d, { recursive: true });

  // Copy compiled code + package.json
  cpSync(join(ROOT, "packages/common/dist"), join(STAGE_DIR, "packages/common/dist"), { recursive: true });
  cpSync(join(ROOT, "packages/common/package.json"), join(STAGE_DIR, "packages/common/package.json"));

  cpSync(join(ROOT, "packages/agent/dist"), join(STAGE_DIR, "packages/agent/dist"), { recursive: true });
  cpSync(join(ROOT, "packages/agent/package.json"), join(STAGE_DIR, "packages/agent/package.json"));

  // Root package files (for npm install --workspaces)
  cpSync(join(ROOT, "package.json"), join(STAGE_DIR, "package.json"));
  cpSync(join(ROOT, "package-lock.json"), join(STAGE_DIR, "package-lock.json"));

  // 5. Generate agent-config.json
  const agentConfig = {
    machineId: `agent-${hostname()}`,
    machineLabel: `Remote Agent - ${hostname()}`,
    capabilities: ["implement_feature"],
    repoAllowlist: [],
    workspaceRoot: "/home/ubuntu/agent-workspace",
    pollingIntervalMs: 10000,
    maxConcurrentJobs: 1,
    bundleCacheDir: "/home/ubuntu/agent-workspace/.bundle-cache",
    backendApiUrl: API_URL,
    sqsQueueUrl: QUEUE_URL,
    logDir: "/home/ubuntu/agent-workspace/.logs",
  };
  writeFileSync(
    join(STAGE_DIR, "agent-config.json"),
    JSON.stringify(agentConfig, null, 2) + "\n",
  );

  // 6. Generate agent.env
  const envContent = [
    `export AWS_REGION=${region}`,
    `export BUNDLES_BUCKET=${ARTIFACTS_BUCKET}`,
    "# Uncomment and set if not using instance profile or SSO:",
    "# export AWS_ACCESS_KEY_ID=",
    "# export AWS_SECRET_ACCESS_KEY=",
    "# export AWS_SESSION_TOKEN=",
    "",
  ].join("\n");
  writeFileSync(join(STAGE_DIR, "agent.env"), envContent);

  // 7. Generate start-agent.sh (POSIX sh-compatible — works with dash/bash/sh)
  const startScript = [
    '#!/bin/sh',
    'set -eu',
    '',
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    'CONFIG="${1:-$SCRIPT_DIR/agent-config.json}"',
    '',
    '# Source env if present',
    'if [ -f "$SCRIPT_DIR/agent.env" ]; then',
    '  . "$SCRIPT_DIR/agent.env"',
    'fi',
    '',
    '# Install deps on first run',
    'if [ ! -d "$SCRIPT_DIR/node_modules" ]; then',
    '  echo "Installing dependencies (first run)..."',
    '  cd "$SCRIPT_DIR"',
    '  npm install --omit=dev',
    '  cd - > /dev/null',
    'fi',
    '',
    '# Create workspace directories from config',
    "node -e \"const c=JSON.parse(require('fs').readFileSync('$CONFIG','utf8'));[c.workspaceRoot,c.bundleCacheDir,c.logDir].forEach(d=>require('fs').mkdirSync(d,{recursive:true}))\"",
    '',
    'echo "Starting Remote Kiro Agent..."',
    'exec node "$SCRIPT_DIR/packages/agent/dist/index.js" "$CONFIG"',
    '',
  ].join("\n");
  writeFileSync(join(STAGE_DIR, "start-agent.sh"), startScript, { mode: 0o755 });

  // 8. Create zip (cross-platform)
  console.log("\n==> Creating agent-deploy.zip...");
  if (existsSync(ZIP_PATH)) rmSync(ZIP_PATH);

  const isWindows = process.platform === "win32";
  if (isWindows) {
    // PowerShell Compress-Archive
    const psStage = STAGE_DIR.replace(/\//g, "\\");
    const psZip = ZIP_PATH.replace(/\//g, "\\");
    run(
      `powershell -NoProfile -Command "Compress-Archive -Path '${psStage}\\*' -DestinationPath '${psZip}' -Force"`,
      { cwd: ROOT },
    );
  } else {
    run(`zip -r "${ZIP_PATH}" .`, { cwd: STAGE_DIR });
  }

  // Cleanup staging
  rmSync(STAGE_DIR, { recursive: true, force: true });

  const zipSize = formatSize(statSync(ZIP_PATH).size);
  console.log(`\nDone! Output: agent-deploy.zip (${zipSize})`);
  console.log("SAM outputs: sam-output.json\n");
  console.log("Deploy on the agent machine:");
  console.log("  1. unzip agent-deploy.zip -d remote-kiro-agent");
  console.log("  2. cd remote-kiro-agent");
  console.log("  3. chmod +x start-agent.sh");
  console.log("  4. curl -fsSL https://cli.kiro.dev/install | bash");
  console.log("  5. Configure AWS credentials (edit agent.env or use SSO)");
  console.log("  6. Edit agent-config.json if needed");
  console.log("  7. ./start-agent.sh");
}

main().catch((err) => {
  console.error(`\nBuild failed: ${err.message}`);
  process.exit(1);
});
