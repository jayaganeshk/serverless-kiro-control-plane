import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { EventBuffer } from "../event-buffer";
import type { SQSJobMessage, ImplementFeatureMessage } from "@remote-kiro/common";

export interface RunTestsDeps {
  eventBuffer: EventBuffer;
  workspaceRoot: string;
}

interface BundleManifest {
  validation?: {
    commands?: string[];
  };
}

// ─── Factory ───

export function createRunTestsStage(deps: RunTestsDeps): StageRunner {
  return {
    name: "RUNNING_TESTS",
    run: async (jobId: string, message: SQSJobMessage): Promise<void> => {
      const msg = message as ImplementFeatureMessage;
      const repoDir = join(deps.workspaceRoot, msg.repoId);

      // Read validation commands from bundle manifest
      const commands = await loadValidationCommands(repoDir);

      if (commands.length === 0) {
        await deps.eventBuffer.bufferEvent(jobId, {
          eventType: "log",
          message: "No validation commands defined in bundle manifest, skipping tests",
          stage: "RUNNING_TESTS",
        });
        return;
      }

      for (const cmd of commands) {
        await deps.eventBuffer.bufferEvent(jobId, {
          eventType: "log",
          message: `Running validation: ${cmd}`,
          stage: "RUNNING_TESTS",
        });

        await runShellCommand(cmd, repoDir);
      }
    },
  };
}

// ─── Helpers ───

async function loadValidationCommands(repoDir: string): Promise<string[]> {
  try {
    const manifestPath = join(repoDir, ".kiro", "manifest.json");
    const raw = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as BundleManifest;
    return manifest.validation?.commands ?? [];
  } catch {
    return [];
  }
}

function runShellCommand(cmd: string, cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile("sh", ["-c", cmd], { cwd, timeout: 5 * 60 * 1000 }, (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Validation command failed: ${cmd}\nstdout: ${stdout}\nstderr: ${stderr}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });
  });
}
