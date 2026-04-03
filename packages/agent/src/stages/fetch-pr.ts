import { request } from "node:https";
import { execFile, type ExecFileOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { EventBuffer } from "../event-buffer";
import type { GitCredentialConfig } from "../git-credentials";
import type { SQSJobMessage, ReviewPRMessage } from "@remote-kiro/common";

export interface FetchPrDeps {
  eventBuffer: EventBuffer;
  workspaceRoot: string;
  getCredentials: () => GitCredentialConfig | null;
}

export interface PrMetadata {
  headSha: string;
  title: string;
  body: string;
  user: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

type RepoProvider =
  | { type: "github"; owner: string; repo: string }
  | { type: "codecommit"; region: string; repoName: string }
  | { type: "unknown" };

// ─── Factory ───

export function createFetchPrStage(deps: FetchPrDeps): StageRunner {
  return {
    name: "FETCHING_PR",
    run: async (jobId: string, message: SQSJobMessage): Promise<void> => {
      const msg = message as ReviewPRMessage;
      const repoDir = join(deps.workspaceRoot, msg.repoId);
      const { repoUrl, baseBranch, workBranch } = msg;

      const creds = deps.getCredentials();
      const cloneUrl = creds?.rewriteUrl ? creds.rewriteUrl(repoUrl) : repoUrl;
      const gitOpts: ExecFileOptions = { maxBuffer: 5 * 1024 * 1024 };
      if (creds?.env && Object.keys(creds.env).length > 0) {
        gitOpts.env = { ...process.env, ...creds.env, GIT_TERMINAL_PROMPT: "0" };
      } else {
        gitOpts.env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
      }

      if (!existsSync(join(repoDir, ".git"))) {
        await git(["clone", cloneUrl, repoDir], undefined, gitOpts);
      }

      await git(["fetch", "--all"], repoDir, gitOpts);
      await git(["checkout", baseBranch], repoDir, gitOpts);
      await git(["reset", "--hard", `origin/${baseBranch}`], repoDir, gitOpts);
      await git(["checkout", workBranch], repoDir, gitOpts);
      await git(["reset", "--hard", `origin/${workBranch}`], repoDir, gitOpts);

      const provider = detectProvider(repoUrl);
      let prMeta: PrMetadata;

      switch (provider.type) {
        case "github": {
          const token = process.env.GITHUB_TOKEN;
          if (!token) throw new Error("GITHUB_TOKEN not set");
          prMeta = await fetchGitHubPrMetadata(token, provider.owner, provider.repo, msg.prNumber);
          break;
        }
        case "codecommit": {
          prMeta = await fetchCodeCommitPrMetadata(provider.region, provider.repoName, msg.prNumber, repoDir, baseBranch, workBranch);
          break;
        }
        default: {
          const diffStat = await git(["diff", "--stat", `${baseBranch}...${workBranch}`], repoDir, gitOpts);
          const changedCount = (await git(["diff", "--name-only", `${baseBranch}...${workBranch}`], repoDir, gitOpts)).trim().split("\n").filter(Boolean).length;
          prMeta = {
            headSha: (await git(["rev-parse", "HEAD"], repoDir, gitOpts)).trim(),
            title: `PR #${msg.prNumber}`,
            body: "",
            user: "unknown",
            additions: 0,
            deletions: 0,
            changedFiles: changedCount,
          };
          break;
        }
      }

      await deps.eventBuffer.bufferEvent(jobId, {
        eventType: "log",
        message: `Fetched PR #${msg.prNumber}: "${prMeta.title}" (+${prMeta.additions}/-${prMeta.deletions}, ${prMeta.changedFiles} files)`,
        stage: "FETCHING_PR",
        metadata: {
          prNumber: msg.prNumber,
          headSha: prMeta.headSha,
          additions: prMeta.additions,
          deletions: prMeta.deletions,
          changedFiles: prMeta.changedFiles,
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

// ─── GitHub PR Metadata ───

function fetchGitHubPrMetadata(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PrMetadata> {
  return new Promise<PrMetadata>((resolve, reject) => {
    const req = request(
      {
        hostname: "api.github.com",
        path: `/repos/${owner}/${repo}/pulls/${prNumber}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "remote-kiro-agent/1.0",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: string) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const data = JSON.parse(body) as Record<string, unknown>;
              const head = data.head as Record<string, unknown> | undefined;
              const user = data.user as Record<string, unknown> | undefined;
              resolve({
                headSha: String(head?.sha ?? ""),
                title: String(data.title ?? ""),
                body: String(data.body ?? ""),
                user: String(user?.login ?? ""),
                additions: Number(data.additions ?? 0),
                deletions: Number(data.deletions ?? 0),
                changedFiles: Number(data.changed_files ?? 0),
              });
            } catch {
              reject(new Error(`Failed to parse GitHub PR response: ${body}`));
            }
          } else {
            reject(new Error(`GitHub PR fetch failed (HTTP ${res.statusCode}): ${body}`));
          }
        });
      },
    );
    req.on("error", (err) => reject(new Error(`GitHub PR request failed: ${err.message}`)));
    req.end();
  });
}

// ─── CodeCommit PR Metadata ───

async function fetchCodeCommitPrMetadata(
  region: string,
  repoName: string,
  prNumber: number,
  repoDir: string,
  baseBranch: string,
  workBranch: string,
): Promise<PrMetadata> {
  console.log(`[FETCHING_PR] Fetching CodeCommit PR #${prNumber} from ${repoName}`);

  let title = `PR #${prNumber}`;
  let body = "";
  let user = "codecommit";

  try {
    const result = await awsCli([
      "codecommit", "get-pull-request",
      "--pull-request-id", String(prNumber),
      "--region", region,
      "--output", "json",
    ]);
    const parsed = JSON.parse(result);
    const pr = parsed?.pullRequest;
    if (pr) {
      title = pr.title ?? title;
      body = pr.description ?? "";
      user = pr.authorArn?.split("/").pop() ?? "codecommit";
    }
  } catch (err: any) {
    console.log(`[FETCHING_PR] Could not fetch PR details: ${err.message}`);
  }

  const headSha = (await git(["rev-parse", "HEAD"], repoDir)).trim();

  let additions = 0;
  let deletions = 0;
  let changedFiles = 0;
  try {
    const numstat = await git(["diff", "--numstat", `${baseBranch}...${workBranch}`], repoDir);
    for (const line of numstat.trim().split("\n").filter(Boolean)) {
      const [add, del] = line.split("\t");
      additions += parseInt(add, 10) || 0;
      deletions += parseInt(del, 10) || 0;
      changedFiles++;
    }
  } catch { /* ignore */ }

  console.log(`[FETCHING_PR] CodeCommit PR: "${title}" (+${additions}/-${deletions}, ${changedFiles} files)`);
  return { headSha, title, body, user, additions, deletions, changedFiles };
}

// ─── Helpers ───

function git(args: string[], cwd?: string, opts?: ExecFileOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const options: ExecFileOptions = { ...opts, maxBuffer: 5 * 1024 * 1024 };
    if (cwd) options.cwd = cwd;
    execFile("git", args, options, (error, stdout, stderr) => {
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
