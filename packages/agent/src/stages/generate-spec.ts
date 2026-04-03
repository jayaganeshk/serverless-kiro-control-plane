import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { BackendApiClient } from "../api-client";
import type { EventBuffer } from "../event-buffer";
import type { KiroAcpClient, AcpUpdate } from "../kiro-acp-client";
import type { SQSJobMessage, ImplementFeatureMessage, ImplementReviewFixMessage, ResumeJobMessage } from "@remote-kiro/common";
import { SpecPhase, SpecPhaseStatus } from "@remote-kiro/common";

export interface GenerateSpecDeps {
  phase: SpecPhase;
  kiroAcpClient: KiroAcpClient;
  apiClient: BackendApiClient;
  eventBuffer: EventBuffer;
  workspaceRoot: string;
}

const STAGE_NAMES: Record<SpecPhase, string> = {
  [SpecPhase.REQUIREMENTS]: "GENERATING_REQUIREMENTS",
  [SpecPhase.DESIGN]: "GENERATING_DESIGN",
  [SpecPhase.TASKS]: "GENERATING_TASKS",
};

const PHASE_FILE: Record<SpecPhase, string> = {
  [SpecPhase.REQUIREMENTS]: "requirements.md",
  [SpecPhase.DESIGN]: "design.md",
  [SpecPhase.TASKS]: "tasks.md",
};

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPTS — these define the exact output format Kiro
// must follow for each spec phase.
// ─────────────────────────────────────────────────────────────

const REQUIREMENTS_SYSTEM_PROMPT = `You are a senior software architect generating requirements for a feature request.

OUTPUT FORMAT — follow this EXACTLY:

# Requirements

## Requirement 1
**User Story:** As a [role], I want [goal], so that [benefit].
### Acceptance Criteria
1. WHEN [condition] THEN the system SHALL [expected behavior]
2. WHEN [condition] THEN the system SHALL [expected behavior]

## Requirement 2
**User Story:** As a [role], I want [goal], so that [benefit].
### Acceptance Criteria
1. WHEN [condition] THEN the system SHALL [expected behavior]

(continue for all requirements)

RULES:
- Number requirements sequentially: Requirement 1, Requirement 2, etc.
- Every requirement MUST have a User Story and at least 2 Acceptance Criteria.
- Acceptance Criteria MUST use the WHEN/THEN/SHALL pattern.
- Cover: functional behavior, input validation, error handling, security, edge cases, and observability.
- Be specific and testable — no vague statements.
- Do NOT include architecture, data models, or implementation details — those belong in the Design phase.
- Output ONLY the requirements document. No commentary before or after.`;

const DESIGN_SYSTEM_PROMPT = `You are a senior software architect creating a technical design document.
The approved requirements from the previous phase are provided as context.

Produce a single, cohesive markdown document that covers the technical design.
Use whatever sections and depth are appropriate for the feature.
Common sections include (but are NOT mandatory — include only what is relevant):

- Overview / Summary
- Architecture (components, data flow, diagrams)
- API Design (endpoints, request/response schemas)
- Data Models (database schemas, interfaces)
- Component Design (modules, responsibilities)
- Error Handling & Edge Cases
- Security Considerations
- Testing Strategy

RULES:
- Start the document with a top-level heading: # Technical Design
- Use ## for major sections and ### for subsections.
- Reference requirement numbers (Requirement 1, Requirement 2, etc.) where relevant.
- Use code blocks for interfaces, schemas, and API contracts.
- Use tables, lists, and ASCII diagrams where they improve clarity.
- Be specific enough that a developer can implement from this document alone.
- This is a SINGLE continuous markdown document — NOT a set of numbered items.
- Output ONLY the design document. No commentary before or after.`;

