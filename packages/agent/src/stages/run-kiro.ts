import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { EventBuffer } from "../event-buffer";
import type {
  KiroAcpClient,
  McpServer,
  AcpUpdate,
} from "../kiro-acp-client";
import type { SQSJobMessage, ImplementFeatureMessage } from "@remote-kiro/common";

export interface RunKiroDeps {
  kiroAcpClient: KiroAcpClient;
  eventBuffer: EventBuffer;
  workspaceRoot: string;
}

// ─── Factory ───

export function createRunKiroStage(deps: RunKiroDeps): StageRunner {
  return {
    name: "RUNNING_KIRO",
    run: async (jobId: string, message: SQSJobMessage): Promise<void> => {
      const msg = message as ImplementFeatureMessage;
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
              stage: "RUNNING_KIRO",
              metadata: {
                toolCallId: update.toolCallId,
                toolName: update.toolName,
              },
            });
          }
        };
        client.on("update", onUpdate);

        // Build prompt from feature description + constraints
        const promptText = buildFeaturePrompt(msg);

        const result = await client.sendPrompt(sessionId, promptText);

        client.off("update", onUpdate);

        // Post transcript summary event
        await deps.eventBuffer.bufferEvent(jobId, {
          eventType: "log",
          message: `Kiro completed with stopReason: ${result.stopReason}`,
          stage: "RUNNING_KIRO",
          metadata: {
            stopReason: result.stopReason,
            toolCallCount: result.toolCalls.length,
            transcriptLength: result.transcript.length,
          },
        });

        if (
          result.stopReason !== "end_turn" &&
          result.stopReason !== "complete"
        ) {
          throw new Error(
            `Kiro stopped unexpectedly with reason: ${result.stopReason}`,
          );
        }
      } finally {
        client.destroy();
      }
    },
  };
}

// ─── Helpers ───

function buildFeaturePrompt(msg: ImplementFeatureMessage): string {
  const parts = [
    "Implement the following feature:",
    "",
    msg.description || msg.title || `Job ${msg.jobId}`,
  ];

  if (msg.constraints) {
    parts.push("", "Constraints:", msg.constraints);
  }

  return parts.join("\n");
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
    // No MCP config — that's fine
    return [];
  }
}
