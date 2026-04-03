#!/usr/bin/env node

import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import type { SQSJobMessage, AgentMachineInfo } from "@remote-kiro/common";
import { loadConfig, validatePrerequisites } from "./config";
import { BackendApiClient } from "./api-client";
import { EventBuffer } from "./event-buffer";
import { BundleCache } from "./bundle-cache";
import { HeartbeatLoop } from "./heartbeat";
import { SQSPoller } from "./poller";
import { JobPipeline, type StageRunner } from "./pipeline";
import { KiroAcpClient } from "./kiro-acp-client";
import { SpecPhase } from "@remote-kiro/common";
import { fetchGitCredentials, type GitCredentialConfig } from "./git-credentials";
import {
  createValidateRepoStage,
  createPrepareWorkspaceStage,
  createApplyBundleStage,
  createRunTestsStage,
  createCommitStage,
  createPushStage,
  createCreatePrStage,
  createFinalizeStage,
  createGenerateSpecStage,
  createAwaitApprovalStage,
  createImplementTasksStage,
  createFetchPrStage,
  createPrepareDiffStage,
  createRunReviewStage,
  createPostReviewStage,
  createSetStatusStage,
  createFinalizeReviewStage,
  createUpdatePrStage,
} from "./stages/index";

// ─── Logger ───

function createLogger(logDir: string) {
  mkdirSync(logDir, { recursive: true });
  const agentLogPath = join(logDir, "agent.log");

  function write(level: string, message: string, jobId?: string): void {
    const ts = new Date().toISOString();
    const prefix = jobId ? `[${ts}] [${level}] [job:${jobId}]` : `[${ts}] [${level}]`;
    const line = `${prefix} ${message}\n`;
    console.log(line.trimEnd());
    appendFileSync(agentLogPath, line);
  }

  return {
    info: (msg: string, jobId?: string) => write("INFO", msg, jobId),
    error: (msg: string, jobId?: string) => write("ERROR", msg, jobId),
    warn: (msg: string, jobId?: string) => write("WARN", msg, jobId),
  };
}

function writeJobLog(logDir: string, jobId: string, message: string): void {
  const logPath = join(logDir, `${jobId}.log`);
  const ts = new Date().toISOString();
  appendFileSync(logPath, `[${ts}] ${message}\n`);
}

// ─── Stage Builders ───

function makeKiroClient(agentName?: string): KiroAcpClient {
  const client = new KiroAcpClient();
  if (agentName) client.setAgentName(agentName);
  return client;
}

function buildFeatureStages(
  apiClient: BackendApiClient,
  eventBuffer: EventBuffer,
  bundleCache: BundleCache,
  workspaceRoot: string,
  logDir: string,
  getCredentials: () => GitCredentialConfig | null,
  startFrom?: string,
  agentName?: string,
): StageRunner[] {
  const allStages: StageRunner[] = [
    createValidateRepoStage({ getCredentials }),
    createPrepareWorkspaceStage({ workspaceRoot, getCredentials }),
    createApplyBundleStage({ bundleCache, workspaceRoot }),
    createGenerateSpecStage({
      phase: SpecPhase.REQUIREMENTS,
      kiroAcpClient: makeKiroClient(agentName),
      apiClient,
      eventBuffer,
      workspaceRoot,
    }),
    createAwaitApprovalStage({
      phase: SpecPhase.REQUIREMENTS,
      apiClient,
      eventBuffer,
    }),
    createGenerateSpecStage({
      phase: SpecPhase.DESIGN,
      kiroAcpClient: makeKiroClient(agentName),
      apiClient,
      eventBuffer,
      workspaceRoot,
    }),
    createAwaitApprovalStage({
      phase: SpecPhase.DESIGN,
      apiClient,
      eventBuffer,
    }),
    createGenerateSpecStage({
      phase: SpecPhase.TASKS,
      kiroAcpClient: makeKiroClient(agentName),
      apiClient,
      eventBuffer,
      workspaceRoot,
    }),
    createAwaitApprovalStage({
      phase: SpecPhase.TASKS,
      apiClient,
      eventBuffer,
    }),
    createImplementTasksStage({
      kiroAcpClient: makeKiroClient(agentName),
      apiClient,
      eventBuffer,
      workspaceRoot,
    }),
    createRunTestsStage({ eventBuffer, workspaceRoot }),
    createCommitStage({ workspaceRoot }),
    createPushStage({ workspaceRoot, getCredentials }),
    createCreatePrStage({ apiClient, workspaceRoot, eventBuffer }),
    createFinalizeStage({ apiClient, logDir }),
  ];

  if (startFrom) {
    const idx = allStages.findIndex((s) => s.name === startFrom);
    if (idx > 0) {
      return allStages.slice(idx);
    }
  }

  return allStages;
}

