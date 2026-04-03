import { writeFileSync, mkdirSync, chmodSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BackendApiClient } from "./api-client";

export interface GitCredentialConfig {
  credentialType: string;
  env: Record<string, string>;
  rewriteUrl?: (original: string) => string;
  cleanup?: () => void;
}

export async function fetchGitCredentials(
  apiClient: BackendApiClient,
  jobId: string,
): Promise<GitCredentialConfig | null> {
  try {
    const credResp = await apiClient.getCredential(jobId);
    const cred = credResp.data as Record<string, unknown> | undefined;
    if (!cred?.configured) return null;

    const credentialType = cred.credentialType as string;
    const secret = cred.secret as Record<string, string> | undefined;

    return buildCredentialConfig(credentialType, secret);
  } catch {
    return null;
  }
}

function buildCredentialConfig(
  credentialType: string,
  secret: Record<string, string> | undefined,
): GitCredentialConfig {
  const env: Record<string, string> = {};
  let rewriteUrl: ((u: string) => string) | undefined;
  let cleanup: (() => void) | undefined;

  if (credentialType === "codecommit_iam") {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "credential.helper";
    env.GIT_CONFIG_VALUE_0 = "!aws codecommit credential-helper $@";
  } else if (credentialType === "https_basic" && secret) {
    const token = secret.token ?? secret.password ?? "";
    const username = secret.username ?? "git";
    rewriteUrl = (original: string) => {
      try {
        const url = new URL(original);
        url.username = encodeURIComponent(username);
        url.password = encodeURIComponent(token);
        return url.toString();
      } catch {
        return original;
      }
    };
  } else if (credentialType === "ssh_key" && secret?.sshPrivateKey) {
    const keyDir = join(tmpdir(), "remote-kiro-ssh");
    mkdirSync(keyDir, { recursive: true });
    const keyPath = join(keyDir, `key_${Date.now()}`);
    writeFileSync(keyPath, secret.sshPrivateKey + "\n", { mode: 0o600 });
    chmodSync(keyPath, 0o600);
    env.GIT_SSH_COMMAND = `ssh -i ${keyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
    cleanup = () => {
      try { unlinkSync(keyPath); } catch { /* ignore */ }
    };
  }

  return { credentialType, env, rewriteUrl, cleanup };
}
