// ─── API Client ───
// Fetch wrapper with JWT injection, error handling, and response envelope parsing

import type { ApiResponse, Repository, Profile, Job, JobEvent, Artifact, JobSpec, SpecItem, Agent, GitCredential, AIAgentConfig, AIAgentCategory, KiroAgentConfig } from "@remote-kiro/common";
import { getValidToken, login } from "./auth";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

// ─── Error Types ───

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Core Fetch ───

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getValidToken();
  if (!token) {
    // No valid token — redirect to login
    await login();
    throw new ApiError(401, "UNAUTHENTICATED", "No valid token available");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    // Token rejected by backend — force re-login
    await login();
    throw new ApiError(401, "UNAUTHENTICATED", "Token rejected by server");
  }

  const envelope = (await response.json()) as ApiResponse<T>;

  if (!response.ok || envelope.error) {
    throw new ApiError(
      response.status,
      envelope.error?.code ?? "UNKNOWN",
      envelope.error?.message ?? `Request failed with status ${response.status}`,
    );
  }

  return envelope.data as T;
}

// ─── Paginated Fetch ───

interface PaginatedResult<T> {
  items: T[];
  nextToken: string | null;
}

async function paginatedRequest<T>(method: string, path: string, params?: Record<string, string>): Promise<PaginatedResult<T>> {
  const token = await getValidToken();
  if (!token) {
    await login();
    throw new ApiError(401, "UNAUTHENTICATED", "No valid token available");
  }

  let fetchUrl = `${API_BASE}${path}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) searchParams.set(k, v);
    }
    const qs = searchParams.toString();
    if (qs) fetchUrl += `?${qs}`;
  }

  const response = await fetch(fetchUrl, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401) {
    await login();
    throw new ApiError(401, "UNAUTHENTICATED", "Token rejected by server");
  }

  const envelope = (await response.json()) as ApiResponse<T[]>;

  if (!response.ok || envelope.error) {
    throw new ApiError(
      response.status,
      envelope.error?.code ?? "UNKNOWN",
      envelope.error?.message ?? `Request failed with status ${response.status}`,
    );
  }

  return {
    items: envelope.data ?? [],
    nextToken: envelope.pagination?.nextToken ?? null,
  };
}

// ─── Repository Endpoints ───

export const repositories = {
  list: (nextToken?: string) =>
    paginatedRequest<Repository>("GET", "/repositories", nextToken ? { nextToken } : undefined),

  get: (repoId: string) =>
    request<Repository>("GET", `/repositories/${repoId}`),

  create: (data: { name: string; url: string; defaultBranch: string; defaultFeatureProfileId: string; autoReviewEnabled?: boolean }) =>
    request<Repository>("POST", "/repositories", data),

  update: (repoId: string, data: Partial<Pick<Repository, "defaultBranch" | "defaultFeatureProfileId" | "defaultReviewProfileId" | "autoReviewEnabled" | "status">>) =>
    request<Repository>("PATCH", `/repositories/${repoId}`, data),

  getCredential: (repoId: string) =>
    request<GitCredential>("GET", `/repositories/${repoId}/credential`),

  putCredential: (repoId: string, data: { credentialType: string; username?: string; token?: string; sshPrivateKey?: string }) =>
    request<GitCredential>("PUT", `/repositories/${repoId}/credential`, data),

  deleteCredential: (repoId: string) =>
    request<void>("DELETE", `/repositories/${repoId}/credential`),
};

// ─── Profile Endpoints ───

export const profiles = {
  list: () =>
    paginatedRequest<Profile>("GET", "/profiles"),

  get: (profileId: string) =>
    request<Profile>("GET", `/profiles/${profileId}`),

  create: (data: { name: string; profileType: "feature" | "reviewer"; description: string; manifest?: Record<string, unknown> | null }) =>
    request<Profile>("POST", "/profiles", data),

  update: (profileId: string, data: Partial<Pick<Profile, "name" | "description" | "manifest">>) =>
    request<Profile>("PATCH", `/profiles/${profileId}`, data),

  publishBundle: (profileId: string, bundle: File) =>
    uploadBundle(profileId, bundle),
};

async function uploadBundle(profileId: string, bundle: File): Promise<Profile> {
  const token = await getValidToken();
  if (!token) {
    await login();
    throw new ApiError(401, "UNAUTHENTICATED", "No valid token available");
  }

  // Convert File to base64 string for JSON body
  const arrayBuffer = await bundle.arrayBuffer();
  const base64 = btoa(
    new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
  );

  const response = await fetch(`${API_BASE}/profiles/${profileId}/publish-bundle`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bundle: base64 }),
  });

  const envelope = (await response.json()) as ApiResponse<Profile>;

  if (!response.ok || envelope.error) {
    throw new ApiError(
      response.status,
      envelope.error?.code ?? "UNKNOWN",
      envelope.error?.message ?? "Bundle upload failed",
    );
  }

  return envelope.data as Profile;
}

// ─── Job Endpoints ───

export const jobs = {
  list: (params?: { status?: string; nextToken?: string }) =>
    paginatedRequest<Job>("GET", "/jobs", params),

  get: (jobId: string) =>
    request<Job>("GET", `/jobs/${jobId}`),

  create: (data: {
    jobType: "implement_feature";
    repoId: string;
    branch?: string;
    profileId: string;
    description: string;
    constraints?: string;
    aiAgentId?: string;
  }) => request<Job>("POST", "/jobs", data),

  cancel: (jobId: string) =>
    request<void>("POST", `/jobs/${jobId}/cancel`),

  getEvents: (jobId: string) =>
    paginatedRequest<JobEvent>("GET", `/jobs/${jobId}/events`),

  getArtifacts: (jobId: string) =>
    paginatedRequest<Artifact & { downloadUrl?: string }>("GET", `/jobs/${jobId}/artifacts`),

  getSpec: (jobId: string) =>
    request<JobSpec>("GET", `/jobs/${jobId}/spec`),

  approveSpecPhase: (jobId: string, phase: string) =>
    request<JobSpec>("POST", `/jobs/${jobId}/spec/approve`, { phase }),

  rejectSpecPhase: (jobId: string, phase: string, reason: string) =>
    request<JobSpec>("POST", `/jobs/${jobId}/spec/reject`, { phase, reason }),

  updateSpecItems: (jobId: string, phase: string, items: SpecItem[]) =>
    request<JobSpec>("PATCH", `/jobs/${jobId}/spec/items`, { phase, items }),

  postPhaseMessage: (jobId: string, phase: string, message: string) =>
    request<{ posted: boolean; regenerating?: boolean }>("POST", `/jobs/${jobId}/spec/messages`, { phase, message }),

  getPhaseMessages: (jobId: string, phase: string) =>
    paginatedRequest<{ messageId: string; message: string; sender: string; createdAt: string }>(
      "GET",
      `/jobs/${jobId}/spec/messages`,
      { phase },
    ),

  triggerReview: (jobId: string, aiAgentId?: string) =>
    request<{ reviewJobId: string; message: string }>("POST", `/jobs/${jobId}/review`, aiAgentId ? { aiAgentId } : {}),

  triggerReviewFix: (jobId: string) =>
    request<{ fixJobId: string; message: string }>("POST", `/jobs/${jobId}/review/fix`),
};

// ─── Agent Endpoints ───

export const agents = {
  list: () =>
    paginatedRequest<Agent>("GET", "/agents"),
};

// ─── AI Agent Endpoints ───

export interface McpRegistryEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  relevantFor: string[];
  tools: string[];
}

export interface McpSuggestion {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  reason: string;
  priority: "high" | "medium" | "low";
  isCustom: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  tools?: string[];
}

export const aiAgents = {
  list: () =>
    paginatedRequest<AIAgentConfig>("GET", "/ai-agents"),

  get: (aiAgentId: string) =>
    request<AIAgentConfig>("GET", `/ai-agents/${aiAgentId}`),

  create: (data: { name: string; category: AIAgentCategory; description: string; kiroConfig: KiroAgentConfig }) =>
    request<AIAgentConfig>("POST", "/ai-agents", data),

  update: (aiAgentId: string, data: Partial<Pick<AIAgentConfig, "name" | "category" | "description" | "kiroConfig">>) =>
    request<AIAgentConfig>("PATCH", `/ai-agents/${aiAgentId}`, data),

  delete: (aiAgentId: string) =>
    request<{ deleted: boolean }>("DELETE", `/ai-agents/${aiAgentId}`),

  generate: (prompt: string, category?: AIAgentCategory) =>
    request<AIAgentConfig>("POST", "/ai-agents/generate", { prompt, category: category ?? "custom" }),

  refinePrompt: (prompt: string) =>
    request<{ original: string; refined: string }>("POST", "/ai-agents/refine-prompt", { prompt }),

  mcpRegistry: () =>
    request<McpRegistryEntry[]>("GET", "/ai-agents/mcp-registry"),

  suggestMcp: (description: string, category?: string, currentMcpIds?: string[]) =>
    request<{ suggestions: McpSuggestion[]; registry: McpRegistryEntry[] }>(
      "POST", "/ai-agents/suggest-mcp",
      { description, category, currentMcpIds },
    ),
};

// ─── Bedrock Text Improvement ───

export const bedrock = {
  improveText: (text: string, field: "description" | "constraints") =>
    request<{ original: string; improved: string; field: string }>("POST", "/improve-text", { text, field }),
};

// ─── API Client (aggregated export) ───

export const apiClient = {
  repositories,
  profiles,
  jobs,
  agents,
  aiAgents,
  bedrock,
};
