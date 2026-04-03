import { request } from "node:https";
import { join } from "node:path";
import { execFile } from "node:child_process";
import type { StageRunner } from "../pipeline";
import type { BackendApiClient } from "../api-client";
import type { SQSJobMessage, ImplementFeatureMessage } from "@remote-kiro/common";
import { SpecPhase } from "@remote-kiro/common";
import { KiroAcpClient } from "../kiro-acp-client";
import type { EventBuffer } from "../event-buffer";

export interface CreatePrDeps {
  apiClient: BackendApiClient;
  workspaceRoot: string;
  eventBuffer?: EventBuffer;
}

interface PrResult {
  prId: string;
  prUrl: string;
}

interface PrContent {
  title: string;
  body: string;
}

// ─── Factory ───

export function createCreatePrStage(deps: CreatePrDeps): StageRunner {
  return {
    name: "CREATING_PR",
    run: async (jobId: string, message: SQSJobMessage): Promise<void> => {
      const msg = message as ImplementFeatureMessage;
      const repoDir = join(deps.workspaceRoot, msg.repoId);
      const commitSha = (await git(["rev-parse", "HEAD"], repoDir)).trim();

      // Gather context for PR description generation
      const prContent = await generatePrContent(deps, jobId, msg, repoDir);

      const provider = detectProvider(msg.repoUrl);
      let pr: PrResult | null = null;

      switch (provider.type) {
        case "github":
          pr = await createGitHubPr(msg, provider, prContent);
          break;
        case "codecommit":
          pr = await createCodeCommitPr(msg, provider, prContent);
          break;
        default:
          console.log(`[CREATING_PR] Unsupported provider for ${msg.repoUrl} — skipping PR creation`);
          break;
      }

      if (pr) {
        await deps.apiClient.updateJobStatus(jobId, {
          status: "RUNNING",
          prNumber: Number(pr.prId) || undefined,
          prUrl: pr.prUrl,
          commitSha,
        });
        if (deps.eventBuffer) {
          await deps.eventBuffer.bufferEvent(jobId, {
            eventType: "log",
            message: `PR created: ${pr.prUrl}`,
            stage: "CREATING_PR",
            metadata: { prId: pr.prId, prUrl: pr.prUrl, commitSha },
          });
        }
      }
    },
  };
}

// ─── PR Content Generation ───

async function generatePrContent(
  deps: CreatePrDeps,
  jobId: string,
  msg: ImplementFeatureMessage,
  repoDir: string,
): Promise<PrContent> {
  console.log(`[CREATING_PR] Generating PR description via Kiro...`);

  // 1. Fetch the approved spec
  let specContext = "";
  try {
    const specResp = await deps.apiClient.getSpec(jobId);
    const spec = specResp.data as any;

    const requirements = spec?.phases?.[SpecPhase.REQUIREMENTS]?.items ?? [];
    const design = spec?.phases?.[SpecPhase.DESIGN]?.items ?? [];
    const tasks = spec?.phases?.[SpecPhase.TASKS]?.items ?? [];

    if (requirements.length > 0) {
      specContext += "\n## Approved Requirements\n";
      for (const r of requirements) {
        specContext += `### ${r.id}\n${r.content}\n\n`;
      }
    }

    if (design.length > 0) {
      specContext += "\n## Approved Design\n";
      for (const d of design) {
        specContext += `${d.content}\n\n`;
      }
    }

    if (tasks.length > 0) {
      specContext += "\n## Implementation Tasks\n";
      for (const t of tasks) {
        const status = t.taskStatus ?? "completed";
        specContext += `- [${status === "completed" ? "x" : " "}] **${t.id}**: ${t.content.split("\n")[0]}\n`;
      }
    }
  } catch (err: any) {
    console.log(`[CREATING_PR] Could not fetch spec: ${err.message}`);
  }

  // 2. Get the diff summary
  let diffSummary = "";
  try {
    const diffStat = await git(["diff", "--stat", msg.baseBranch + "..." + "HEAD"], repoDir);
    diffSummary = diffStat.trim();
  } catch {
    try {
      const diffStat = await git(["diff", "--stat", "HEAD~1"], repoDir);
      diffSummary = diffStat.trim();
    } catch { /* ignore */ }
  }

  // 3. Get list of changed files
  let changedFiles = "";
  try {
    changedFiles = (await git(["diff", "--name-only", msg.baseBranch + "..." + "HEAD"], repoDir)).trim();
  } catch {
    try {
      changedFiles = (await git(["diff", "--name-only", "HEAD~1"], repoDir)).trim();
    } catch { /* ignore */ }
  }

  // 4. Use Kiro ACP to generate the description
  const prompt = buildPrDescriptionPrompt(msg, specContext, diffSummary, changedFiles);

  try {
    const client = new KiroAcpClient();
    client.spawn();
    await client.initialize({ name: "remote-kiro-agent", version: "1.0.0" });
    const sessionId = await client.createSession(repoDir);

    const result = await client.sendPrompt(sessionId, prompt, 2 * 60 * 1000);
    client.destroy();

    const generated = parsePrOutput(result.transcript);
    console.log(`[CREATING_PR] PR description generated (title: ${generated.title.length} chars, body: ${generated.body.length} chars)`);
    return generated;
  } catch (err: any) {
    console.log(`[CREATING_PR] Kiro PR generation failed: ${err.message} — using fallback`);
    return buildFallbackContent(msg, specContext, diffSummary, changedFiles);
  }
}

