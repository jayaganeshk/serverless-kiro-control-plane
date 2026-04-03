import { describe, it, expect, vi, beforeEach } from "vitest";
import { JobPipeline, type StageRunner } from "./pipeline";
import { JobStatus } from "@remote-kiro/common";
import type { SQSJobMessage, ImplementFeatureMessage, ReviewPRMessage } from "@remote-kiro/common";

// ─── Mock Factories ───

function makeFeatureMessage(overrides: Partial<ImplementFeatureMessage> = {}): ImplementFeatureMessage {
  return {
    messageType: "implement_feature",
    jobId: "job-1",
    jobType: "implement_feature",
    repoId: "repo-1",
    repoUrl: "https://github.com/test/repo",
    baseBranch: "main",
    workBranch: "feature/test",
    profileId: "profile-1",
    bundleVersion: 1,
    manifest: null,
    requestedBy: "user-1",
    title: "Test feature",
    description: "Test feature description",
    constraints: null,
    aiAgentId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeReviewMessage(overrides: Partial<ReviewPRMessage> = {}): ReviewPRMessage {
  return {
    messageType: "review_pr",
    jobId: "job-2",
    jobType: "review_pr",
    parentJobId: "job-1",
    repoId: "repo-1",
    repoUrl: "https://github.com/test/repo",
    baseBranch: "main",
    workBranch: "feature/test",
    profileId: "profile-2",
    bundleVersion: 1,
    prNumber: 42,
    prUrl: "https://github.com/test/repo/pull/42",
    aiAgentId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockApiClient() {
  return {
    claimJob: vi.fn(async () => ({ data: {} })),
    updateJobStatus: vi.fn(async () => ({ data: {} })),
    getJob: vi.fn(async () => ({ data: { status: JobStatus.RUNNING } })),
    completeJob: vi.fn(async () => ({ data: {} })),
    failJob: vi.fn(async () => ({ data: {} })),
    postJobEvent: vi.fn(async () => ({ data: {} })),
  };
}

function createMockPoller() {
  return {
    incrementJobCount: vi.fn(),
    decrementJobCount: vi.fn(),
    deleteMessage: vi.fn(async () => {}),
  };
}

function createMockEventBuffer() {
  return {
    bufferEvent: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
    getBufferSize: vi.fn(() => 0),
  };
}

function makeStage(name: string, runFn?: () => Promise<void>): StageRunner {
  return {
    name,
    run: vi.fn(runFn ?? (async () => {})),
  };
}

// ─── Tests ───

describe("JobPipeline", () => {
  let apiClient: ReturnType<typeof createMockApiClient>;
  let poller: ReturnType<typeof createMockPoller>;
  let eventBuffer: ReturnType<typeof createMockEventBuffer>;
  let pipeline: JobPipeline;

  beforeEach(() => {
    apiClient = createMockApiClient();
    poller = createMockPoller();
    eventBuffer = createMockEventBuffer();
    pipeline = new JobPipeline({
      apiClient: apiClient as any,
      poller: poller as any,
      eventBuffer: eventBuffer as any,
      agentId: "agent-1",
    });
  });

  // ── Happy path ──

  it("should claim, set RUNNING, run stages, complete, and delete message", async () => {
    const message = makeFeatureMessage();
    const stages = [makeStage("VALIDATING_REPO"), makeStage("PREPARING_WORKSPACE")];

    await pipeline.run(message, "receipt-1", stages);

    // Claim
    expect(apiClient.claimJob).toHaveBeenCalledWith("job-1", "agent-1");
    // Set RUNNING
    expect(apiClient.updateJobStatus).toHaveBeenCalledWith("job-1", {
      status: JobStatus.RUNNING,
    });
    // Stages ran
    expect(stages[0].run).toHaveBeenCalledWith("job-1", message);
    expect(stages[1].run).toHaveBeenCalledWith("job-1", message);
    // Stage transition events posted
    expect(eventBuffer.bufferEvent).toHaveBeenCalledTimes(2);
    // Complete
    expect(apiClient.completeJob).toHaveBeenCalledWith("job-1");
    // Delete message
    expect(poller.deleteMessage).toHaveBeenCalledWith("receipt-1");
    // Job count management
    expect(poller.incrementJobCount).toHaveBeenCalledTimes(1);
    expect(poller.decrementJobCount).toHaveBeenCalledTimes(1);
  });

  // ── Claim 409 conflict ──

  it("should delete SQS message and skip on claim 409", async () => {
    const claimError = Object.assign(new Error("Already claimed"), {
      name: "ApiClientError",
      statusCode: 409,
      response: { error: { code: "CONFLICT", message: "Already claimed" } },
    });
    // Make it an instance-like check by using the actual class
    const { ApiClientError } = await import("./api-client.js");
    apiClient.claimJob.mockRejectedValueOnce(
      new ApiClientError("Already claimed", 409, {
        error: { code: "CONFLICT", message: "Already claimed" },
      }),
    );

    const message = makeFeatureMessage();
    const stages = [makeStage("VALIDATING_REPO")];

    await pipeline.run(message, "receipt-1", stages);

    // Should delete message
    expect(poller.deleteMessage).toHaveBeenCalledWith("receipt-1");
    // Should NOT run stages
    expect(stages[0].run).not.toHaveBeenCalled();
    // Should NOT set RUNNING or complete
    expect(apiClient.updateJobStatus).not.toHaveBeenCalled();
    expect(apiClient.completeJob).not.toHaveBeenCalled();
    // Job count still managed
    expect(poller.incrementJobCount).toHaveBeenCalledTimes(1);
    expect(poller.decrementJobCount).toHaveBeenCalledTimes(1);
  });

  // ── Stage failure ──

  it("should fail the job and delete message when a stage throws", async () => {
    const stages = [
      makeStage("VALIDATING_REPO"),
      makeStage("PREPARING_WORKSPACE", async () => {
        throw new Error("Clone failed");
      }),
    ];

    const message = makeFeatureMessage();
    await pipeline.run(message, "receipt-1", stages);

    // First stage ran
    expect(stages[0].run).toHaveBeenCalled();
    // Second stage ran and threw
    expect(stages[1].run).toHaveBeenCalled();
    // Job failed
    expect(apiClient.failJob).toHaveBeenCalledWith("job-1", {
      errorMessage: "Clone failed",
      errorCode: "STAGE_FAILURE",
    });
    // Message deleted on failure (terminal status)
    expect(poller.deleteMessage).toHaveBeenCalledWith("receipt-1");
    // Not completed
    expect(apiClient.completeJob).not.toHaveBeenCalled();
    // Job count decremented
    expect(poller.decrementJobCount).toHaveBeenCalledTimes(1);
  });

  // ── Cancellation check ──

  it("should stop processing and delete message if job is cancelled", async () => {
    // First getJob call returns RUNNING, second returns CANCELLED
    apiClient.getJob
      .mockResolvedValueOnce({ data: { status: JobStatus.RUNNING } })
      .mockResolvedValueOnce({ data: { status: JobStatus.CANCELLED } });

    const stages = [
      makeStage("VALIDATING_REPO"),
      makeStage("PREPARING_WORKSPACE"),
      makeStage("APPLYING_BUNDLE"),
    ];

    const message = makeFeatureMessage();
    await pipeline.run(message, "receipt-1", stages);

    // First stage ran (checked before, was RUNNING)
    expect(stages[0].run).toHaveBeenCalled();
    // Second stage should NOT run (checked before, was CANCELLED)
    expect(stages[1].run).not.toHaveBeenCalled();
    expect(stages[2].run).not.toHaveBeenCalled();
    // Message deleted
    expect(poller.deleteMessage).toHaveBeenCalledWith("receipt-1");
    // Not completed or failed
    expect(apiClient.completeJob).not.toHaveBeenCalled();
    expect(apiClient.failJob).not.toHaveBeenCalled();
  });

  // ── Timeout self-termination ──

  it("should fail the job with timeout when max duration exceeded", async () => {
    // Use vi.spyOn to control Date.now
    let now = 1000;
    const dateNowSpy = vi.spyOn(Date, "now");
    // First call: start time
    dateNowSpy.mockReturnValueOnce(now);
    // getJob check before stage 1: not cancelled
    // elapsed check before stage 1: within limit
    dateNowSpy.mockReturnValueOnce(now + 100);
    // getJob check before stage 2: not cancelled
    // elapsed check before stage 2: over 30 min limit
    dateNowSpy.mockReturnValueOnce(now + 31 * 60 * 1000);

    const stages = [
      makeStage("VALIDATING_REPO"),
      makeStage("PREPARING_WORKSPACE"),
    ];

    const message = makeFeatureMessage();
    await pipeline.run(message, "receipt-1", stages);

    // First stage ran
    expect(stages[0].run).toHaveBeenCalled();
    // Second stage did NOT run (timed out)
    expect(stages[1].run).not.toHaveBeenCalled();
    // Job failed with timeout
    expect(apiClient.failJob).toHaveBeenCalledWith("job-1", {
      errorMessage: "Job exceeded maximum duration at stage: PREPARING_WORKSPACE",
      errorCode: "JOB_TIMEOUT",
      stage: "PREPARING_WORKSPACE",
    });
    // Message deleted
    expect(poller.deleteMessage).toHaveBeenCalledWith("receipt-1");

    dateNowSpy.mockRestore();
  });

  // ── Review job uses 15 min timeout ──

  it("should use 15 minute max duration for review jobs", async () => {
    let now = 1000;
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy.mockReturnValueOnce(now); // start time
    dateNowSpy.mockReturnValueOnce(now + 100); // first elapsed check (within limit)
    dateNowSpy.mockReturnValueOnce(now + 16 * 60 * 1000); // second elapsed check (over 15 min)

    const stages = [
      makeStage("FETCHING_PR"),
      makeStage("PREPARING_DIFF"),
    ];

    const message = makeReviewMessage();
    await pipeline.run(message, "receipt-1", stages);

    expect(stages[0].run).toHaveBeenCalled();
    expect(stages[1].run).not.toHaveBeenCalled();
    expect(apiClient.failJob).toHaveBeenCalledWith("job-2", {
      errorMessage: "Job exceeded maximum duration at stage: PREPARING_DIFF",
      errorCode: "JOB_TIMEOUT",
      stage: "PREPARING_DIFF",
    });

    dateNowSpy.mockRestore();
  });

  // ── Always decrements job count ──

  it("should decrement job count even when claim fails with non-409 error", async () => {
    apiClient.claimJob.mockRejectedValueOnce(new Error("Network error"));

    const message = makeFeatureMessage();
    await pipeline.run(message, "receipt-1", []);

    expect(poller.incrementJobCount).toHaveBeenCalledTimes(1);
    expect(poller.decrementJobCount).toHaveBeenCalledTimes(1);
  });

  // ── Stage transition events ──

  it("should post stage transition events for each stage", async () => {
    const stages = [
      makeStage("VALIDATING_REPO"),
      makeStage("PREPARING_WORKSPACE"),
      makeStage("APPLYING_BUNDLE"),
    ];

    const message = makeFeatureMessage();
    await pipeline.run(message, "receipt-1", stages);

    expect(eventBuffer.bufferEvent).toHaveBeenCalledTimes(3);
    expect(eventBuffer.bufferEvent).toHaveBeenCalledWith("job-1", {
      eventType: "stage_transition",
      message: "Entering stage: VALIDATING_REPO",
      stage: "VALIDATING_REPO",
    });
    expect(eventBuffer.bufferEvent).toHaveBeenCalledWith("job-1", {
      eventType: "stage_transition",
      message: "Entering stage: PREPARING_WORKSPACE",
      stage: "PREPARING_WORKSPACE",
    });
    expect(eventBuffer.bufferEvent).toHaveBeenCalledWith("job-1", {
      eventType: "stage_transition",
      message: "Entering stage: APPLYING_BUNDLE",
      stage: "APPLYING_BUNDLE",
    });
  });

  // ── Error code propagation ──

  it("should propagate error code from errors that have a code property", async () => {
    const codedError = Object.assign(new Error("ACP crashed"), {
      code: "KIRO_ACP_CRASH",
    });
    const stages = [
      makeStage("RUNNING_KIRO", async () => {
        throw codedError;
      }),
    ];

    const message = makeFeatureMessage();
    await pipeline.run(message, "receipt-1", stages);

    expect(apiClient.failJob).toHaveBeenCalledWith("job-1", {
      errorMessage: "ACP crashed",
      errorCode: "KIRO_ACP_CRASH",
    });
  });

  // ── failJob failure is swallowed ──

  it("should still delete message even if failJob call fails", async () => {
    apiClient.failJob.mockRejectedValueOnce(new Error("Network error"));
    const stages = [
      makeStage("VALIDATING_REPO", async () => {
        throw new Error("Stage error");
      }),
    ];

    const message = makeFeatureMessage();
    await pipeline.run(message, "receipt-1", stages);

    // Message still deleted
    expect(poller.deleteMessage).toHaveBeenCalledWith("receipt-1");
    expect(poller.decrementJobCount).toHaveBeenCalledTimes(1);
  });

  // ── Cancellation check network failure ──

  it("should continue processing if cancellation check fails due to network error", async () => {
    apiClient.getJob.mockRejectedValue(new Error("Network error"));

    const stages = [makeStage("VALIDATING_REPO"), makeStage("PREPARING_WORKSPACE")];
    const message = makeFeatureMessage();
    await pipeline.run(message, "receipt-1", stages);

    // Both stages should run since cancellation check failure defaults to not-cancelled
    expect(stages[0].run).toHaveBeenCalled();
    expect(stages[1].run).toHaveBeenCalled();
    expect(apiClient.completeJob).toHaveBeenCalled();
  });
});