const TASKS_SYSTEM_PROMPT = `You are a senior software architect breaking a technical design into implementation tasks.
The approved requirements and design from previous phases are provided as context.

OUTPUT FORMAT — follow this EXACTLY:

# Implementation Tasks

## TASK-001: [Short descriptive title]
**Priority:** [High/Medium/Low]
**Estimated Effort:** [Small/Medium/Large]
**Dependencies:** [None | TASK-XXX, TASK-YYY]
**Requirements:** [Requirement 1, Requirement 2]

**Description:**
[2-4 sentences describing what needs to be done]

**Subtasks:**
- [ ] [Specific subtask 1]
- [ ] [Specific subtask 2]
- [ ] [Specific subtask 3]

**Acceptance Criteria:**
- [What defines "done" for this task]

## TASK-002: [Short descriptive title]
...

RULES:
- Number tasks sequentially: TASK-001, TASK-002, etc.
- Order tasks by dependency — a task should only depend on tasks with lower numbers.
- Each task should be small enough for a single pull request / commit.
- Include setup tasks (project scaffolding, config) before implementation tasks.
- Include test tasks after their corresponding implementation tasks.
- Every task MUST have: title, priority, effort, dependencies, requirements reference, description, subtasks, acceptance criteria.
- Be specific — a developer should be able to pick up any task and start working immediately.
- Output ONLY the tasks document. No commentary before or after.`;

const SYSTEM_PROMPTS: Record<SpecPhase, string> = {
  [SpecPhase.REQUIREMENTS]: REQUIREMENTS_SYSTEM_PROMPT,
  [SpecPhase.DESIGN]: DESIGN_SYSTEM_PROMPT,
  [SpecPhase.TASKS]: TASKS_SYSTEM_PROMPT,
};

// ─────────────────────────────────────────────────────────────
// Stage factory
// ─────────────────────────────────────────────────────────────

