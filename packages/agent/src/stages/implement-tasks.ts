import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { BackendApiClient } from "../api-client";
import type { EventBuffer } from "../event-buffer";
import { KiroAcpClient, type AcpUpdate } from "../kiro-acp-client";
import type { SQSJobMessage, ImplementFeatureMessage, ResumeJobMessage } from "@remote-kiro/common";
import { SpecPhase, SpecPhaseStatus } from "@remote-kiro/common";

export interface ImplementTasksDeps {
  kiroAcpClient: KiroAcpClient;
  apiClient: BackendApiClient;
  eventBuffer: EventBuffer;
  workspaceRoot: string;
}

export function createImplementTasksStage(deps: ImplementTasksDeps): StageRunner {
  return {
    name: "IMPLEMENTING_TASKS",
    run: async (jobId: string, message: SQSJobMessage): Promise<void> => {
      const msg = message as ImplementFeatureMessage | ResumeJobMessage;
      const repoDir = join(deps.workspaceRoot, msg.repoId);

      const specResp = await deps.apiClient.getSpec(jobId);
      const spec = specResp.data as any;
      const tasks = spec?.phases?.[SpecPhase.TASKS]?.items ?? [];
      const requirements = spec?.phases?.[SpecPhase.REQUIREMENTS]?.items ?? [];
      const design = spec?.phases?.[SpecPhase.DESIGN]?.items ?? [];

      if (tasks.length === 0) {
        await deps.eventBuffer.bufferEvent(jobId, {
          eventType: "log",
          message: "No tasks to implement — skipping",
          stage: "IMPLEMENTING_TASKS",
          metadata: {},
        });
        return;
      }

      const systemPrompt = buildSystemPrompt(msg, requirements, design, tasks);

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        if (task.completed || task.taskStatus === "completed") continue;

        // Mark task as in_progress
        tasks[i] = { ...task, taskStatus: "in_progress" };
        await deps.apiClient.updateSpec(jobId, {
          phase: SpecPhase.TASKS,
          status: SpecPhaseStatus.APPROVED,
          items: tasks,
        });

        await deps.eventBuffer.bufferEvent(jobId, {
          eventType: "log",
          message: `Implementing task ${i + 1}/${tasks.length}: ${task.id}`,
          stage: "IMPLEMENTING_TASKS",
          metadata: { taskId: task.id, taskIndex: i },
        });

        const client = new KiroAcpClient();
        console.log(`[IMPLEMENTING_TASKS] ${task.id}: spawning kiro-cli acp...`);
        client.spawn();
        console.log(`[IMPLEMENTING_TASKS] ${task.id}: kiro-cli spawned, initializing...`);

        try {
          await client.initialize({ name: "remote-kiro-agent", version: "1.0.0" });
          const sessionId = await client.createSession(repoDir);

          const onUpdate = (update: AcpUpdate) => {
            if (update.kind === "ToolCall" || update.kind === "tool_call") {
              console.log(`[IMPLEMENTING_TASKS] [${task.id}] 🔧 Tool: ${update.toolName ?? "unknown"}`);
              deps.eventBuffer.bufferEvent(jobId, {
                eventType: "log",
                message: `[${task.id}] Tool: ${update.toolName ?? "unknown"}`,
                stage: "IMPLEMENTING_TASKS",
                metadata: { toolCallId: update.toolCallId, toolName: update.toolName, taskId: task.id },
              });
            } else if (update.kind === "AgentMessageChunk" || update.kind === "agent_message_chunk") {
              const text = extractChunkText(update);
              if (text) {
                const trimmed = text.replace(/\n/g, " ").slice(0, 200);
                if (trimmed.trim()) console.log(`[IMPLEMENTING_TASKS] [${task.id}] 💬 ${trimmed}`);
              }
            } else if (update.kind === "TurnEnd" || update.kind === "turn_end") {
              console.log(`[IMPLEMENTING_TASKS] [${task.id}] ✅ Turn ended`);
            } else if (update.kind === "ToolResult" || update.kind === "tool_result") {
              console.log(`[IMPLEMENTING_TASKS] [${task.id}] 📋 Tool result received`);
            } else {
              console.log(`[IMPLEMENTING_TASKS] [${task.id}] 📨 Update: ${update.kind}`);
            }
          };
          client.on("update", onUpdate);

          const taskPrompt = buildTaskPrompt(systemPrompt, task, i, tasks.length);
          console.log(`[IMPLEMENTING_TASKS] ${task.id}: sending prompt (${taskPrompt.length} chars)...`);
          const result = await client.sendPrompt(sessionId, taskPrompt);
          console.log(`[IMPLEMENTING_TASKS] ${task.id}: completed (stopReason=${result.stopReason}, toolCalls=${result.toolCalls.length})`);

          client.off("update", onUpdate);

          // Mark task as completed
          tasks[i] = { ...tasks[i], taskStatus: "completed", completed: true };
          await deps.apiClient.updateSpec(jobId, {
            phase: SpecPhase.TASKS,
            status: SpecPhaseStatus.APPROVED,
            items: tasks,
          });

          await deps.eventBuffer.bufferEvent(jobId, {
            eventType: "log",
            message: `Task ${task.id} completed (${result.toolCalls.length} tool calls)`,
            stage: "IMPLEMENTING_TASKS",
            metadata: {
              taskId: task.id,
              stopReason: result.stopReason,
              toolCallCount: result.toolCalls.length,
            },
          });

          if (result.stopReason !== "end_turn" && result.stopReason !== "complete") {
            tasks[i] = { ...tasks[i], taskStatus: "failed" };
            await deps.apiClient.updateSpec(jobId, {
              phase: SpecPhase.TASKS,
              status: SpecPhaseStatus.APPROVED,
              items: tasks,
            });
            throw new Error(`Kiro stopped unexpectedly on ${task.id}: ${result.stopReason}`);
          }
        } finally {
          console.log(`[IMPLEMENTING_TASKS] ${task.id}: destroying kiro-cli session...`);
          client.destroy();
          console.log(`[IMPLEMENTING_TASKS] ${task.id}: session destroyed`);
        }
      }

      await deps.eventBuffer.bufferEvent(jobId, {
        eventType: "log",
        message: `All ${tasks.length} tasks implemented successfully`,
        stage: "IMPLEMENTING_TASKS",
        metadata: { taskCount: tasks.length },
      });
    },
  };
}

