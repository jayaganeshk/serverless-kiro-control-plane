import { describe, it, expect, vi } from "vitest";
import { EventBuffer } from "./event-buffer";
import type { BackendApiClient, PostJobEventData } from "./api-client";

function makeEvent(msg: string): PostJobEventData {
  return { eventType: "stage_transition", message: msg };
}

function makeMockClient(
  postJobEvent: BackendApiClient["postJobEvent"] = vi.fn(),
): BackendApiClient {
  return { postJobEvent } as unknown as BackendApiClient;
}

describe("EventBuffer", () => {
  it("posts event directly when API is reachable", async () => {
    const postJobEvent = vi.fn().mockResolvedValue({ data: {} });
    const client = makeMockClient(postJobEvent);
    const buffer = new EventBuffer(client);

    await buffer.bufferEvent("job-1", makeEvent("stage 1"));

    expect(postJobEvent).toHaveBeenCalledWith("job-1", makeEvent("stage 1"));
    expect(buffer.getBufferSize()).toBe(0);
  });

  it("buffers event when API call fails", async () => {
    const postJobEvent = vi.fn().mockRejectedValue(new Error("network error"));
    const client = makeMockClient(postJobEvent);
    const buffer = new EventBuffer(client);

    await buffer.bufferEvent("job-1", makeEvent("stage 1"));

    expect(buffer.getBufferSize()).toBe(1);
  });

  it("flushes buffered events when connectivity is restored", async () => {
    const postJobEvent = vi.fn().mockRejectedValue(new Error("network error"));
    const client = makeMockClient(postJobEvent);
    const buffer = new EventBuffer(client);

    await buffer.bufferEvent("job-1", makeEvent("stage 1"));
    await buffer.bufferEvent("job-1", makeEvent("stage 2"));
    expect(buffer.getBufferSize()).toBe(2);

    // Restore connectivity
    postJobEvent.mockResolvedValue({ data: {} });
    await buffer.flush();

    expect(buffer.getBufferSize()).toBe(0);
    // 2 original failed calls + 2 flush calls
    expect(postJobEvent).toHaveBeenCalledTimes(4);
  });

  it("keeps events in buffer if flush also fails", async () => {
    const postJobEvent = vi.fn().mockRejectedValue(new Error("still offline"));
    const client = makeMockClient(postJobEvent);
    const buffer = new EventBuffer(client);

    await buffer.bufferEvent("job-1", makeEvent("stage 1"));
    await buffer.flush();

    expect(buffer.getBufferSize()).toBe(1);
  });

  it("partially flushes when some events succeed and others fail", async () => {
    let callCount = 0;
    const postJobEvent = vi.fn().mockImplementation(() => {
      callCount++;
      // First flush call succeeds, second fails
      if (callCount === 3) return Promise.resolve({ data: {} });
      if (callCount === 4) return Promise.reject(new Error("network error"));
      return Promise.reject(new Error("network error"));
    });
    const client = makeMockClient(postJobEvent);
    const buffer = new EventBuffer(client);

    await buffer.bufferEvent("job-1", makeEvent("stage 1"));
    await buffer.bufferEvent("job-1", makeEvent("stage 2"));
    expect(buffer.getBufferSize()).toBe(2);

    await buffer.flush();

    // Only the second event should remain buffered
    expect(buffer.getBufferSize()).toBe(1);
  });

  it("returns 0 buffer size when empty", () => {
    const client = makeMockClient();
    const buffer = new EventBuffer(client);
    expect(buffer.getBufferSize()).toBe(0);
  });
});
