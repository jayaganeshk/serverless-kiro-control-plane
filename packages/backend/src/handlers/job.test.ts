import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";

// ─── Mocks ───

vi.mock("../middleware/auth.js", () => ({
  validateCognitoJwt: vi.fn().mockResolvedValue("user-123"),
}));

vi.mock("../db/jobs.js", () => ({
  createJob: vi.fn(),
  getJobById: vi.fn(),
  listJobsByUser: vi.fn(),
  transitionJobStatus: vi.fn(),
}));

vi.mock("../state-machine.js", () => ({
  validateTransition: vi.fn(),
  isTerminalStatus: vi.fn(),
}));

vi.mock("../db/job-events.js", () => ({
  createJobEvent: vi.fn(),
  listJobEvents: vi.fn(),
}));

vi.mock("../db/artifacts.js", () => ({
  listArtifactsByJob: vi.fn(),
}));

vi.mock("../db/repositories.js", () => ({
  getRepositoryById: vi.fn(),
}));

vi.mock("../db/profiles.js", () => ({
  getProfileById: vi.fn(),
}));

vi.mock("../sqs/publisher.js", () => ({
  publishImplementFeature: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {}
  class MockGetObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  return { S3Client: MockS3Client, GetObjectCommand: MockGetObjectCommand };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://s3.example.com/presigned-url"),
}));

import { handler } from "./job.js";
import { getJobById, listJobsByUser, transitionJobStatus } from "../db/jobs.js";
import { createJobEvent, listJobEvents } from "../db/job-events.js";
import { listArtifactsByJob } from "../db/artifacts.js";
import { validateTransition, isTerminalStatus } from "../state-machine.js";

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: "GET",
    path: "/jobs",
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

describe("GET /jobs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated job list for authenticated user", async () => {
    const jobs = [
      { jobId: "j1", status: "RUNNING", createdAt: "2024-01-02T00:00:00Z" },
      { jobId: "j2", status: "QUEUED", createdAt: "2024-01-01T00:00:00Z" },
    ];
    vi.mocked(listJobsByUser).mockResolvedValue({ items: jobs as any, nextToken: "tok123" });

    const res = await handler(makeEvent());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.pagination.nextToken).toBe("tok123");
  });

  it("passes status filter to listJobsByUser", async () => {
    vi.mocked(listJobsByUser).mockResolvedValue({ items: [], nextToken: null });

    await handler(makeEvent({ queryStringParameters: { status: "RUNNING" } }));

    expect(listJobsByUser).toHaveBeenCalledWith("user-123", {
      status: "RUNNING",
      nextToken: undefined,
    });
  });

  it("passes nextToken to listJobsByUser", async () => {
    vi.mocked(listJobsByUser).mockResolvedValue({ items: [], nextToken: null });

    await handler(makeEvent({ queryStringParameters: { nextToken: "abc" } }));

    expect(listJobsByUser).toHaveBeenCalledWith("user-123", {
      status: undefined,
      nextToken: "abc",
    });
  });
});

describe("GET /jobs/{jobId}", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns full job record when found", async () => {
    const job = { jobId: "j1", status: "RUNNING", title: "Test job" };
    vi.mocked(getJobById).mockResolvedValue(job as any);

    const res = await handler(
      makeEvent({
        path: "/jobs/j1",
        pathParameters: { jobId: "j1" },
      }),
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data.jobId).toBe("j1");
  });

  it("returns 404 when job not found", async () => {
    vi.mocked(getJobById).mockResolvedValue(undefined);

    const res = await handler(
      makeEvent({
        path: "/jobs/nonexistent",
        pathParameters: { jobId: "nonexistent" },
      }),
    );

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("GET /jobs/{jobId}/events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns chronological event list", async () => {
    const events = [
      { jobId: "j1", eventTs: "2024-01-01T00:00:00Z", eventType: "job_created" },
      { jobId: "j1", eventTs: "2024-01-01T00:01:00Z", eventType: "status_change" },
    ];
    vi.mocked(listJobEvents).mockResolvedValue(events as any);

    const res = await handler(
      makeEvent({
        path: "/jobs/j1/events",
        pathParameters: { jobId: "j1" },
      }),
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].eventType).toBe("job_created");
  });
});

