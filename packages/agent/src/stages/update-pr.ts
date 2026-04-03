import { join } from "node:path";
import { execFile } from "node:child_process";
import type { StageRunner } from "../pipeline";
import type { BackendApiClient } from "../api-client";
import type { SQSJobMessage } from "@remote-kiro/common";
import type { EventBuffer } from "../event-buffer";

export interface UpdatePrDeps {
  apiClient: BackendApiClient;
  workspaceRoot: string;
  eventBuffer?: EventBuffer;
}

export function createUpdatePrStage(deps: UpdatePrDeps): StageRunner {
  return {
    name: "UPDATING_PR",
    run: async (jobId: string, message: SQSJobMessage): Promise<void> => {
      const repoDir = join(deps.workspaceRoot, message.repoId);
      const commitSha = (await git(["rev-parse", "HEAD"], repoDir)).trim();

      console.log(`[UPDATING_PR] New commit pushed to existing branch: ${commitSha.substring(0, 12)}`);

      await deps.apiClient.updateJobStatus(jobId, {
        status: "RUNNING",
        commitSha,
      });

      if (deps.eventBuffer) {
        await deps.eventBuffer.bufferEvent(jobId, {
          eventType: "log",
          message: `Fix commit pushed to existing PR (${commitSha.substring(0, 8)})`,
          stage: "UPDATING_PR",
          metadata: { commitSha },
        });
      }
    },
  };
}

function git(args: string[], cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args[0]} failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}
