import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SQSPoller } from "./poller";
import type { SQSJobMessage } from "@remote-kiro/common";

// ─── Helpers ───

function makeMessage(overrides: Partial<SQSJobMessage> = {}): SQSJobMessage {
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
    constraints: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as SQSJobMessage;
}

function createMockSqsClient(responses: unknown[] = []) {
  let callIndex = 0;
  return {
    send: vi.fn(async () => {
      if (callIndex < responses.length) {
        const resp = responses[callIndex];
        callIndex++;
        if (resp instanceof Error) throw resp;
        return resp;
      }
      return { Messages: [] };
    }),
  };
}

// ─── Tests ───

describe("SQSPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should initialize with zero current jobs", () => {
    const poller = new SQSPoller({
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      pollingIntervalMs: 1000,
      maxConcurrentJobs: 2,
      repoAllowlist: [],
      onMessage: vi.fn(),
    });
    expect(poller.getCurrentJobCount()).toBe(0);
  });

  it("should increment and decrement job count", () => {
    const poller = new SQSPoller({
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      pollingIntervalMs: 1000,
      maxConcurrentJobs: 2,
      repoAllowlist: [],
      onMessage: vi.fn(),
    });
    poller.incrementJobCount();
    expect(poller.getCurrentJobCount()).toBe(1);
    poller.incrementJobCount();
    expect(poller.getCurrentJobCount()).toBe(2);
    poller.decrementJobCount();
    expect(poller.getCurrentJobCount()).toBe(1);
  });

  it("should not decrement below zero", () => {
    const poller = new SQSPoller({
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      pollingIntervalMs: 1000,
      maxConcurrentJobs: 2,
      repoAllowlist: [],
      onMessage: vi.fn(),
    });
    poller.decrementJobCount();
    expect(poller.getCurrentJobCount()).toBe(0);
  });

  it("should defer polling when max concurrent jobs reached", async () => {
    const mockClient = createMockSqsClient();
    const poller = new SQSPoller({
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      pollingIntervalMs: 1000,
      maxConcurrentJobs: 1,
      repoAllowlist: [],
      onMessage: vi.fn(),
      sqsClient: mockClient as any,
    });

    poller.incrementJobCount(); // at capacity
    poller.start();

    // Advance past polling interval
    await vi.advanceTimersByTimeAsync(1500);

    // SQS should NOT have been called since we're at capacity
    expect(mockClient.send).not.toHaveBeenCalled();

    poller.stop();
  });

  it("should call SQS ReceiveMessage with long polling when under capacity", async () => {
    const mockClient = createMockSqsClient([{ Messages: [] }]);
    const poller = new SQSPoller({
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      pollingIntervalMs: 1000,
      maxConcurrentJobs: 2,
      repoAllowlist: [],
      onMessage: vi.fn(),
      sqsClient: mockClient as any,
    });

    poller.start();
    // The first poll fires immediately (synchronously calls poll -> receiveAndProcess)
    // We need to flush the microtask queue
    await vi.advanceTimersByTimeAsync(0);

    expect(mockClient.send).toHaveBeenCalledTimes(1);
    const command = (mockClient.send.mock.calls as unknown[][])[0]?.[0] as { input?: unknown } | undefined;
    expect(command?.input).toEqual({
      QueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      WaitTimeSeconds: 20,
      MaxNumberOfMessages: 1,
    });

    poller.stop();
  });

  it("should invoke onMessage with parsed message and receiptHandle", async () => {
    const msg = makeMessage();
    const mockClient = createMockSqsClient([
      {
        Messages: [
          {
            Body: JSON.stringify(msg),
            ReceiptHandle: "receipt-1",
          },
        ],
      },
    ]);
    const onMessage = vi.fn(async () => {});

    const poller = new SQSPoller({
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      pollingIntervalMs: 1000,
      maxConcurrentJobs: 2,
      repoAllowlist: [],
      onMessage,
      sqsClient: mockClient as any,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(msg, "receipt-1");

    poller.stop();
  });

  it("should filter messages by repo allowlist and delete non-matching", async () => {
    const msg = makeMessage({ repoId: "repo-not-allowed" });
    const mockClient = createMockSqsClient([
      {
        Messages: [
          {
            Body: JSON.stringify(msg),
            ReceiptHandle: "receipt-1",
          },
        ],
      },
    ]);
    const onMessage = vi.fn(async () => {});

    const poller = new SQSPoller({
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      pollingIntervalMs: 1000,
      maxConcurrentJobs: 2,
      repoAllowlist: ["repo-1", "repo-2"],
      onMessage,
      sqsClient: mockClient as any,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    // onMessage should NOT have been called
    expect(onMessage).not.toHaveBeenCalled();
    // DeleteMessage should have been called
    expect(mockClient.send).toHaveBeenCalledTimes(2); // ReceiveMessage + DeleteMessage

    poller.stop();
  });

  it("should pass messages through when allowlist is empty", async () => {
    const msg = makeMessage({ repoId: "any-repo" });
    const mockClient = createMockSqsClient([
      {
        Messages: [
          {
            Body: JSON.stringify(msg),
            ReceiptHandle: "receipt-1",
          },
        ],
      },
    ]);
    const onMessage = vi.fn(async () => {});

    const poller = new SQSPoller({
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      pollingIntervalMs: 1000,
      maxConcurrentJobs: 2,
      repoAllowlist: [],
      onMessage,
      sqsClient: mockClient as any,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(onMessage).toHaveBeenCalledTimes(1);

    poller.stop();
  });

  it("should retry after pollingIntervalMs on network error", async () => {
    const mockClient = createMockSqsClient([
      new Error("Network error"),
      { Messages: [] },
    ]);

    const poller = new SQSPoller({
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      pollingIntervalMs: 2000,
      maxConcurrentJobs: 2,
      repoAllowlist: [],
      onMessage: vi.fn(),
      sqsClient: mockClient as any,
    });

    poller.start();
    // First poll fires immediately and hits the error
    await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.send).toHaveBeenCalledTimes(1);

    // After pollingIntervalMs, it should retry
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockClient.send).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it("should delete malformed messages and continue polling", async () => {
    const mockClient = createMockSqsClient([
      {
        Messages: [
          {
            Body: "not-valid-json{{{",
            ReceiptHandle: "receipt-bad",
          },
        ],
      },
    ]);

    const onMessage = vi.fn(async () => {});
    const poller = new SQSPoller({
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      pollingIntervalMs: 1000,
      maxConcurrentJobs: 2,
      repoAllowlist: [],
      onMessage,
      sqsClient: mockClient as any,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    // Should have called ReceiveMessage + DeleteMessage
    expect(mockClient.send).toHaveBeenCalledTimes(2);
    expect(onMessage).not.toHaveBeenCalled();

    poller.stop();
  });

  it("should stop polling when stop() is called", async () => {
    const mockClient = createMockSqsClient([
      { Messages: [] },
      { Messages: [] },
      { Messages: [] },
    ]);

    const poller = new SQSPoller({
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      pollingIntervalMs: 500,
      maxConcurrentJobs: 2,
      repoAllowlist: [],
      onMessage: vi.fn(),
      sqsClient: mockClient as any,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.send).toHaveBeenCalledTimes(1);

    poller.stop();

    // Advance well past multiple intervals — no more calls should happen
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockClient.send).toHaveBeenCalledTimes(1);
  });

  it("should be idempotent on start()", () => {
    const mockClient = createMockSqsClient();
    const poller = new SQSPoller({
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      pollingIntervalMs: 1000,
      maxConcurrentJobs: 2,
      repoAllowlist: [],
      onMessage: vi.fn(),
      sqsClient: mockClient as any,
    });

    poller.start();
    poller.start(); // second call should be a no-op
    poller.stop();
  });

  it("should resume polling after concurrency drops below max", async () => {
    const msg = makeMessage();
    const mockClient = createMockSqsClient([
      // First poll deferred (at capacity), second poll succeeds
      {
        Messages: [
          { Body: JSON.stringify(msg), ReceiptHandle: "receipt-1" },
        ],
      },
    ]);
    const onMessage = vi.fn(async () => {});

    const poller = new SQSPoller({
      sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      pollingIntervalMs: 500,
      maxConcurrentJobs: 1,
      repoAllowlist: [],
      onMessage,
      sqsClient: mockClient as any,
    });

    poller.incrementJobCount(); // at capacity
    poller.start();

    // First tick: deferred because at capacity
    await vi.advanceTimersByTimeAsync(500);
    expect(mockClient.send).not.toHaveBeenCalled();

    // Free up a slot
    poller.decrementJobCount();

    // Next tick: should now poll
    await vi.advanceTimersByTimeAsync(500);
    expect(mockClient.send).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledTimes(1);

    poller.stop();
  });
});
