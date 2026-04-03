import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { normalizeEvent } from "../middleware/event-adapter.js";
import { createRequestLogger } from "../middleware/logger.js";
import { parseJsonBody } from "../middleware/request-parser.js";
import { buildSuccessResponse, buildErrorResponse, ValidationError } from "../middleware/error-handler.js";

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "amazon.nova-lite-v1:0";
const REGION = process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-east-1";

const bedrock = new BedrockRuntimeClient({ region: REGION });

// ─── POST /improve-text ───
// Bedrock is used ONLY for improving user input in the UI (feature descriptions + constraints).
// Spec generation is handled entirely by the agent sending prompts to Kiro ACP.

const IMPROVE_SYSTEM_PROMPTS: Record<string, string> = {
  description: [
    "You are a technical writing specialist helping users write better feature descriptions for software development.",
    "Take the user's rough feature description and improve it to be:",
    "- Clear, specific, and unambiguous",
    "- Well-structured with proper technical detail",
    "- Covering the key aspects: what it does, who it's for, and the expected behavior",
    "- Actionable for a coding agent to implement",
    "",
    "Return ONLY the improved text. No explanations, no labels, no markdown fences.",
    "Preserve the user's intent — enhance clarity and detail, don't change the scope.",
  ].join("\n"),

  constraints: [
    "You are a technical writing specialist helping users write better constraints for software development tasks.",
    "Take the user's rough constraints and improve them to be:",
    "- Clear, specific, and actionable",
    "- Organized by category (technical, performance, security, UX, etc.) if multiple",
    "- Phrased as concrete directives the coding agent can follow",
    "",
    "Return ONLY the improved constraints text. No explanations, no labels, no markdown fences.",
    "Preserve the user's intent — enhance clarity, don't add unnecessary restrictions.",
  ].join("\n"),
};

async function handleImproveText(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const body = parseJsonBody<Record<string, unknown>>(event);
  const text = body.text as string | undefined;
  const field = body.field as string | undefined;

  if (!text?.trim()) {
    throw new ValidationError("text is required");
  }
  if (!field || !IMPROVE_SYSTEM_PROMPTS[field]) {
    throw new ValidationError("field must be one of: description, constraints");
  }

  const system: SystemContentBlock[] = [{ text: IMPROVE_SYSTEM_PROMPTS[field] }];
  const messages: Message[] = [
    { role: "user", content: [{ text: text.trim() }] },
  ];

  const response = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system,
      messages,
      inferenceConfig: {
        maxTokens: 2048,
        temperature: 0.3,
        topP: 0.9,
      },
    }),
  );

  const improved =
    response.output?.message?.content?.[0]?.text ?? text;

  return buildSuccessResponse(200, {
    original: text,
    improved,
    field,
  });
}

// ─── Router ───

export async function handler(
  rawEvent: unknown,
): Promise<APIGatewayProxyResult> {
  const event = normalizeEvent(rawEvent as Record<string, unknown>);
  const logger = createRequestLogger(event);
  try {
    const method = event.httpMethod;
    const path = event.path ?? "";

    logger.info("SpecGenerator handler invoked", { method, path });

    if (method === "POST" && path.endsWith("/improve-text")) {
      return await handleImproveText(event);
    }

    return buildSuccessResponse(404, {
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  } catch (err) {
    logger.error("SpecGenerator handler error", { error: (err as Error).message });
    return buildErrorResponse(err as Error);
  }
}
