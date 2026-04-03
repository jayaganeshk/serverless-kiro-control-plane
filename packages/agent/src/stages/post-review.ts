import { request } from "node:https";
import { execFile } from "node:child_process";
import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { EventBuffer } from "../event-buffer";
import type { SQSJobMessage, ReviewPRMessage } from "@remote-kiro/common";
import { lastReviewResult } from "./run-review";
import type { ReviewResult, ReviewFinding } from "./run-review";

export interface PostReviewDeps {
  eventBuffer: EventBuffer;
  workspaceRoot: string;
}

type RepoProvider =
  | { type: "github"; owner: string; repo: string }
  | { type: "codecommit"; region: string; repoName: string }
  | { type: "unknown" };

interface GitHubReviewComment {
  path: string;
  line: number;
  body: string;
}

// ─── Factory ───

export function createPostReviewStage(deps: PostReviewDeps): StageRunner {
  return {
    name: "POSTING_REVIEW",
    run: async (jobId: string, message: SQSJobMessage): Promise<void> => {
      const msg = message as ReviewPRMessage;
      const review = lastReviewResult;

      if (!review) {
        throw new Error("No review result available from RUNNING_REVIEW stage");
      }

      const provider = detectProvider(msg.repoUrl);
      const comments = buildComments(review.findings);
      const body = buildReviewBody(review);
      const repoDir = join(deps.workspaceRoot, msg.repoId);

      switch (provider.type) {
        case "github": {
          const token = process.env.GITHUB_TOKEN;
          if (!token) throw new Error("GITHUB_TOKEN not set");
          const event = mapOutcomeToEvent(review.outcome);
          await postGitHubReview(token, provider.owner, provider.repo, msg.prNumber, { body, event, comments });
          break;
        }
        case "codecommit": {
          await postCodeCommitReview(provider.region, provider.repoName, msg.prNumber, body, review, repoDir, msg.baseBranch, msg.workBranch);
          break;
        }
        default: {
          console.log(`[POSTING_REVIEW] Unsupported provider — storing review as event only`);
          break;
        }
      }

      await deps.eventBuffer.bufferEvent(jobId, {
        eventType: "log",
        message: `Posted review to PR #${msg.prNumber}: ${review.outcome} with ${comments.length} inline comments`,
        stage: "POSTING_REVIEW",
        metadata: {
          prNumber: msg.prNumber,
          outcome: review.outcome,
          commentCount: comments.length,
          reviewSummary: review.summary,
        },
      });
    },
  };
}

// ─── Provider Detection ───

function detectProvider(repoUrl: string): RepoProvider {
  const ghMatch = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/);
  if (ghMatch) return { type: "github", owner: ghMatch[1], repo: ghMatch[2] };

  const ccMatch = repoUrl.match(/git-codecommit\.([^.]+)\.amazonaws\.com.*\/v1\/repos\/([^/\s]+)/);
  if (ccMatch) return { type: "codecommit", region: ccMatch[1], repoName: ccMatch[2] };

  return { type: "unknown" };
}

// ─── GitHub Review ───

function mapOutcomeToEvent(outcome: ReviewResult["outcome"]): "APPROVE" | "REQUEST_CHANGES" | "COMMENT" {
  return outcome;
}

function buildComments(findings: ReviewFinding[]): GitHubReviewComment[] {
  return findings
    .filter((f) => f.file && f.line > 0)
    .map((f) => {
      let body = `**[${f.severity.toUpperCase()}]** ${f.message}`;
      if (f.suggestion) body += `\n\n**Suggestion:** ${f.suggestion}`;
      return { path: f.file, line: f.line, body };
    });
}

function buildReviewBody(review: ReviewResult): string {
  const parts = ["## Kiro Code Review", "", review.summary, ""];
  if (review.findings.length > 0) {
    const critical = review.findings.filter((f) => f.severity === "critical").length;
    const warnings = review.findings.filter((f) => f.severity === "warning").length;
    const suggestions = review.findings.filter((f) => f.severity === "suggestion").length;
    const info = review.findings.filter((f) => f.severity === "info").length;

    parts.push("### Summary", "");
    if (critical > 0) parts.push(`- **Critical:** ${critical}`);
    if (warnings > 0) parts.push(`- **Warnings:** ${warnings}`);
    if (suggestions > 0) parts.push(`- **Suggestions:** ${suggestions}`);
    if (info > 0) parts.push(`- **Info:** ${info}`);
  }
  return parts.join("\n");
}

function postGitHubReview(
  token: string, owner: string, repo: string, prNumber: number,
  data: { body: string; event: string; comments: GitHubReviewComment[] },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = request(
      {
        hostname: "api.github.com",
        path: `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
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
            reject(new Error(`GitHub review post failed (HTTP ${res.statusCode}): ${body}`));
          }
        });
      },
    );
    req.on("error", (err) => reject(new Error(`GitHub review request failed: ${err.message}`)));
    req.write(payload);
    req.end();
  });
}

// ─── CodeCommit Review ───

async function postCodeCommitReview(
  region: string, repoName: string, prNumber: number,
  reviewBody: string, review: ReviewResult,
  repoDir: string, baseBranch: string, workBranch: string,
): Promise<void> {
  console.log(`[POSTING_REVIEW] Posting CodeCommit review comment on PR #${prNumber}`);

  const beforeCommitId = (await git(["rev-parse", `origin/${baseBranch}`], repoDir)).trim();
  const afterCommitId = (await git(["rev-parse", `origin/${workBranch}`], repoDir)).trim();

  try {
    await awsCli([
      "codecommit", "post-comment-for-pull-request",
      "--pull-request-id", String(prNumber),
      "--repository-name", repoName,
      "--before-commit-id", beforeCommitId,
      "--after-commit-id", afterCommitId,
      "--content", reviewBody,
      "--region", region,
      "--output", "json",
    ]);
    console.log(`[POSTING_REVIEW] CodeCommit review comment posted`);
  } catch (err: any) {
    console.log(`[POSTING_REVIEW] CodeCommit comment failed (${err.message}), trying approval...`);
  }

  if (review.outcome === "APPROVE") {
    try {
      const revisionId = await getLatestRevisionId(region, prNumber);
      if (revisionId) {
        await awsCli([
          "codecommit", "update-pull-request-approval-state",
          "--pull-request-id", String(prNumber),
          "--revision-id", revisionId,
          "--approval-state", "APPROVE",
          "--region", region,
        ]);
        console.log(`[POSTING_REVIEW] CodeCommit PR approved`);
      }
    } catch (err: any) {
      console.log(`[POSTING_REVIEW] CodeCommit approval failed: ${err.message}`);
    }
  }
}

async function getLatestRevisionId(region: string, prNumber: number): Promise<string | null> {
  try {
    const result = await awsCli([
      "codecommit", "get-pull-request",
      "--pull-request-id", String(prNumber),
      "--region", region,
      "--output", "json",
    ]);
    const parsed = JSON.parse(result);
    return parsed?.pullRequest?.revisionId ?? null;
  } catch {
    return null;
  }
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

function awsCli(args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile("aws", args, { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`aws ${args.slice(0, 3).join(" ")} failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}
