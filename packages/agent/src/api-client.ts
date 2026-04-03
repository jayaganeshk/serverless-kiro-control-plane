import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import type { ApiResponse } from "@remote-kiro/common";

// ─── Retry Configuration ───

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const RETRYABLE_NETWORK_ERRORS = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
]);

// ─── Types ───

export interface ClaimJobData {
  agentId: string;
}

export interface UpdateJobStatusData {
  status: string;
  stage?: string;
  prNumber?: number;
  prUrl?: string;
  commitSha?: string;
}

export interface PostJobEventData {
  eventType: string;
  message: string;
  stage?: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactPresignData {
  artifactType: string;
  filename: string;
  contentType?: string;
}

export interface FailJobData {
  errorMessage: string;
  errorCode?: string;
  stage?: string;
}

export interface RegisterAgentData {
  machineId: string;
  machineLabel: string;
  capabilities?: string[];
  repoAllowlist?: string[];
  workspaceRoot: string;
  maxConcurrentJobs?: number;
  agentVersion?: string;
  machine?: import("@remote-kiro/common").AgentMachineInfo;
}

export interface ArtifactPresignResponse {
  artifactId: string;
  uploadUrl: string;
  s3Key: string;
}

// ─── Helpers ───

function isRetryableNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && err.message === "fetch failed") {
    return true;
  }
  const code = (err as NodeJS.ErrnoException).code;
  if (code && RETRYABLE_NETWORK_ERRORS.has(code)) {
    return true;
  }
  // Check cause chain for network errors
  const cause = (err as { cause?: unknown }).cause;
  if (cause) {
    return isRetryableNetworkError(cause);
  }
  return false;
}