function buildPrDescriptionPrompt(
  msg: ImplementFeatureMessage,
  specContext: string,
  diffSummary: string,
  changedFiles: string,
): string {
  return `You are generating a pull request title and description for a code change.
Write a clear, professional PR that summarizes what was built and why.

FEATURE REQUEST: ${msg.description ?? msg.title ?? `Job ${msg.jobId}`}
${msg.constraints ? `CONSTRAINTS: ${msg.constraints}` : ""}

${specContext}

## Files Changed
${changedFiles || "(no diff available)"}

## Diff Summary
${diffSummary || "(no diff available)"}

---

Generate the PR title and body in the EXACT format below. Do NOT wrap in code fences.

PR_TITLE: <a concise, descriptive title starting with feat:, fix:, or chore:>

PR_BODY:
## Summary
<2-4 sentences describing what this PR does and the motivation behind it>

## What Changed
<bulleted list of the key changes, grouped by area>

## Requirements Covered
<list the requirement IDs and a one-liner for each>

## Tasks Completed
<list the task IDs and what each accomplished>

## Testing Notes
<brief notes on how to verify the changes>
`;
}

function parsePrOutput(transcript: string): PrContent {
  const titleMatch = transcript.match(/PR_TITLE:\s*(.+?)(?:\n|$)/);
  const bodyMatch = transcript.match(/PR_BODY:\s*\n([\s\S]+)/);

  const title = titleMatch?.[1]?.trim() || "";
  const body = bodyMatch?.[1]?.trim() || "";

  if (!title || !body) {
    throw new Error("Could not parse PR_TITLE/PR_BODY from Kiro output");
  }

  return { title, body };
}

function buildFallbackContent(
  msg: ImplementFeatureMessage,
  specContext: string,
  diffSummary: string,
  changedFiles: string,
): PrContent {
  const desc = msg.description ?? msg.title ?? `Job ${msg.jobId}`;
  const title = `feat: ${desc.slice(0, 72)}`;

  const bodyParts: string[] = [
    `## Summary`,
    ``,
    desc,
    ``,
    `**Job ID:** \`${msg.jobId}\``,
    `**Branch:** \`${msg.workBranch}\` → \`${msg.baseBranch}\``,
  ];

  if (msg.constraints) {
    bodyParts.push(``, `**Constraints:** ${msg.constraints}`);
  }

  if (changedFiles) {
    bodyParts.push(``, `## Files Changed`, ``, changedFiles.split("\n").map(f => `- \`${f}\``).join("\n"));
  }

  if (diffSummary) {
    bodyParts.push(``, `## Diff Summary`, ``, "```", diffSummary, "```");
  }

  if (specContext) {
    bodyParts.push(``, `---`, ``, `<details><summary>Full Specification</summary>`, ``, specContext, ``, `</details>`);
  }

  return { title, body: bodyParts.join("\n") };
}