describe("GET /jobs/{jobId}/artifacts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns artifacts with presigned download URLs", async () => {
    const artifacts = [
      { jobId: "j1", artifactId: "a1", s3Key: "artifacts/j1/a1/log.txt", artifactType: "log" },
    ];
    vi.mocked(listArtifactsByJob).mockResolvedValue(artifacts as any);

    const res = await handler(
      makeEvent({
        path: "/jobs/j1/artifacts",
        pathParameters: { jobId: "j1" },
      }),
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].artifactId).toBe("a1");
    expect(body.data[0].downloadUrl).toBe("https://s3.example.com/presigned-url");
  });

  it("returns empty array when no artifacts exist", async () => {
    vi.mocked(listArtifactsByJob).mockResolvedValue([]);

    const res = await handler(
      makeEvent({
        path: "/jobs/j1/artifacts",
        pathParameters: { jobId: "j1" },
      }),
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data).toEqual([]);
  });
});

describe("POST /jobs/{jobId}/cancel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cancels a QUEUED job and returns 200", async () => {
    const job = { jobId: "j1", status: "QUEUED", title: "Test job" };
    const cancelledJob = { ...job, status: "CANCELLED", completedAt: "2024-01-01T00:00:00Z" };
    vi.mocked(isTerminalStatus).mockReturnValue(false);
    vi.mocked(getJobById)
      .mockResolvedValueOnce(job as any)
      .mockResolvedValueOnce(cancelledJob as any);
    vi.mocked(transitionJobStatus).mockResolvedValue({ previousStatus: "QUEUED" as any });

    const res = await handler(
      makeEvent({
        httpMethod: "POST",
        path: "/jobs/j1/cancel",
        pathParameters: { jobId: "j1" },
      }),
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data.status).toBe("CANCELLED");
    expect(transitionJobStatus).toHaveBeenCalledWith("j1", "QUEUED", expect.objectContaining({ status: "CANCELLED" }));
    expect(createJobEvent).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "j1",
      eventType: "status_change",
      metadata: expect.objectContaining({ previousStatus: "QUEUED", newStatus: "CANCELLED" }),
    }));
  });

  it("cancels a RUNNING job and returns 200", async () => {
    const job = { jobId: "j2", status: "RUNNING", title: "Running job" };
    const cancelledJob = { ...job, status: "CANCELLED" };
    vi.mocked(isTerminalStatus).mockReturnValue(false);
    vi.mocked(getJobById)
      .mockResolvedValueOnce(job as any)
      .mockResolvedValueOnce(cancelledJob as any);
    vi.mocked(transitionJobStatus).mockResolvedValue({ previousStatus: "RUNNING" as any });

    const res = await handler(
      makeEvent({
        httpMethod: "POST",
        path: "/jobs/j2/cancel",
        pathParameters: { jobId: "j2" },
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(transitionJobStatus).toHaveBeenCalledWith("j2", "RUNNING", expect.objectContaining({ status: "CANCELLED" }));
  });

  it("returns 404 when job not found", async () => {
    vi.mocked(getJobById).mockResolvedValue(undefined);

    const res = await handler(
      makeEvent({
        httpMethod: "POST",
        path: "/jobs/nonexistent/cancel",
        pathParameters: { jobId: "nonexistent" },
      }),
    );

    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when job is in terminal status COMPLETED", async () => {
    const job = { jobId: "j3", status: "COMPLETED", title: "Done job" };
    vi.mocked(getJobById).mockResolvedValue(job as any);
    vi.mocked(isTerminalStatus).mockReturnValue(true);

    const res = await handler(
      makeEvent({
        httpMethod: "POST",
        path: "/jobs/j3/cancel",
        pathParameters: { jobId: "j3" },
      }),
    );

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error.message).toContain("terminal status");
    expect(transitionJobStatus).not.toHaveBeenCalled();
  });

  it("returns 409 when job is in terminal status FAILED", async () => {
    const job = { jobId: "j4", status: "FAILED", title: "Failed job" };
    vi.mocked(getJobById).mockResolvedValue(job as any);
    vi.mocked(isTerminalStatus).mockReturnValue(true);

    const res = await handler(
      makeEvent({
        httpMethod: "POST",
        path: "/jobs/j4/cancel",
        pathParameters: { jobId: "j4" },
      }),
    );

    expect(res.statusCode).toBe(409);
  });
});
