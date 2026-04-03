import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import type { Agent, AgentMachineInfo } from "@remote-kiro/common";
import { createRequestLogger } from "../middleware/logger.js";
import { normalizeEvent } from "../middleware/event-adapter.js";
import {
  parseJsonBody,
  requirePathParam,
  requireFields,
} from "../middleware/request-parser.js";
import {
  buildSuccessResponse,
  buildErrorResponse,
  ValidationError,
  NotFoundError,
} from "../middleware/error-handler.js";
import { createOrUpdateAgent, updateHeartbeat, listAgents } from "../db/agents.js";

// ─── POST /agents/register ───

async function handleRegister(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { machineId, machineLabel, workspaceRoot } = requireFields<{
    machineId: string;
    machineLabel: string;
    workspaceRoot: string;
  }>(body, ["machineId", "machineLabel", "workspaceRoot"]);

  const capabilities = (body.capabilities as string[]) ?? [];
  const repoAllowlist = (body.repoAllowlist as string[]) ?? [];
  const maxConcurrentJobs =
    typeof body.maxConcurrentJobs === "number" ? body.maxConcurrentJobs : 1;
  const agentVersion = typeof body.agentVersion === "string" ? body.agentVersion : null;
  const machine = (body.machine as AgentMachineInfo) ?? null;

  const now = new Date().toISOString();
  const agent: Agent = {
    agentId: machineId,
    machineLabel,
    capabilities,
    workspaceRoot,
    status: "online",
    lastHeartbeatAt: now,
    repoAllowlist,
    maxConcurrentJobs,
    currentJobIds: [],
    agentVersion,
    machine,
    createdAt: now,
    updatedAt: now,
  };

  await createOrUpdateAgent(agent);
  return buildSuccessResponse(200, agent);
}

// ─── GET /agents ───

async function handleListAgents(
  _event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const agents = await listAgents();
  return buildSuccessResponse(200, agents);
}

// ─── POST /agents/{agentId}/heartbeat ───

async function handleHeartbeat(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const agentId = requirePathParam(event, "agentId");

  try {
    await updateHeartbeat(agentId);
  } catch (err) {
    if (
      (err as Error).name === "ConditionalCheckFailedException"
    ) {
      throw new NotFoundError(`Agent ${agentId} not found`);
    }
    throw err;
  }

  return buildSuccessResponse(200, { agentId, status: "ok" });
}

// ─── Router ───

export async function handler(
  rawEvent: unknown,
): Promise<APIGatewayProxyResult> {
  const event = normalizeEvent(rawEvent as Record<string, unknown>);
  const logger = createRequestLogger(event);
  try {
    // Agent routes use IAM SigV4 auth — validated at API Gateway level, no JWT needed
    const method = event.httpMethod;
    const path = event.path ?? "";
    const hasAgentId = !!event.pathParameters?.agentId;

    logger.info("Agent handler invoked", { method, path, hasAgentId });

    if (method === "GET" && path.endsWith("/agents")) {
      return await handleListAgents(event);
    }

    if (method === "POST" && path.endsWith("/agents/register")) {
      return await handleRegister(event);
    }

    if (method === "POST" && hasAgentId && path.endsWith("/heartbeat")) {
      return await handleHeartbeat(event);
    }

    return buildErrorResponse(
      new NotFoundError(`Route not found: ${method} ${path}`),
    );
  } catch (err) {
    logger.error("Agent handler error", {
      error: (err as Error).message,
    });
    return buildErrorResponse(err as Error);
  }
}