function buildReviewStages(
  apiClient: BackendApiClient,
  eventBuffer: EventBuffer,
  workspaceRoot: string,
  logDir: string,
  getCredentials: () => GitCredentialConfig | null,
  agentName?: string,
): StageRunner[] {
  return [
    createFetchPrStage({ eventBuffer, workspaceRoot, getCredentials }),
    createPrepareDiffStage({ eventBuffer, workspaceRoot }),
    createRunReviewStage({
      kiroAcpClient: makeKiroClient(agentName),
      eventBuffer,
      workspaceRoot,
    }),
    createPostReviewStage({ eventBuffer, workspaceRoot }),
    createSetStatusStage({ eventBuffer, workspaceRoot }),
    createFinalizeReviewStage({ apiClient, eventBuffer, logDir }),
  ];
}

function buildReviewFixStages(
  apiClient: BackendApiClient,
  eventBuffer: EventBuffer,
  bundleCache: BundleCache,
  workspaceRoot: string,
  logDir: string,
  getCredentials: () => GitCredentialConfig | null,
  startFrom?: string,
  agentName?: string,
): StageRunner[] {
  // Review fix skips requirements and design — the review report already
  // provides the context. We only generate tasks (from the review findings)
  // and then implement them.
  const allStages: StageRunner[] = [
    createValidateRepoStage({ getCredentials }),
    createPrepareWorkspaceStage({ workspaceRoot, getCredentials }),
    createApplyBundleStage({ bundleCache, workspaceRoot }),
    createGenerateSpecStage({
      phase: SpecPhase.TASKS,
      kiroAcpClient: makeKiroClient(agentName),
      apiClient,
      eventBuffer,
      workspaceRoot,
    }),
    createAwaitApprovalStage({
      phase: SpecPhase.TASKS,
      apiClient,
      eventBuffer,
    }),
    createImplementTasksStage({
      kiroAcpClient: makeKiroClient(agentName),
      apiClient,
      eventBuffer,
      workspaceRoot,
    }),
    createRunTestsStage({ eventBuffer, workspaceRoot }),
    createCommitStage({ workspaceRoot }),
    createPushStage({ workspaceRoot, getCredentials }),
    createUpdatePrStage({ apiClient, workspaceRoot, eventBuffer }),
    createFinalizeStage({ apiClient, logDir }),
  ];

  if (startFrom) {
    const idx = allStages.findIndex((s) => s.name === startFrom);
    if (idx > 0) {
      return allStages.slice(idx);
    }
  }

  return allStages;
}

// ─── Main ───