export function createGenerateSpecStage(deps: GenerateSpecDeps): StageRunner {
  const stageName = STAGE_NAMES[deps.phase];

  return {
    name: stageName,
    run: async (jobId: string, message: SQSJobMessage): Promise<void> => {
      const msg = message as ImplementFeatureMessage | ImplementReviewFixMessage | ResumeJobMessage;
      const repoDir = join(deps.workspaceRoot, msg.repoId);
      const client = deps.kiroAcpClient;

      await deps.apiClient.updateSpec(jobId, {
        phase: deps.phase,
        status: SpecPhaseStatus.GENERATING,
        items: [],
      });

      // Build the .kiro/specs/<feature>/ path
      const featureSlug = slugify(msg.description || msg.title || jobId);
      const specDir = join(repoDir, ".kiro", "specs", featureSlug);
      await mkdir(specDir, { recursive: true });
      const specFile = join(specDir, PHASE_FILE[deps.phase]);

      // Build the user prompt with context from previous phases
      const userPrompt = buildUserPrompt(msg, deps.phase, specDir);

      // Prepend the system prompt so Kiro knows the exact output format
      const fullPrompt = `${SYSTEM_PROMPTS[deps.phase]}\n\n---\n\n${userPrompt}`;

      client.spawn();

      try {
        await client.initialize({ name: "remote-kiro-agent", version: "1.0.0" });
        const sessionId = await client.createSession(repoDir);

        const onUpdate = (update: AcpUpdate) => {
          if (update.kind === "ToolCall" || update.kind === "tool_call") {
            deps.eventBuffer.bufferEvent(jobId, {
              eventType: "log",
              message: `Tool call: ${update.toolName ?? "unknown"}`,
              stage: stageName,
              metadata: { toolCallId: update.toolCallId, toolName: update.toolName },
            });
          }
        };
        client.on("update", onUpdate);

        console.log(`[${stageName}] Sending prompt (${fullPrompt.length} chars)...`);
        const result = await client.sendPrompt(sessionId, fullPrompt);
        console.log(`[${stageName}] Prompt completed: stopReason=${result.stopReason}, transcript=${result.transcript.length} chars`);
        client.off("update", onUpdate);

        // Get spec content — prefer file Kiro wrote, fall back to transcript
        let specContent: string;
        if (existsSync(specFile)) {
          specContent = await readFile(specFile, "utf-8");
        } else {
          specContent = result.transcript;
          if (specContent.trim()) {
            await writeFile(specFile, specContent, "utf-8");
          }
        }

        await deps.eventBuffer.bufferEvent(jobId, {
          eventType: "log",
          message: `Spec file written: ${PHASE_FILE[deps.phase]} (${specContent.length} chars)`,
          stage: stageName,
          metadata: { specFile, size: specContent.length },
        });

        // Parse into structured items
        const items = parsePhaseOutput(specContent, deps.phase);

        await deps.apiClient.updateSpec(jobId, {
          phase: deps.phase,
          status: SpecPhaseStatus.DRAFT,
          items,
        });

        await deps.eventBuffer.bufferEvent(jobId, {
          eventType: "spec_update",
          message: `Generated ${items.length} ${deps.phase} items`,
          stage: stageName,
          metadata: { itemCount: items.length, stopReason: result.stopReason },
        });
      } finally {
        client.destroy();
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────
// User prompt builders (context per phase)
// ─────────────────────────────────────────────────────────────

function buildUserPrompt(
  msg: ImplementFeatureMessage | ImplementReviewFixMessage | ResumeJobMessage,
  phase: SpecPhase,
  specDir: string,
): string {
  const desc = msg.description || msg.title || `Job ${msg.jobId}`;
  const constraints = "constraints" in msg && msg.constraints ? `\nConstraints: ${msg.constraints}` : "";
  const reviewReport = "reviewReport" in msg && msg.reviewReport ? msg.reviewReport : "";
  const parts: string[] = [];

  if (phase === SpecPhase.REQUIREMENTS) {
    if (reviewReport) {
      parts.push(
        "Generate requirements to fix the issues identified in the following code review report.",
        "Each review finding should map to one or more requirements.",
        "",
        `Feature: ${desc}`,
        "",
        "--- CODE REVIEW REPORT ---",
        reviewReport,
      );
    } else {
      parts.push(
        "Generate detailed requirements for the following feature request:",
        "",
        desc,
        constraints,
      );
    }
  }

  if (phase === SpecPhase.DESIGN) {
    parts.push(
      "Create a technical design for the following feature request.",
      "",
      `Feature: ${desc}`,
      constraints,
    );
    const reqFile = join(specDir, "requirements.md");
    if (existsSync(reqFile)) {
      try {
        const reqContent = require("node:fs").readFileSync(reqFile, "utf-8");
        parts.push("", "--- APPROVED REQUIREMENTS ---", reqContent);
      } catch { /* ignore */ }
    }
  }

  if (phase === SpecPhase.TASKS) {
    if (reviewReport) {
      parts.push(
        "Break the following code review findings into implementation fix tasks.",
        "Each task should fix one or more specific issues identified in the review.",
        "",
        `Feature: ${desc}`,
        "",
        "--- CODE REVIEW REPORT ---",
        reviewReport,
      );
    } else {
      parts.push(
        "Break the following feature into implementation tasks.",
        "",
        `Feature: ${desc}`,
        constraints,
      );
    }
    const reqFile = join(specDir, "requirements.md");
    const desFile = join(specDir, "design.md");
    if (existsSync(reqFile)) {
      try {
        const reqContent = require("node:fs").readFileSync(reqFile, "utf-8");
        parts.push("", "--- APPROVED REQUIREMENTS ---", reqContent);
      } catch { /* ignore */ }
    }
    if (existsSync(desFile)) {
      try {
        const desContent = require("node:fs").readFileSync(desFile, "utf-8");
        parts.push("", "--- APPROVED DESIGN ---", desContent);
      } catch { /* ignore */ }
    }
  }

  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Parsers — extract structured items from Kiro's markdown output
// ─────────────────────────────────────────────────────────────

function parsePhaseOutput(
  content: string,
  phase: SpecPhase,
): Array<{ id: string; content: string }> {
  if (phase === SpecPhase.REQUIREMENTS) return parseRequirements(content);
  if (phase === SpecPhase.DESIGN) return parseDesignSections(content);
  if (phase === SpecPhase.TASKS) return parseTasks(content);
  return [{ id: "ITEM-001", content: content.trim() }];
}

function parseRequirements(content: string): Array<{ id: string; content: string }> {
  const items: Array<{ id: string; content: string }> = [];
  const regex = /^#{2,3}\s+Requirement\s+(\d+)/gm;
  const matches: Array<{ index: number; num: number }> = [];
  let m: RegExpExecArray | null;

  while ((m = regex.exec(content)) !== null) {
    matches.push({ index: m.index, num: parseInt(m[1], 10) });
  }

  if (matches.length === 0) return fallbackSections(content, "REQ");

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const section = content.slice(start, end).trim();

    const storyMatch = section.match(/\*\*User Story:\*\*\s*([\s\S]*?)(?=\n#{2,4}\s|\n\*\*|$)/);
    const userStory = storyMatch ? storyMatch[1].trim() : "";

    const acMatch = section.match(/#{2,4}\s+Acceptance Criteria\s*\n([\s\S]*?)$/);
    const criteria = acMatch ? acMatch[1].trim() : "";

    const id = `REQ-${String(matches[i].num).padStart(3, "0")}`;
    const parts: string[] = [];
    if (userStory) parts.push(`**User Story:** ${userStory}`);
    if (criteria) parts.push(`**Acceptance Criteria:**\n${criteria}`);

    if (parts.length > 0) {
      items.push({ id, content: parts.join("\n\n") });
    }
  }

  return items.length > 0 ? items : fallbackSections(content, "REQ");
}

function parseDesignSections(content: string): Array<{ id: string; content: string }> {
  return [{ id: "DESIGN", content: content.trim() }];
}

function parseTasks(content: string): Array<{ id: string; content: string }> {
  const items: Array<{ id: string; content: string }> = [];
  // Match "## TASK-NNN: Title"
  const regex = /^#{2,3}\s+TASK-(\d+):\s*(.+)/gm;
  const matches: Array<{ index: number; num: number; title: string }> = [];
  let m: RegExpExecArray | null;

  while ((m = regex.exec(content)) !== null) {
    matches.push({ index: m.index, num: parseInt(m[1], 10), title: m[2].trim() });
  }

  if (matches.length === 0) {
    // Try alternate format: "## Task 1: Title"
    const altRegex = /^#{2,3}\s+Task\s+(\d+):\s*(.+)/gm;
    while ((m = altRegex.exec(content)) !== null) {
      matches.push({ index: m.index, num: parseInt(m[1], 10), title: m[2].trim() });
    }
  }

  if (matches.length === 0) return fallbackSections(content, "TASK");

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const body = content.slice(start, end).trim();

    // Remove the heading line itself, keep the body
    const bodyLines = body.split("\n").slice(1).join("\n").trim();

    const id = `TASK-${String(matches[i].num).padStart(3, "0")}`;
    items.push({
      id,
      content: `**${matches[i].title}**\n\n${bodyLines}`,
    });
  }

  return items.length > 0 ? items : fallbackSections(content, "TASK");
}

function fallbackSections(
  markdown: string,
  prefix: string,
): Array<{ id: string; content: string }> {
  const lines = markdown.split("\n");
  const sections: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;

  for (const line of lines) {
    const heading = line.match(/^#{2,3}\s+(.+)/);
    if (heading) {
      if (current && current.body.length > 0) sections.push(current);
      current = { title: heading[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    } else {
      current = { title: "", body: [line] };
    }
  }
  if (current && current.body.length > 0) sections.push(current);

  const skip = new Set(["requirements", "technical design", "implementation tasks", "design", "tasks"]);
  const items: Array<{ id: string; content: string }> = [];
  let idx = 0;

  for (const s of sections) {
    if (skip.has(s.title.toLowerCase())) continue;
    const body = s.body.join("\n").trim();
    if (!body) continue;
    idx++;
    items.push({
      id: `${prefix}-${String(idx).padStart(3, "0")}`,
      content: s.title ? `**${s.title}**\n\n${body}` : body,
    });
  }

  return items.length > 0 ? items : [{ id: `${prefix}-001`, content: markdown.trim() }];
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50)
    .replace(/-+$/, "");
}


