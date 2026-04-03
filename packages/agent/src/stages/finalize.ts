import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { BackendApiClient } from "../api-client";
import type { SQSJobMessage } from "@remote-kiro/common";

export interface FinalizeDeps {
  apiClient: BackendApiClient;
  logDir: string;
}

// ─── Factory ───

export function createFinalizeStage(deps: FinalizeDeps): StageRunner {
  return {
    name: "FINALIZING",
    run: async (jobId: string, _message: SQSJobMessage): Promise<void> => {
      // Upload execution log artifact if it exists
      const logPath = join(deps.logDir, `${jobId}.log`);

      if (existsSync(logPath)) {
        // Request presigned upload URL
        const presignResponse = await deps.apiClient.requestArtifactPresign(
          jobId,
          {
            artifactType: "log",
            filename: `${jobId}.log`,
            contentType: "text/plain",
          },
        );

        const presignData = presignResponse.data;
        if (presignData?.uploadUrl) {
          // Read log file and upload via presigned URL
          const logContent = await readFile(logPath);
          await uploadArtifact(presignData.uploadUrl, logContent, "text/plain");
        }
      }
    },
  };
}

// ─── Helpers ───

async function uploadArtifact(
  uploadUrl: string,
  content: Buffer,
  contentType: string,
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(content.length),
    },
    body: content,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Artifact upload failed (HTTP ${response.status}): ${body}`,
    );
  }
}