async function main(): Promise<void> {
  const configPath = process.argv[2] ?? process.env.AGENT_CONFIG_PATH ?? "agent-config.json";

  // 1. Load and validate config
  const config = loadConfig(configPath);
  const log = createLogger(config.logDir);

  log.info(`Agent starting with config from ${configPath}`);
  log.info(`Machine: ${config.machineLabel} (${config.machineId})`);

  // 2. Validate prerequisites (kiro-cli, git)
  log.info("Validating prerequisites...");
  await validatePrerequisites();
  log.info("Prerequisites validated: kiro-cli and git are available");

  // 3. Create API client
  const apiClient = new BackendApiClient(config.backendApiUrl);

  // 4. Collect machine info and register agent with backend
  log.info("Registering agent with backend...");

  const nets = os.networkInterfaces();
  let ipAddress: string | null = null;
  for (const addrs of Object.values(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        ipAddress = addr.address;
        break;
      }
    }
    if (ipAddress) break;
  }

  const machine: AgentMachineInfo = {
    hostname: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpuCores: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / (1024 ** 3) * 10) / 10,
    nodeVersion: process.version,
    ipAddress,
  };

  const registerResponse = await apiClient.registerAgent({
    machineId: config.machineId,
    machineLabel: config.machineLabel,
    capabilities: config.capabilities,
    repoAllowlist: config.repoAllowlist,
    workspaceRoot: config.workspaceRoot,
    maxConcurrentJobs: config.maxConcurrentJobs,
    agentVersion: "1.0.0",
    machine,
  });
  const agentId = (registerResponse.data as { agentId?: string })?.agentId ?? config.machineId;
  log.info(`Agent registered with ID: ${agentId}`);

  // 5. Create event buffer and bundle cache
  const eventBuffer = new EventBuffer(apiClient);
  const bundleCache = new BundleCache(config.bundleCacheDir);

  // 6. Start heartbeat loop
  const heartbeat = new HeartbeatLoop(apiClient, agentId, config.pollingIntervalMs);
  heartbeat.start();
  log.info(`Heartbeat started (interval: ${config.pollingIntervalMs}ms)`);

  // 7. Create SQS poller (onMessage wired below via pipeline)
  // We use a late-bound reference so the poller and pipeline can reference each other.
  let pipeline: JobPipeline;

  const poller = new SQSPoller({
    sqsQueueUrl: config.sqsQueueUrl,
    pollingIntervalMs: config.pollingIntervalMs,
    maxConcurrentJobs: config.maxConcurrentJobs,
    repoAllowlist: config.repoAllowlist,
    onMessage: async (message: SQSJobMessage, receiptHandle: string) => {
      const { jobId, messageType } = message;
      log.info(`Received job: ${jobId} (type: ${messageType})`, jobId);
      writeJobLog(config.logDir, jobId, `Job received: ${messageType}`);

      // Fetch git credentials once per job
      log.info("Fetching git credentials...", jobId);
      let credConfig: GitCredentialConfig | null = null;
      try {
        credConfig = await fetchGitCredentials(apiClient, jobId);
        if (credConfig) {
          log.info(`Git credential configured: ${credConfig.credentialType}`, jobId);
        } else {
          log.info("No git credentials configured for this repo", jobId);
        }
      } catch (err) {
        log.warn(`Failed to fetch git credentials: ${err instanceof Error ? err.message : String(err)}`, jobId);
      }
      const getCredentials = () => credConfig;

      // Resolve AI Agent config if specified
      const aiAgentId = message.aiAgentId ?? null;
      let agentName: string | undefined;
      if (aiAgentId) {
        try {
          log.info(`Fetching AI agent config: ${aiAgentId}`, jobId);
          const agentResp = await apiClient.getAIAgentConfig(aiAgentId);
          const agentConfig = agentResp.data as import("@remote-kiro/common").AIAgentConfig | undefined;
          if (agentConfig?.kiroConfig) {
            agentName = agentConfig.kiroConfig.name;
            const kiroAgentsDir = join(os.homedir(), ".kiro", "agents");
            mkdirSync(kiroAgentsDir, { recursive: true });
            const agentFilePath = join(kiroAgentsDir, `${agentName}.json`);
            writeFileSync(agentFilePath, JSON.stringify(agentConfig.kiroConfig, null, 2));
            log.info(`AI agent config written to ${agentFilePath} (name: ${agentName})`, jobId);
          }
        } catch (err) {
          log.warn(`Failed to fetch AI agent config: ${err instanceof Error ? err.message : String(err)}`, jobId);
        }
      }

      let stages: StageRunner[];
      if (messageType === "implement_feature") {
        stages = buildFeatureStages(
          apiClient,
          eventBuffer,
          bundleCache,
          config.workspaceRoot,
          config.logDir,
          getCredentials,
          undefined,
          agentName,
        );
      } else if (messageType === "implement_review_fix") {
        stages = buildReviewFixStages(
          apiClient,
          eventBuffer,
          bundleCache,
          config.workspaceRoot,
          config.logDir,
          getCredentials,
          undefined,
          agentName,
        );
      } else if (messageType === "resume_job") {
        const resumeMsg = message as import("@remote-kiro/common").ResumeJobMessage;
        const builder = resumeMsg.jobType === "implement_review_fix" ? buildReviewFixStages : buildFeatureStages;
        stages = builder(
          apiClient,
          eventBuffer,
          bundleCache,
          config.workspaceRoot,
          config.logDir,
          getCredentials,
          resumeMsg.resumeFromPhase,
          agentName,
        );
      } else if (messageType === "review_pr") {
        stages = buildReviewStages(
          apiClient,
          eventBuffer,
          config.workspaceRoot,
          config.logDir,
          getCredentials,
          agentName,
        );
      } else {
        log.warn(`Unknown message type: ${messageType}`, jobId);
        return;
      }

      try {
        await pipeline.run(message, receiptHandle, stages);
        log.info(`Job completed: ${jobId}`, jobId);
        writeJobLog(config.logDir, jobId, "Job completed successfully");
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error(`Job failed: ${jobId} — ${errMsg}`, jobId);
        writeJobLog(config.logDir, jobId, `Job failed: ${errMsg}`);
      }
    },
  });

  // 8. Create pipeline with the poller
  pipeline = new JobPipeline({
    apiClient,
    poller,
    eventBuffer,
    agentId,
    logger: (msg, jobId) => log.info(msg, jobId),
  });

  // 9. Start the poller
  poller.start();
  log.info(`SQS poller started (queue: ${config.sqsQueueUrl})`);
  log.info("Agent is running. Press Ctrl+C to stop.");

  // 10. Graceful shutdown
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info(`Received ${signal}, shutting down gracefully...`);

    poller.stop();
    log.info("SQS poller stopped");

    heartbeat.stop();
    log.info("Heartbeat stopped");

    await eventBuffer.flush();
    log.info("Event buffer flushed");

    log.info("Agent shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ─── Run ───

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[FATAL] Agent failed to start: ${msg}`);
  
  // Show additional details for API errors
  if (err instanceof Error && 'statusCode' in err) {
    const apiErr = err as { statusCode?: number; response?: unknown };
    console.error(`[FATAL] HTTP Status: ${apiErr.statusCode}`);
    if (apiErr.response) {
      console.error(`[FATAL] Response:`, JSON.stringify(apiErr.response, null, 2));
    }
  }
  
  // Show stack trace for debugging
  if (err instanceof Error && err.stack) {
    console.error(`[FATAL] Stack:`, err.stack);
  }
  
  process.exit(1);
});
