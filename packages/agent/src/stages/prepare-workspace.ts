import { execFile, type ExecFileOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { SQSJobMessage } from "@remote-kiro/common";
import type { GitCredentialConfig } from "../git-credentials";

export interface PrepareWorkspaceDeps {
  workspaceRoot: string;
  getCredentials: () => GitCredentialConfig | null;
}

export function createPrepareWorkspaceStage(
  deps: PrepareWorkspaceDeps,
): StageRunner {
  return {
    name: "PREPARING_WORKSPACE",
    run: async (_jobId: string, message: SQSJobMessage): Promise<void> => {
      const repoDir = join(deps.workspaceRoot, message.repoId);
      const { repoUrl, baseBranch, workBranch } = message;
      const creds = deps.getCredentials?.() ?? null;

      const effectiveUrl = creds?.rewriteUrl
        ? creds.rewriteUrl(repoUrl)
        : repoUrl;

      const envOverride = creds?.env && Object.keys(creds.env).length > 0
        ? { ...process.env, ...creds.env }
        : undefined;

      if (!existsSync(join(repoDir, ".git"))) {
        await git(["clone", effectiveUrl, repoDir], undefined, envOverride);
      }

      await git(["fetch", "--all"], repoDir, envOverride);
      await git(["checkout", baseBranch], repoDir);
      await git(["reset", "--hard", `origin/${baseBranch}`], repoDir);
      await git(["checkout", "-B", workBranch], repoDir);
    },
  };
}

function git(args: string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const opts: ExecFileOptions = { cwd, timeout: 120_000 };
    if (env) opts.env = env;
    execFile("git", args, opts, (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(`git ${args[0]} failed: ${String(stderr) || error.message}`),
        );
        return;
      }
      resolve(String(stdout));
    });
  });
}