// ─── Provider Detection ───

type RepoProvider =
  | { type: "github"; owner: string; repo: string }
  | { type: "codecommit"; region: string; repoName: string }
  | { type: "unknown" };

function detectProvider(repoUrl: string): RepoProvider {
  const ghHttps = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/);
  if (ghHttps) return { type: "github", owner: ghHttps[1], repo: ghHttps[2] };

  const ghSsh = repoUrl.match(/github\.com:([^/]+)\/([^/.]+)(?:\.git)?/);
  if (ghSsh) return { type: "github", owner: ghSsh[1], repo: ghSsh[2] };

  const ccHttps = repoUrl.match(/git-codecommit\.([^.]+)\.amazonaws\.com\/v1\/repos\/([^/\s]+)/);
  if (ccHttps) return { type: "codecommit", region: ccHttps[1], repoName: ccHttps[2] };

  const ccSsh = repoUrl.match(/git-codecommit\.([^.]+)\.amazonaws\.com.*\/v1\/repos\/([^/\s]+)/);
  if (ccSsh) return { type: "codecommit", region: ccSsh[1], repoName: ccSsh[2] };

  return { type: "unknown" };
}

// ─── GitHub PR ───

async function createGitHubPr(
  msg: ImplementFeatureMessage,
  provider: { type: "github"; owner: string; repo: string },
  content: PrContent,
): Promise<PrResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is not set. Cannot create GitHub PR.");
  }

  const payload = JSON.stringify({
    title: content.title,
    body: content.body,
    head: msg.workBranch,
    base: msg.baseBranch,
  });

  const result = await new Promise<{ number: number; html_url: string }>((resolve, reject) => {
    const req = request(
      {
        hostname: "api.github.com",
        path: `/repos/${provider.owner}/${provider.repo}/pulls`,
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
        let resBody = "";
        res.on("data", (chunk: string) => { resBody += chunk; });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(resBody)); } catch { reject(new Error(`Bad GitHub response: ${resBody}`)); }
          } else {
            reject(new Error(`GitHub PR failed (HTTP ${res.statusCode}): ${resBody}`));
          }
        });
      },
    );
    req.on("error", (err) => reject(new Error(`GitHub PR request failed: ${err.message}`)));
    req.write(payload);
    req.end();
  });

  return { prId: String(result.number), prUrl: result.html_url };
}

// ─── CodeCommit PR ───

async function createCodeCommitPr(
  msg: ImplementFeatureMessage,
  provider: { type: "codecommit"; region: string; repoName: string },
  content: PrContent,
): Promise<PrResult> {
  console.log(`[CREATING_PR] Creating CodeCommit PR: ${provider.repoName} ${msg.workBranch} → ${msg.baseBranch}`);

  const args = [
    "codecommit", "create-pull-request",
    "--title", content.title,
    "--description", content.body,
    "--targets", JSON.stringify([{
      repositoryName: provider.repoName,
      sourceReference: msg.workBranch,
      destinationReference: msg.baseBranch,
    }]),
    "--region", provider.region,
    "--output", "json",
  ];

  const result = await awsCli(args);
  const parsed = JSON.parse(result);
  const prId = parsed?.pullRequest?.pullRequestId ?? "unknown";
  const prUrl = `https://${provider.region}.console.aws.amazon.com/codesuite/codecommit/repositories/${provider.repoName}/pull-requests/${prId}`;

  console.log(`[CREATING_PR] CodeCommit PR created: #${prId} → ${prUrl}`);
  return { prId, prUrl };
}

// ─── Helpers ───

function git(args: string[], cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args[0]} failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
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
