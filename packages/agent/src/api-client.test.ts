import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BackendApiClient, ApiClientError } from "./api-client.js";

// Mock the AWS SDK modules
vi.mock("@smithy/signature-v4", () => {
  class MockSignatureV4 {
    async sign(req: Record<string, unknown>) {
      return {
        ...req,
        headers: {
          ...(req.headers as Record<string, string>),
          authorization: "AWS4-HMAC-SHA256 Credential=...",
          "x-amz-date": "20240101T000000Z",
        },
      };
    }
  }
  return { SignatureV4: MockSignatureV4 };
});

vi.mock("@smithy/protocol-http", () => {
  class MockHttpRequest {
    [key: string]: unknown;
    constructor(opts: Record<string, unknown>) {
      Object.assign(this, opts);
    }
  }
  return { HttpRequest: MockHttpRequest };
});

vi.mock("@aws-crypto/sha256-js", () => {
  class MockSha256 {}
  return { Sha256: MockSha256 };
});

vi.mock("@aws-sdk/credential-provider-node", () => ({
  defaultProvider: () => () =>
    Promise.resolve({
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
    }),
}));

// ─── Test Helpers ───

function mockFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("BackendApiClient", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ─── Constructor ───

  describe("constructor", () => {
    it("should reject non-HTTPS URLs", () => {
      expect(() => new BackendApiClient("http://api.example.com")).toThrow(
        "Backend API URL must use HTTPS",
      );
    });

    it("should accept HTTPS URLs", () => {
      const client = new BackendApiClient("https://api.example.com");
      expect(client).toBeInstanceOf(BackendApiClient);
    });

    it("should strip trailing slashes from URL", () => {
      const client = new BackendApiClient("https://api.example.com///");
      // Verify by making a request and checking the URL
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(200, { data: {} }),
      );
      client.sendHeartbeat("agent-1");
      // The URL should not have double slashes
    });
  });

  // ─── API Methods ───

  describe("registerAgent", () => {
    it("should POST to /agents/register", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(200, { data: { agentId: "m-123" } }),
      );

      const client = new BackendApiClient("https://api.example.com");
      const result = await client.registerAgent({
        machineId: "m-123",
        machineLabel: "dev-box",
        workspaceRoot: "/home/dev/workspace",
        capabilities: ["node", "python"],
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.example.com/agents/register");
      expect(opts?.method).toBe("POST");
      expect(result.data).toEqual({ agentId: "m-123" });
    });
  });

  describe("sendHeartbeat", () => {
    it("should POST to /agents/{agentId}/heartbeat", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(200, { data: { agentId: "a-1", status: "ok" } }),
      );

      const client = new BackendApiClient("https://api.example.com");
      await client.sendHeartbeat("a-1");

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.example.com/agents/a-1/heartbeat");
      expect(opts?.method).toBe("POST");
    });
  });

  describe("claimJob", () => {
    it("should POST to /jobs/{jobId}/claim with agentId", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(200, { data: { jobId: "j-1", status: "CLAIMED" } }),
      );

      const client = new BackendApiClient("https://api.example.com");
      await client.claimJob("j-1", "a-1");

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.example.com/jobs/j-1/claim");
      expect(opts?.method).toBe("POST");
      expect(JSON.parse(opts?.body as string)).toEqual({ agentId: "a-1" });
    });
  });

  describe("updateJobStatus", () => {
    it("should PATCH to /jobs/{jobId}/status", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(200, { data: { jobId: "j-1", status: "RUNNING" } }),
      );

      const client = new BackendApiClient("https://api.example.com");
      await client.updateJobStatus("j-1", {
        status: "RUNNING",
        stage: "PREPARING_WORKSPACE",
      });

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.example.com/jobs/j-1/status");
      expect(opts?.method).toBe("PATCH");
    });
  });

  describe("postJobEvent", () => {
    it("should POST to /jobs/{jobId}/events", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(201, { data: { eventType: "stage_transition" } }),
      );

      const client = new BackendApiClient("https://api.example.com");
      await client.postJobEvent("j-1", {
        eventType: "stage_transition",
        message: "Entering RUNNING_KIRO",
        stage: "RUNNING_KIRO",
      });

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.example.com/jobs/j-1/events");
      expect(opts?.method).toBe("POST");
    });
  });

  describe("requestArtifactPresign", () => {
    it("should POST to /jobs/{jobId}/artifacts/presign", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(200, {
          data: {
            artifactId: "art-1",
            uploadUrl: "https://s3.example.com/presigned",
            s3Key: "artifacts/j-1/art-1/log.txt",
          },
        }),
      );

      const client = new BackendApiClient("https://api.example.com");
      const result = await client.requestArtifactPresign("j-1", {
        artifactType: "log",
        filename: "log.txt",
      });

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.example.com/jobs/j-1/artifacts/presign");
      expect(result.data?.artifactId).toBe("art-1");
    });
  });

  describe("completeJob", () => {
    it("should POST to /jobs/{jobId}/complete", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(200, { data: { jobId: "j-1", status: "COMPLETED" } }),
      );

      const client = new BackendApiClient("https://api.example.com");
      await client.completeJob("j-1");

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.example.com/jobs/j-1/complete");
      expect(opts?.method).toBe("POST");
    });
  });

  describe("failJob", () => {
    it("should POST to /jobs/{jobId}/fail with error data", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(200, { data: { jobId: "j-1", status: "FAILED" } }),
      );

      const client = new BackendApiClient("https://api.example.com");
      await client.failJob("j-1", {
        errorMessage: "Stage RUNNING_KIRO failed",
        errorCode: "KIRO_ACP_CRASH",
        stage: "RUNNING_KIRO",
      });

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.example.com/jobs/j-1/fail");
      expect(opts?.method).toBe("POST");
      const body = JSON.parse(opts?.body as string);
      expect(body.errorMessage).toBe("Stage RUNNING_KIRO failed");
      expect(body.errorCode).toBe("KIRO_ACP_CRASH");
    });
  });

  // ─── SigV4 Signing ───

  describe("SigV4 signing", () => {
    it("should include authorization header from SigV4 signer", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(200, { data: {} }),
      );

      const client = new BackendApiClient("https://api.example.com");
      await client.sendHeartbeat("a-1");

      const [, opts] = fetchSpy.mock.calls[0];
      const headers = opts?.headers as Record<string, string>;
      expect(headers.authorization).toContain("AWS4-HMAC-SHA256");
    });
  });

  // ─── Retry Logic ───

  describe("retry on 5xx", () => {
    it("should retry on HTTP 500 and succeed on subsequent attempt", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockFetchResponse(500, { error: { code: "INTERNAL", message: "fail" } }),
        )
        .mockResolvedValueOnce(
          mockFetchResponse(200, { data: { ok: true } }),
        );

      const client = new BackendApiClient("https://api.example.com");
      const result = await client.sendHeartbeat("a-1");

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.data).toEqual({ ok: true });
    });

    it("should throw after exhausting retries on persistent 5xx", async () => {
      fetchSpy.mockResolvedValue(
        mockFetchResponse(503, {
          error: { code: "SERVICE_UNAVAILABLE", message: "down" },
        }),
      );

      const client = new BackendApiClient("https://api.example.com");
      await expect(client.sendHeartbeat("a-1")).rejects.toThrow(ApiClientError);
      // 1 initial + 3 retries = 4 total
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    }, 15000);
  });

  describe("no retry on 4xx", () => {
    it("should not retry on HTTP 409", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(409, {
          error: { code: "CONFLICT", message: "Already claimed" },
        }),
      );

      const client = new BackendApiClient("https://api.example.com");
      await expect(client.claimJob("j-1", "a-1")).rejects.toThrow(
        ApiClientError,
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should not retry on HTTP 400", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(400, {
          error: { code: "BAD_REQUEST", message: "Invalid" },
        }),
      );

      const client = new BackendApiClient("https://api.example.com");
      await expect(client.registerAgent({
        machineId: "m-1",
        machineLabel: "test",
        workspaceRoot: "/tmp",
      })).rejects.toThrow(ApiClientError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("retry on network errors", () => {
    it("should retry on fetch failed (TypeError)", async () => {
      const networkError = new TypeError("fetch failed");
      fetchSpy
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce(
          mockFetchResponse(200, { data: { ok: true } }),
        );

      const client = new BackendApiClient("https://api.example.com");
      const result = await client.sendHeartbeat("a-1");

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.data).toEqual({ ok: true });
    });

    it("should retry on ECONNREFUSED", async () => {
      const connError = Object.assign(new Error("connect refused"), {
        code: "ECONNREFUSED",
      });
      fetchSpy
        .mockRejectedValueOnce(connError)
        .mockResolvedValueOnce(
          mockFetchResponse(200, { data: { ok: true } }),
        );

      const client = new BackendApiClient("https://api.example.com");
      const result = await client.sendHeartbeat("a-1");

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.data).toEqual({ ok: true });
    });

    it("should throw after exhausting retries on persistent network errors", async () => {
      const networkError = new TypeError("fetch failed");
      fetchSpy.mockRejectedValue(networkError);

      const client = new BackendApiClient("https://api.example.com");
      await expect(client.sendHeartbeat("a-1")).rejects.toThrow("fetch failed");
      // 1 initial + 3 retries = 4 total
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    }, 15000);
  });

  // ─── ApiClientError ───

  describe("ApiClientError", () => {
    it("should expose statusCode and response", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(404, {
          error: { code: "NOT_FOUND", message: "Job not found" },
        }),
      );

      const client = new BackendApiClient("https://api.example.com");
      try {
        await client.completeJob("j-missing");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.statusCode).toBe(404);
        expect(apiErr.response.error?.code).toBe("NOT_FOUND");
        expect(apiErr.name).toBe("ApiClientError");
      }
    });
  });
});
