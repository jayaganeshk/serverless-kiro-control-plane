import { readFile as fsReadFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { BackendApiClient } from "../api-client";
import type { EventBuffer } from "../event-buffer";
import type { SQSJobMessage, ReviewPRMessage } from "@remote-kiro/common";
import { lastReviewResult } from "./run-review";

export interface FinalizeReviewDeps {
  apiClient: BackendApiClient;
  eventBuffer: EventBuffer;
  logDir: string;
}

// ─── Factory ───

export function createFinalizeReviewStage(deps: FinalizeReviewDeps): StageRunner {
  return {
    name: "FINALIZING",
    run: async (jobId: string, message: SQSJobMessage): Promise<void> => {
      const msg = message as ReviewPRMessage;
      const review = lastReviewResult;

      if (review) {
        const jsonContent = Buffer.from(JSON.stringify(review, null, 2));
        await uploadArtifactViaPresign(
          deps.apiClient,
          jobId,
          "review_report",
          `${jobId}-review.json`,
          "application/json",
          jsonContent,
        );

        const markdownReport = buildMarkdownReport(review);
        const markdownContent = Buffer.from(markdownReport);
        await uploadArtifactViaPresign(
          deps.apiClient,
          jobId,
          "review_report",
          `${jobId}-review.md`,
          "text/markdown",
          markdownContent,
        );

        // Store review report on the parent job for inline display
        if (msg.parentJobId) {
          try {
            await deps.apiClient.storeReviewData(
              jobId,
              msg.parentJobId,
              markdownReport,
              review.outcome,
            );
            console.log(`[FINALIZING] Stored review report on parent job ${msg.parentJobId}`);
          } catch (err: any) {
            console.log(`[FINALIZING] Failed to store review on parent: ${err.message}`);
          }
        }
      }

      // Upload execution log if it exists
      const logPath = join(deps.logDir, `${jobId}.log`);
      if (existsSync(logPath)) {
        const logContent = await fsReadFile(logPath);
        await uploadArtifactViaPresign(
          deps.apiClient,
          jobId,
          "log",
          `${jobId}.log`,
          "text/plain",
          logContent,
        );
      }

      await deps.eventBuffer.bufferEvent(jobId, {
        eventType: "log",
        message: "Review artifacts uploaded, finalizing job",
        stage: "FINALIZING",
        metadata: {
          hasReviewResult: review !== null,
          findingCount: review?.findings.length ?? 0,
        },
      });
    },
  };
}

// ─── Helpers ───

async function uploadArtifactViaPresign(
  apiClient: BackendApiClient,
  jobId: string,
  artifactType: string,
  filename: string,
  contentType: string,
  content: Buffer,
): Promise<void> {
  const presignResponse = await apiClient.requestArtifactPresign(jobId, {
    artifactType,
    filename,
    contentType,
  });

  const presignData = presignResponse.data;
  if (!presignData?.uploadUrl) {
    throw new Error(`Failed to obtain presigned URL for artifact: ${filename}`);
  }

  const response = await fetch(presignData.uploadUrl, {
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

function buildMarkdownReport(review: {
  summary: string;
  findings: Array<{
    file: string;
    line: number;
    severity: string;
    message: string;
    suggestion?: string;
  }>;
  outcome: string;
}): string {
  const parts = [
    "# Code Review Report",
    "",
    `**Outcome:** ${review.outcome}`,
    "",
    "## Summary",
    "",
    review.summary,
    "",
  ];

  if (review.findings.length > 0) {
    parts.push("## Findings", "");

    for (const finding of review.findings) {
      parts.push(
        `### [${finding.severity.toUpperCase()}] ${finding.file}:${finding.line}`,
        "",
        finding.message,
      );
      if (finding.suggestion) {
        parts.push("", `**Suggestion:** ${finding.suggestion}`);
      }
      parts.push("");
    }
  } else {
    parts.push("## Findings", "", "No issues found.", "");
  }

  return parts.join("\n");
}
