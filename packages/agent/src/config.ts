import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";

// ─── Agent Config Interface ───

export interface AgentConfig {
  machineId: string;
  machineLabel: string;
  capabilities: string[];
  repoAllowlist: string[];
  workspaceRoot: string;
  pollingIntervalMs: number;
  maxConcurrentJobs: number;
  bundleCacheDir: string;
  backendApiUrl: string;
  sqsQueueUrl: string;
  logDir: string;
}

// ─── Defaults ───

const DEFAULTS = {
  pollingIntervalMs: 10_000,
  maxConcurrentJobs: 1,
} as const;

// ─── Required fields in the config JSON ───

const REQUIRED_FIELDS: readonly (keyof AgentConfig)[] = [
  "machineId",
  "machineLabel",
  "workspaceRoot",
  "backendApiUrl",
  "sqsQueueUrl",
  "logDir",
  "bundleCacheDir",
];

// ─── loadConfig ───

export function loadConfig(configPath: string): AgentConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config file at ${configPath}: ${msg}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Config file at ${configPath} is not valid JSON`);
  }

  // Validate required fields
  const missing = REQUIRED_FIELDS.filter(
    (f) => parsed[f] === undefined || parsed[f] === null || parsed[f] === "",
  );
  if (missing.length > 0) {
    throw new Error(`Missing required config fields: ${missing.join(", ")}`);
  }

  return {
    machineId: String(parsed.machineId),
    machineLabel: String(parsed.machineLabel),
    capabilities: Array.isArray(parsed.capabilities)
      ? (parsed.capabilities as unknown[]).map(String)
      : [],
    repoAllowlist: Array.isArray(parsed.repoAllowlist)
      ? (parsed.repoAllowlist as unknown[]).map(String)
      : [],
    workspaceRoot: String(parsed.workspaceRoot),
    pollingIntervalMs:
      typeof parsed.pollingIntervalMs === "number"
        ? parsed.pollingIntervalMs
        : DEFAULTS.pollingIntervalMs,
    maxConcurrentJobs:
      typeof parsed.maxConcurrentJobs === "number"
        ? parsed.maxConcurrentJobs
        : DEFAULTS.maxConcurrentJobs,
    bundleCacheDir: String(parsed.bundleCacheDir),
    backendApiUrl: String(parsed.backendApiUrl),
    sqsQueueUrl: String(parsed.sqsQueueUrl),
    logDir: String(parsed.logDir),
  };
}

// ─── validatePrerequisites ───

/**
 * Validates that `kiro-cli` and `git` are available on PATH.
 * Spawns `kiro-cli acp` and verifies it starts, then kills it.
 * Spawns `git --version` and verifies it exits cleanly.
 * Throws if either prerequisite is missing.
 */
export async function validatePrerequisites(): Promise<void> {
  await validateKiroCli();
  await validateGit();
}

function validateKiroCli(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = execFile("kiro-cli", ["acp"], (error) => {
      // We expect the process to be killed by us, so SIGTERM errors are fine.
      // If we get an ENOENT, kiro-cli is not on PATH.
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "kiro-cli is not installed or not on PATH. Please install kiro-cli and ensure it is accessible.",
          ),
        );
      }
      // Any other error after kill is expected — we resolve.
    });

    // Give it a short window to start, then kill it.
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve();
    }, 2000);

    child.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "kiro-cli is not installed or not on PATH. Please install kiro-cli and ensure it is accessible.",
          ),
        );
      } else {
        reject(new Error(`Failed to spawn kiro-cli acp: ${err.message}`));
      }
    });

    // If the process exits on its own before the timer, that's also fine
    // (it started successfully).
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function validateGit(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile("git", ["--version"], (error, stdout) => {
      if (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(
            new Error(
              "git is not installed or not on PATH. Please install Git and ensure it is accessible.",
            ),
          );
        } else {
          reject(new Error(`Failed to run git --version: ${error.message}`));
        }
        return;
      }
      if (!stdout.includes("git version")) {
        reject(new Error("Unexpected output from git --version"));
        return;
      }
      resolve();
    });
  });
}
