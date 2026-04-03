import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";

// ─── Mocks ───

vi.mock("../middleware/auth.js", () => ({
  validateCognitoJwt: vi.fn().mockResolvedValue("user-123"),
}));

vi.mock("../db/ai-agents.js", () => ({
  createAIAgent: vi.fn(),
  getAIAgentById: vi.fn(),
  listAllAIAgents: vi.fn().mockResolvedValue([]),
  updateAIAgent: vi.fn(),
  deleteAIAgent: vi.fn(),
  seedDefaultAgents: vi.fn().mockResolvedValue(0),
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  class MockBedrockRuntimeClient {
    async send() {
      return {
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  name: "test-agent",
                  description: "A test agent",
                  prompt: "You are a test agent",
                  tools: ["*"],
                  allowedTools: ["read", "write", "shell"],
                }),
              },
            ],
          },
        },
      };
    }
  }
  class MockConverseCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  return {
    BedrockRuntimeClient: MockBedrockRuntimeClient,
    ConverseCommand: MockConverseCommand,
    Message: {},
    SystemContentBlock: {},
  };
});

import { handler } from "./ai-agent.js";
import {
  createAIAgent,
  getAIAgentById,
  listAllAIAgents,
  updateAIAgent,
  deleteAIAgent,
  seedDefaultAgents,
} from "../db/ai-agents.js";

function makeEvent(
  overrides: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent {
  return {
    httpMethod: "GET",
    path: "/ai-agents",
    pathParameters: null,
    queryStringParameters: null,
    headers: { Authorization: "Bearer test-token" },
    body: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
    ...overrides,
  };
}

function parseBody(result: { body: string }) {
  return JSON.parse(result.body).data;
}

// ─── GET /ai-agents ───

describe("GET /ai-agents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should list all agents and seed defaults", async () => {
    const mockAgents = [
      {
        aiAgentId: "agent-1",
        name: "React UI Developer",
        category: "ui_frontend",
        isDefault: true,
      },
    ];
    vi.mocked(listAllAIAgents).mockResolvedValue(mockAgents as any);

    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(200);
    expect(seedDefaultAgents).toHaveBeenCalled();
    expect(listAllAIAgents).toHaveBeenCalled();
    const body = parseBody(result);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("React UI Developer");
  });

  it("should return empty array when no agents exist", async () => {
    vi.mocked(listAllAIAgents).mockResolvedValue([]);

    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toEqual([]);
  });
});

// ─── GET /ai-agents/{aiAgentId} ───

describe("GET /ai-agents/{aiAgentId}", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return a specific agent by ID", async () => {
    const mockAgent = {
      aiAgentId: "agent-1",
      name: "React UI Developer",
      category: "ui_frontend",
      isDefault: true,
      kiroConfig: { name: "react-ui-developer" },
    };
    vi.mocked(getAIAgentById).mockResolvedValue(mockAgent as any);

    const result = await handler(
      makeEvent({
        path: "/ai-agents/agent-1",
        pathParameters: { aiAgentId: "agent-1" },
      }),
    );

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.aiAgentId).toBe("agent-1");
    expect(body.name).toBe("React UI Developer");
  });

  it("should return 404 for non-existent agent", async () => {
    vi.mocked(getAIAgentById).mockResolvedValue(undefined);

    const result = await handler(
      makeEvent({
        path: "/ai-agents/nonexistent",
        pathParameters: { aiAgentId: "nonexistent" },
      }),
    );

    expect(result.statusCode).toBe(404);
  });
});

// ─── POST /ai-agents ───

describe("POST /ai-agents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should create a custom agent", async () => {
    const result = await handler(
      makeEvent({
        httpMethod: "POST",
        path: "/ai-agents",
        body: JSON.stringify({
          name: "My Custom Agent",
          category: "custom",
          description: "A custom agent for testing",
          kiroConfig: {
            name: "custom-test",
            description: "Custom test agent",
            prompt: "You are a custom test agent",
            tools: ["*"],
            allowedTools: ["read"],
          },
        }),
      }),
    );

    expect(result.statusCode).toBe(201);
    expect(createAIAgent).toHaveBeenCalledTimes(1);

    const body = parseBody(result);
    expect(body.name).toBe("My Custom Agent");
    expect(body.category).toBe("custom");
    expect(body.isDefault).toBe(false);
    expect(body.createdBy).toBe("user-123");
    expect(body.aiAgentId).toBeDefined();
    expect(body.kiroConfig.name).toBe("custom-test");
  });

  it("should reject invalid category", async () => {
    const result = await handler(
      makeEvent({
        httpMethod: "POST",
        path: "/ai-agents",
        body: JSON.stringify({
          name: "Bad Agent",
          category: "invalid_category",
          description: "Bad",
          kiroConfig: {
            name: "bad",
            description: "bad",
            prompt: "bad",
          },
        }),
      }),
    );

    expect(result.statusCode).toBe(400);
    expect(createAIAgent).not.toHaveBeenCalled();
  });

  it("should reject missing required fields", async () => {
    const result = await handler(
      makeEvent({
        httpMethod: "POST",
        path: "/ai-agents",
        body: JSON.stringify({ name: "Incomplete Agent" }),
      }),
    );

    expect(result.statusCode).toBe(400);
    expect(createAIAgent).not.toHaveBeenCalled();
  });
});

// ─── PATCH /ai-agents/{aiAgentId} ───

