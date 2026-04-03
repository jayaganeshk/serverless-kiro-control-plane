import { request } from "node:https";
import { execFile } from "node:child_process";
import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { EventBuffer } from "../event-buffer";
import type { SQSJobMessage, ReviewPRMessage } from "@remote-kiro/common";
import { lastReviewResult } from "./run-review";

export interface SetStatusDeps {
  eventBuffer: EventBuffer;
  workspaceRoot: string;
}

type RepoProvider =
  | { type: "github"; owner: string; repo: string }
  | { type: "codecommit" }
  | { type: "unknown" };

export function createSetStatusStage(deps: SetStatusDeps): StageRunner {
  return {
    name: "SETTING_STATUS",
    run: async (jobId: string, message: SQSJobMessage): Promise<void> => {
      const msg = message as ReviewPRMessage;
      const repoDir = join(deps.workspaceRoot, msg.repoId);
      const provider = detectProvider(msg.repoUrl);
      const review = lastReviewResult;
      const description = review
        ? `Review: ${review.outcome} (${review.findings.length} findings)`
        : "Review completed";

      if (provider.type === "github") {
        const token = process.env.GITHUB_TOKEN;
        if (!token) throw new Error("GITHUB_TOKEN not set");

        const commitSha = (await git(["rev-parse", `origin/${msg.workBranch}`], repoDir)).trim();
        const state = mapOutcomeToState(review?.outcome);

        await setGitHubCommitStatus(token, provider.owner, provider.repo, commitSha, {
          state,
          description,
          context: "kiro-review",
          target_url: msg.prUrl,
        });

        await deps.eventBuffer.bufferEvent(jobId, {
          eventType: "log",
          message: `Set commit status "${state}" on ${commitSha.slice(0, 7)} with context kiro-review`,
          stage: "SETTING_STATUS",
          metadata: { commitSha, state, context: "kiro-review" },
        });
      } else {
        await deps.eventBuffer.bufferEvent(jobId, {
          eventType: "log",
          message: `Skipping commit status for non-GitHub provider. ${description}`,
          stage: "SETTING_STATUS",
          metadata: { provider: provider.type, outcome: review?.outcome ?? "unknown" },
        });
      }
    },
  };
}

// ─── Helpers ───

function detectProvider(repoUrl: string): RepoProvider {
  const ghMatch = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/);
  if (ghMatch) return { type: "github", owner: ghMatch[1], repo: ghMatch[2] };
  if (repoUrl.includes("codecommit")) return { type: "codecommit" };
  return { type: "unknown" };
}

function mapOutcomeToState(outcome: string | undefined): "success" | "failure" | "pending" {
  switch (outcome) {
    case "APPROVE": return "success";
    case "REQUEST_CHANGES": return "failure";
    default: return "pending";
  }
}

function setGitHubCommitStatus(
  token: string, owner: string, repo: string, sha: string,
  data: { state: string; description: string; context: string; target_url: string },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = request(
      {
        hostname: "api.github.com",
        path: `/repos/${owner}/${repo}/statuses/${sha}`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "remote-kiro-agent/1.0",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: string) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`GitHub commit status failed (HTTP ${res.statusCode}): ${body}`));
          }
        });
      },
    );
    req.on("error", (err) => reject(new Error(`GitHub status request failed: ${err.message}`)));
    req.write(payload);
    req.end();
  });
}

function git(args: string[], cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args[0]} failed: ${String(stderr) || error.message}`));
        return;
      }
      resolve(String(stdout));
    });
  });
}