function buildSystemPrompt(
  msg: ImplementFeatureMessage | ResumeJobMessage,
  requirements: any[],
  design: any[],
  tasks: any[],
): string {
  const desc = msg.description || msg.title || `Job ${msg.jobId}`;
  const parts: string[] = [
    "You are a senior software engineer implementing a feature based on an approved specification.",
    "Below is the full context: the feature description, approved requirements, approved technical design, and implementation tasks.",
    "You will be given ONE specific task to implement. Implement ONLY that task.",
    "",
    `# Feature: ${desc}`,
  ];

  if (msg.constraints) {
    parts.push(`\n**Constraints:** ${msg.constraints}`);
  }

  parts.push(
    "",
    "# Approved Requirements",
    ...requirements.map((r: any) => `## ${r.id}\n${r.content}`),
    "",
    "# Approved Design",
    ...design.map((d: any) => d.content),
    "",
    "# All Implementation Tasks",
    ...tasks.map((t: any, i: number) => `${i + 1}. **${t.id}:** ${t.content.split("\n")[0]}`),
  );

  return parts.join("\n");
}

function extractChunkText(update: AcpUpdate): string {
  const content = update.content;
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    if ("text" in content) return String((content as { text: unknown }).text);
    if (Array.isArray(content)) {
      return content
        .map((item: any) => {
          if (typeof item === "string") return item;
          if (item?.text) return String(item.text);
          if (item?.content?.text) return String(item.content.text);
          return "";
        })
        .join("");
    }
  }
  return "";
}

function buildTaskPrompt(
  systemPrompt: string,
  task: any,
  index: number,
  total: number,
): string {
  return [
    systemPrompt,
    "",
    "---",
    "",
    `# YOUR TASK: Implement ${task.id} (Task ${index + 1} of ${total})`,
    "",
    task.content,
    "",
    "INSTRUCTIONS:",
    `- Implement ONLY what ${task.id} describes.`,
    "- Write clean, well-structured code following the repository's existing conventions.",
    "- Create or modify only the files needed for this task.",
    "- If the task includes subtasks (checkboxes), complete all of them.",
    "- If the task mentions tests, write them.",
    "- Do NOT implement other tasks — they will be handled separately.",
    `- When done, confirm: "${task.id} completed."`,
  ].join("\n");
}
