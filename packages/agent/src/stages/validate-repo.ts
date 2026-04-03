import { execFile, type ExecFileOptions } from "node:child_process";
import type { StageRunner } from "../pipeline";
import type { SQSJobMessage } from "@remote-kiro/common";
import type { GitCredentialConfig } from "../git-credentials";

export interface ValidateRepoDeps {
  getCredentials: () => GitCredentialConfig | null;
}

export function createValidateRepoStage(deps?: ValidateRepoDeps): StageRunner {
  return {
    name: "VALIDATING_REPO",
    run: async (_jobId: string, message: SQSJobMessage): Promise<void> => {
      const creds = deps?.getCredentials?.() ?? null;
      const repoUrl = creds?.rewriteUrl
        ? creds.rewriteUrl(message.repoUrl)
        : message.repoUrl;

      const opts: ExecFileOptions = { timeout: 30_000 };
      if (creds?.env && Object.keys(creds.env).length > 0) {
        opts.env = { ...process.env, ...creds.env };
      }

      await lsRemote(repoUrl, message.repoUrl, opts);
    },
  };
}

function lsRemote(url: string, displayUrl: string, opts: ExecFileOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile("git", ["ls-remote", "--exit-code", url], opts, (error) => {
      if (error) {
        reject(
          new Error(
            `Repository is not accessible: ${displayUrl}. git ls-remote failed: ${error.message}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}
