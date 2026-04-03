import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { EventBuffer } from "../event-buffer";
import type {
  KiroAcpClient,
  McpServer,
  AcpUpdate,
} from "../kiro-acp-client";
import type { SQSJobMessage, ReviewPRMessage } from "@remote-kiro/common";
import { lastDiff } from "./prepare-diff";

export interface RunReviewDeps {
  kiroAcpClient: KiroAcpClient;
  eventBuffer: EventBuffer;
  workspaceRoot: string;
}

export interface ReviewFinding {
  file: string;
  line: number;
  severity: "critical" | "warning" | "suggestion" | "info";
  message: string;
  suggestion?: string;
}

export interface ReviewResult {
  summary: string;
  findings: ReviewFinding[];
  outcome: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
}

/** Stored review result accessible by downstream stages. */
export let lastReviewResult: ReviewResult | null = null;

// ─── Factory ───

export function createRunReviewStage(deps: RunReviewDeps): StageRunner {
  return {
    name: "RUNNING_REVIEW",
    run: async (jobId: string, message: SQSJobMessage): Promise<void> => {
      const msg = message as ReviewPRMessage;
      const repoDir = join(deps.workspaceRoot, msg.repoId);
      const client = deps.kiroAcpClient;

      // Read MCP servers from bundle manifest if available
      const mcpServers = await loadMcpServers(repoDir);

      // Spawn and initialize
      client.spawn();

      try {
        await client.initialize({
          name: "remote-kiro-agent",
          version: "1.0.0",
        });

        const sessionId = await client.createSession(repoDir, mcpServers);

        // Listen for updates to post progress events
        const onUpdate = (update: AcpUpdate) => {
          if (update.kind === "ToolCall" || update.kind === "tool_call") {
            deps.eventBuffer.bufferEvent(jobId, {
              eventType: "log",
              message: `Tool call: ${update.toolName ?? "unknown"}`,
              stage: "RUNNING_REVIEW",
              metadata: {
                toolCallId: update.toolCallId,
                toolName: update.toolName,
              },
            });
          }
        };
        client.on("update", onUpdate);

        // Build review prompt with diff and checklist
        const promptText = buildReviewPrompt(msg, lastDiff);

        // Use shorter timeout for reviews (10 minutes)
        const result = await client.sendPrompt(sessionId, promptText, 10 * 60 * 1000);

        client.off("update", onUpdate);

        // Parse structured review findings from transcript
        lastReviewResult = parseReviewFindings(result.transcript);

        await deps.eventBuffer.bufferEvent(jobId, {
          eventType: "log",
          message: `Review completed: ${lastReviewResult.outcome} with ${lastReviewResult.findings.length} findings`,
          stage: "RUNNING_REVIEW",
          metadata: {
            stopReason: result.stopReason,
            outcome: lastReviewResult.outcome,
            findingCount: lastReviewResult.findings.length,
            toolCallCount: result.toolCalls.length,
          },
        });

        if (
          result.stopReason !== "end_turn" &&
          result.stopReason !== "complete"
        ) {
          throw new Error(
            `Kiro review stopped unexpectedly with reason: ${result.stopReason}`,
          );
        }
      } finally {
        client.destroy();
      }
    },
  };
}

// ─── Helpers ───

function buildReviewPrompt(msg: ReviewPRMessage, diff: string): string {
  const parts = [
    "You are a code reviewer. Review the following PR diff and provide structured findings.",
    "",
    `PR #${msg.prNumber}: ${msg.prUrl}`,
    `Base branch: ${msg.baseBranch}`,
    `Work branch: ${msg.workBranch}`,
    "",
    "Review checklist:",
    "- Code correctness and logic errors",
    "- Security vulnerabilities",
    "- Performance issues",
    "- Code style and best practices",
    "- Error handling",
    "- Test coverage gaps",
    "",
    "Respond with a JSON block containing your findings in this format:",
    '```json',
    '{',
    '  "summary": "Overall review summary",',
    '  "outcome": "APPROVE | REQUEST_CHANGES | COMMENT",',
    '  "findings": [',
    '    {',
    '      "file": "path/to/file.ts",',
    '      "line": 42,',
    '      "severity": "critical | warning | suggestion | info",',
    '      "message": "Description of the issue",',
    '      "suggestion": "Optional suggested fix"',
    '    }',
    '  ]',
    '}',
    '```',
    "",
    "PR Diff:",
    "```diff",
    diff,
    "```",
  ];

  return parts.join("\n");
}

function parseReviewFindings(transcript: string): ReviewResult {
  // Try to extract JSON from the transcript
  const jsonMatch = transcript.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as ReviewResult;
      return {
        summary: parsed.summary ?? "Review completed",
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
        outcome: normalizeOutcome(parsed.outcome),
      };
    } catch {
      // Fall through to default
    }
  }

  // Try raw JSON parse
  const rawJsonMatch = transcript.match(/\{[\s\S]*"findings"[\s\S]*\}/);
  if (rawJsonMatch) {
    try {
      const parsed = JSON.parse(rawJsonMatch[0]) as ReviewResult;
      return {
        summary: parsed.summary ?? "Review completed",
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
        outcome: normalizeOutcome(parsed.outcome),
      };
    } catch {
      // Fall through to default
    }
  }

  // Default: treat entire transcript as a comment
  return {
    summary: transcript.slice(0, 500) || "Review completed",
    findings: [],
    outcome: "COMMENT",
  };
}

function normalizeOutcome(
  outcome: string | undefined,
): "APPROVE" | "REQUEST_CHANGES" | "COMMENT" {
  const upper = String(outcome ?? "").toUpperCase();
  if (upper === "APPROVE") return "APPROVE";
  if (upper === "REQUEST_CHANGES") return "REQUEST_CHANGES";
  return "COMMENT";
}

async function loadMcpServers(repoDir: string): Promise<McpServer[]> {
  try {
    const mcpPath = join(repoDir, ".kiro", "settings", "mcp.json");
    const raw = await readFile(mcpPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      mcpServers?: McpServer[];
      servers?: McpServer[];
    };
    return parsed.mcpServers ?? parsed.servers ?? [];
  } catch {
    return [];
  }
}