describe("PATCH /ai-agents/{aiAgentId}", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should update an existing agent", async () => {
    const existing = {
      aiAgentId: "agent-1",
      name: "Old Name",
      category: "custom",
    };
    vi.mocked(getAIAgentById).mockResolvedValue(existing as any);
    vi.mocked(updateAIAgent).mockResolvedValue({
      ...existing,
      name: "New Name",
    } as any);

    const result = await handler(
      makeEvent({
        httpMethod: "PATCH",
        path: "/ai-agents/agent-1",
        pathParameters: { aiAgentId: "agent-1" },
        body: JSON.stringify({ name: "New Name" }),
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(updateAIAgent).toHaveBeenCalledWith("agent-1", { name: "New Name" });
    expect(parseBody(result).name).toBe("New Name");
  });

  it("should return 404 for non-existent agent", async () => {
    vi.mocked(getAIAgentById).mockResolvedValue(undefined);

    const result = await handler(
      makeEvent({
        httpMethod: "PATCH",
        path: "/ai-agents/missing",
        pathParameters: { aiAgentId: "missing" },
        body: JSON.stringify({ name: "New Name" }),
      }),
    );

    expect(result.statusCode).toBe(404);
    expect(updateAIAgent).not.toHaveBeenCalled();
  });

  it("should reject invalid category in update", async () => {
    vi.mocked(getAIAgentById).mockResolvedValue({ aiAgentId: "agent-1" } as any);

    const result = await handler(
      makeEvent({
        httpMethod: "PATCH",
        path: "/ai-agents/agent-1",
        pathParameters: { aiAgentId: "agent-1" },
        body: JSON.stringify({ category: "bad_category" }),
      }),
    );

    expect(result.statusCode).toBe(400);
    expect(updateAIAgent).not.toHaveBeenCalled();
  });
});

// ─── DELETE /ai-agents/{aiAgentId} ───

describe("DELETE /ai-agents/{aiAgentId}", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should delete a custom (non-default) agent", async () => {
    vi.mocked(getAIAgentById).mockResolvedValue({
      aiAgentId: "agent-custom",
      name: "Custom Agent",
      isDefault: false,
    } as any);

    const result = await handler(
      makeEvent({
        httpMethod: "DELETE",
        path: "/ai-agents/agent-custom",
        pathParameters: { aiAgentId: "agent-custom" },
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(deleteAIAgent).toHaveBeenCalledWith("agent-custom");
    expect(parseBody(result).deleted).toBe(true);
  });

  it("should refuse to delete a default agent", async () => {
    vi.mocked(getAIAgentById).mockResolvedValue({
      aiAgentId: "agent-default",
      name: "React UI Developer",
      isDefault: true,
    } as any);

    const result = await handler(
      makeEvent({
        httpMethod: "DELETE",
        path: "/ai-agents/agent-default",
        pathParameters: { aiAgentId: "agent-default" },
      }),
    );

    expect(result.statusCode).toBe(400);
    expect(deleteAIAgent).not.toHaveBeenCalled();
  });

  it("should return 404 for non-existent agent", async () => {
    vi.mocked(getAIAgentById).mockResolvedValue(undefined);

    const result = await handler(
      makeEvent({
        httpMethod: "DELETE",
        path: "/ai-agents/missing",
        pathParameters: { aiAgentId: "missing" },
      }),
    );

    expect(result.statusCode).toBe(404);
    expect(deleteAIAgent).not.toHaveBeenCalled();
  });
});

// ─── POST /ai-agents/generate ───

describe("POST /ai-agents/generate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should generate an agent from a prompt via Bedrock", async () => {
    const result = await handler(
      makeEvent({
        httpMethod: "POST",
        path: "/ai-agents/generate",
        body: JSON.stringify({
          prompt: "Create an agent for Vue.js development",
          category: "ui_frontend",
        }),
      }),
    );

    expect(result.statusCode).toBe(201);
    expect(createAIAgent).toHaveBeenCalledTimes(1);

    const body = parseBody(result);
    expect(body.name).toBe("test-agent");
    expect(body.category).toBe("ui_frontend");
    expect(body.isDefault).toBe(false);
    expect(body.createdBy).toBe("user-123");
    expect(body.kiroConfig).toBeDefined();
    expect(body.kiroConfig.tools).toEqual(["*"]);
  });

  it("should reject empty prompt", async () => {
    const result = await handler(
      makeEvent({
        httpMethod: "POST",
        path: "/ai-agents/generate",
        body: JSON.stringify({ prompt: "" }),
      }),
    );

    expect(result.statusCode).toBe(400);
    expect(createAIAgent).not.toHaveBeenCalled();
  });

  it("should default category to custom when not specified", async () => {
    const result = await handler(
      makeEvent({
        httpMethod: "POST",
        path: "/ai-agents/generate",
        body: JSON.stringify({
          prompt: "Build me a general-purpose agent",
        }),
      }),
    );

    expect(result.statusCode).toBe(201);
    const body = parseBody(result);
    expect(body.category).toBe("custom");
  });
});

// ─── POST /ai-agents/refine-prompt ───

describe("POST /ai-agents/refine-prompt", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should refine a user prompt", async () => {
    const result = await handler(
      makeEvent({
        httpMethod: "POST",
        path: "/ai-agents/refine-prompt",
        body: JSON.stringify({
          prompt: "make me a react agent",
        }),
      }),
    );

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.original).toBe("make me a react agent");
    expect(body.refined).toBeDefined();
  });

  it("should reject empty prompt", async () => {
    const result = await handler(
      makeEvent({
        httpMethod: "POST",
        path: "/ai-agents/refine-prompt",
        body: JSON.stringify({ prompt: "   " }),
      }),
    );

    expect(result.statusCode).toBe(400);
  });
});

// ─── Route Not Found ───

describe("Route handling", () => {
  it("should return 404 for unknown routes", async () => {
    const result = await handler(
      makeEvent({
        httpMethod: "PUT",
        path: "/ai-agents/unknown-route",
      }),
    );

    expect(result.statusCode).toBe(404);
  });
});
