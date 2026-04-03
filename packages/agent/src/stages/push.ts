import { execFile, type ExecFileOptions } from "node:child_process";
import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { SQSJobMessage } from "@remote-kiro/common";
import type { GitCredentialConfig } from "../git-credentials";

export interface PushDeps {
  workspaceRoot: string;
  getCredentials: () => GitCredentialConfig | null;
}

export function createPushStage(deps: PushDeps): StageRunner {
  return {
    name: "PUSHING",
    run: async (_jobId: string, message: SQSJobMessage): Promise<void> => {
      const repoDir = join(deps.workspaceRoot, message.repoId);
      const { workBranch } = message;
      const creds = deps.getCredentials?.() ?? null;

      const envOverride = creds?.env && Object.keys(creds.env).length > 0
        ? { ...process.env, ...creds.env }
        : undefined;

      if (creds?.rewriteUrl) {
        const newUrl = creds.rewriteUrl(message.repoUrl);
        await git(["remote", "set-url", "origin", newUrl], repoDir, envOverride);
      }

      await git(["push", "--force-with-lease", "origin", workBranch], repoDir, envOverride);
    },
  };
}

function git(args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<string> {
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
