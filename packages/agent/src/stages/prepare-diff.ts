import { execFile } from "node:child_process";
import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { EventBuffer } from "../event-buffer";
import type { SQSJobMessage, ReviewPRMessage } from "@remote-kiro/common";

export interface PrepareDiffDeps {
  eventBuffer: EventBuffer;
  workspaceRoot: string;
}

/** Stored diff result accessible by downstream stages via shared context. */
export let lastDiff = "";

// ─── Factory ───

export function createPrepareDiffStage(deps: PrepareDiffDeps): StageRunner {
  return {
    name: "PREPARING_DIFF",
    run: async (jobId: string, message: SQSJobMessage): Promise<void> => {
      const msg = message as ReviewPRMessage;
      const repoDir = join(deps.workspaceRoot, msg.repoId);

      // Generate diff between base branch and PR branch
      const diff = await git(
        ["diff", `origin/${msg.baseBranch}...origin/${msg.workBranch}`],
        repoDir,
      );

      if (!diff.trim()) {
        throw new Error(
          `No diff found between ${msg.baseBranch} and ${msg.workBranch}`,
        );
      }

      // Store diff for downstream stages
      lastDiff = diff;

      const lineCount = diff.split("\n").length;

      await deps.eventBuffer.bufferEvent(jobId, {
        eventType: "log",
        message: `Generated diff: ${lineCount} lines between ${msg.baseBranch} and ${msg.workBranch}`,
        stage: "PREPARING_DIFF",
        metadata: {
          baseBranch: msg.baseBranch,
          workBranch: msg.workBranch,
          diffLineCount: lineCount,
        },
      });
    },
  };
}

// ─── Helpers ───

function git(args: string[], cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(`git ${args[0]} failed: ${stderr || error.message}`),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}
