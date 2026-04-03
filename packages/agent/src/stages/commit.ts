import { execFile } from "node:child_process";
import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { SQSJobMessage } from "@remote-kiro/common";

export interface CommitDeps {
  workspaceRoot: string;
}

// ─── Factory ───

export function createCommitStage(deps: CommitDeps): StageRunner {
  return {
    name: "COMMITTING",
    run: async (_jobId: string, message: SQSJobMessage): Promise<void> => {
      const repoDir = join(deps.workspaceRoot, message.repoId);
      const { workBranch } = message;

      const currentBranch = (await git(["branch", "--show-current"], repoDir)).trim();
      if (currentBranch !== workBranch) {
        console.log(`[COMMITTING] Branch drift detected: on '${currentBranch}', expected '${workBranch}'. Switching...`);
        await git(["stash", "--include-untracked"], repoDir);
        await git(["checkout", "-B", workBranch], repoDir);
        try { await git(["stash", "pop"], repoDir); } catch { /* stash may be empty */ }
      }

      await git(["add", "-A"], repoDir);

      const status = await git(["status", "--porcelain"], repoDir);
      if (!status.trim()) {
        throw new Error("No changes to commit after Kiro execution");
      }

      const commitMsg = await buildCommitMessage(message, repoDir);
      await git(["commit", "-m", commitMsg], repoDir);
    },
  };
}

// ─── Commit Message Builder ───

async function buildCommitMessage(message: SQSJobMessage, repoDir: string): Promise<string> {
  const isFixJob = message.messageType === "implement_review_fix";
  const title = ('title' in message && message.title) || message.jobId;

  const prefix = isFixJob ? "fix" : "feat";
  const subject = sanitiseSubject(`${prefix}: ${title}`);

  const fileSummaries = await summariseStagedFiles(repoDir);

  const lines: string[] = [subject, ""];
  if (fileSummaries.length > 0) {
    lines.push("Changes:");
    for (const s of fileSummaries) {
      lines.push(`  - ${s}`);
    }
    lines.push("");
  }
  lines.push(`Job: ${message.jobId}`);

  return lines.join("\n");
}

function sanitiseSubject(raw: string): string {
  const oneLine = raw.replace(/\r?\n/g, " ").trim();
  return oneLine.length <= 72 ? oneLine : oneLine.slice(0, 69) + "...";
}

async function summariseStagedFiles(repoDir: string): Promise<string[]> {
  const diffStat = await git(["diff", "--cached", "--stat", "--stat-width=200"], repoDir);
  const nameStatus = await git(["diff", "--cached", "--name-status"], repoDir);

  const statusMap = new Map<string, string>();
  for (const line of nameStatus.trim().split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length >= 2) {
      const code = parts[0].charAt(0);
      const file = parts[parts.length - 1];
      statusMap.set(file, code);
    }
  }

  const summaries: string[] = [];
  for (const line of diffStat.trim().split("\n")) {
    const match = line.match(/^\s*(.+?)\s+\|\s+(\d+)\s+([+-]+)/);
    if (!match) continue;
    const file = match[1].trim();
    const changes = match[2];
    const plusMinus = match[3];
    const adds = (plusMinus.match(/\+/g) || []).length;
    const dels = (plusMinus.match(/-/g) || []).length;
    const code = statusMap.get(file) ?? "M";

    const verb = code === "A" ? "Add" : code === "D" ? "Delete" : "Update";
    const stats = `+${adds}/-${dels}`;
    summaries.push(`${verb} ${file} (${stats}, ${changes} lines changed)`);
  }

  const MAX_ENTRIES = 15;
  if (summaries.length > MAX_ENTRIES) {
    const shown = summaries.slice(0, MAX_ENTRIES);
    shown.push(`... and ${summaries.length - MAX_ENTRIES} more files`);
    return shown;
  }
  return summaries;
}

// ─── Helpers ───

function git(args: string[], cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(`git ${args[0]} failed: ${stderr || error.message}`),
        );
        return;
      }
      resolve(stdout);
    });
  });
}