function isRetryableStatusCode(status: number): boolean {
  return status >= 500 && status < 600;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── BackendApiClient ───

export class BackendApiClient {
  private readonly baseUrl: string;
  private readonly signer: SignatureV4;
  private readonly region: string;
  private readonly skipSigning: boolean;

  constructor(backendApiUrl: string, region?: string) {
    const isLocal = backendApiUrl.startsWith("http://localhost") ||
                    backendApiUrl.startsWith("http://127.0.0.1");

    if (!backendApiUrl.startsWith("https://") && !isLocal) {
      throw new Error(
        "Backend API URL must use HTTPS (or http://localhost for local dev). Received: " + backendApiUrl,
      );
    }

    this.skipSigning = isLocal;

    // Strip trailing slash
    this.baseUrl = backendApiUrl.replace(/\/+$/, "");
    this.region = region ?? process.env.AWS_REGION ?? "us-east-1";

    this.signer = new SignatureV4({
      service: "execute-api",
      region: this.region,
      credentials: defaultProvider(),
      sha256: Sha256,
    });
  }

  // ─── Core request method ───

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    // Concatenate directly — new URL(path, base) strips the stage prefix
    // e.g. new URL("/agents/register", "https://host/dev") → "https://host/agents/register" (wrong)
    const url = new URL(this.baseUrl + path);

    const headers: Record<string, string> = {
      host: url.hostname,
      "content-type": "application/json",
    };

    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

    let fetchHeaders: Record<string, string>;

    if (this.skipSigning) {
      fetchHeaders = { ...headers };
    } else {
      const httpRequest = new HttpRequest({
        method,
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: url.pathname,
        headers,
        body: bodyStr,
      });

      const signed = await this.signer.sign(httpRequest);
      fetchHeaders = {};
      for (const [key, value] of Object.entries(signed.headers)) {
        fetchHeaders[key] = value;
      }
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url.toString(), {
          method,
          headers: fetchHeaders,
          body: bodyStr,
        });

        if (isRetryableStatusCode(response.status) && attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }

        const responseBody = (await response.json()) as ApiResponse<T>;

        if (!response.ok) {
          const errMsg =
            responseBody.error?.message ?? `HTTP ${response.status}`;
          const err = new ApiClientError(errMsg, response.status, responseBody);
          throw err;
        }

        return responseBody;
      } catch (err) {
        lastError = err;

        // Don't retry client errors (4xx) — they're wrapped in ApiClientError
        if (err instanceof ApiClientError) {
          throw err;
        }

        // Retry on network errors
        if (isRetryableNetworkError(err) && attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }

        // Non-retryable error or exhausted retries
        if (attempt >= MAX_RETRIES) {
          break;
        }

        throw err;
      }
    }

    throw lastError;
  }

  // ─── Agent Registration ───

  async registerAgent(data: RegisterAgentData): Promise<ApiResponse> {
    return this.request("POST", "/agents/register", data);
  }

  // ─── Agent Heartbeat ───

  async sendHeartbeat(agentId: string): Promise<ApiResponse> {
    return this.request("POST", `/agents/${agentId}/heartbeat`);
  }

  // ─── Get Job ───

  async getJob(jobId: string): Promise<ApiResponse> {
    return this.request("GET", `/jobs/${jobId}`);
  }

  // ─── Job Claim ───

  async claimJob(
    jobId: string,
    agentId: string,
  ): Promise<ApiResponse> {
    return this.request("POST", `/jobs/${jobId}/claim`, { agentId });
  }

  // ─── Job Status Update ───

  async updateJobStatus(
    jobId: string,
    data: UpdateJobStatusData,
  ): Promise<ApiResponse> {
    return this.request("PATCH", `/jobs/${jobId}/status`, data);
  }

  // ─── Post Job Event ───

  async postJobEvent(
    jobId: string,
    data: PostJobEventData,
  ): Promise<ApiResponse> {
    return this.request("POST", `/jobs/${jobId}/events`, data);
  }

  // ─── Request Artifact Presign ───

  async requestArtifactPresign(
    jobId: string,
    data: ArtifactPresignData,
  ): Promise<ApiResponse<ArtifactPresignResponse>> {
    return this.request<ArtifactPresignResponse>(
      "POST",
      `/jobs/${jobId}/artifacts/presign`,
      data,
    );
  }

  // ─── Complete Job ───

  async completeJob(jobId: string): Promise<ApiResponse> {
    return this.request("POST", `/jobs/${jobId}/complete`);
  }

  // ─── Fail Job ───

  async failJob(jobId: string, data: FailJobData): Promise<ApiResponse> {
    return this.request("POST", `/jobs/${jobId}/fail`, data);
  }

  // ─── Get Spec ───

  async getSpec(jobId: string): Promise<ApiResponse> {
    return this.request("GET", `/worker/jobs/${jobId}/spec`);
  }

  // ─── Update Spec Phase (agent submits generated spec data) ───

  async updateSpec(
    jobId: string,
    data: { phase: string; status: string; items: Array<{ id: string; content: string; completed?: boolean }> },
  ): Promise<ApiResponse> {
    return this.request("PATCH", `/jobs/${jobId}/spec`, data);
  }

  // ─── Get Git Credential ───

  async getCredential(jobId: string): Promise<ApiResponse> {
    return this.request("GET", `/jobs/${jobId}/credential`);
  }

  // ─── Get AI Agent Config ───

  async getAIAgentConfig(aiAgentId: string): Promise<ApiResponse> {
    return this.request("GET", `/worker/ai-agents/${aiAgentId}`);
  }

  // ─── Store review report on parent job ───

  async storeReviewData(
    reviewJobId: string,
    parentJobId: string,
    reviewReport: string,
    reviewOutcome: string,
  ): Promise<ApiResponse> {
    return this.request("PATCH", `/jobs/${reviewJobId}/review-data`, {
      parentJobId,
      reviewReport,
      reviewOutcome,
    });
  }
}

// ─── ApiClientError ───

export class ApiClientError extends Error {
  public readonly statusCode: number;
  public readonly response: ApiResponse;

  constructor(message: string, statusCode: number, response: ApiResponse) {
    super(message);
    this.name = "ApiClientError";
    this.statusCode = statusCode;
    this.response = response;
  }
}
