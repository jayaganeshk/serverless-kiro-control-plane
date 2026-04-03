import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HeartbeatLoop } from "./heartbeat";
import type { BackendApiClient } from "./api-client";

function createMockClient() {
  return {
    sendHeartbeat: vi.fn().mockResolvedValue({ data: {} }),
  } as unknown as BackendApiClient;
}

describe("HeartbeatLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls sendHeartbeat at the configured interval", async () => {
    const client = createMockClient();
    const loop = new HeartbeatLoop(client, "agent-1", 5000);

    loop.start();

    // No call yet — first tick hasn't fired
    expect(client.sendHeartbeat).not.toHaveBeenCalled();

    // Advance past one interval
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.sendHeartbeat).toHaveBeenCalledTimes(1);
    expect(client.sendHeartbeat).toHaveBeenCalledWith("agent-1");

    // Advance past another interval
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.sendHeartbeat).toHaveBeenCalledTimes(2);

    loop.stop();
  });

  it("stop() clears the interval so no more calls are made", async () => {
    const client = createMockClient();
    const loop = new HeartbeatLoop(client, "agent-2", 3000);

    loop.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.sendHeartbeat).toHaveBeenCalledTimes(1);

    loop.stop();

    await vi.advanceTimersByTimeAsync(9000);
    // Still only 1 call — no new heartbeats after stop
    expect(client.sendHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("start() is idempotent — calling it twice does not create duplicate intervals", async () => {
    const client = createMockClient();
    const loop = new HeartbeatLoop(client, "agent-3", 2000);

    loop.start();
    loop.start(); // second call should be a no-op

    await vi.advanceTimersByTimeAsync(2000);
    expect(client.sendHeartbeat).toHaveBeenCalledTimes(1);

    loop.stop();
  });

  it("stop() is safe to call when not started", () => {
    const client = createMockClient();
    const loop = new HeartbeatLoop(client, "agent-4", 1000);

    // Should not throw
    expect(() => loop.stop()).not.toThrow();
  });

  it("logs error but continues the loop when sendHeartbeat fails", async () => {
    const client = createMockClient();
    const error = new Error("network down");
    (client.sendHeartbeat as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(error)
      .mockResolvedValue({ data: {} });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const loop = new HeartbeatLoop(client, "agent-5", 1000);
    loop.start();

    // First tick — fails
    await vi.advanceTimersByTimeAsync(1000);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[HeartbeatLoop] Failed to send heartbeat: network down",
    );

    // Second tick — succeeds, loop still running
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.sendHeartbeat).toHaveBeenCalledTimes(2);

    loop.stop();
    consoleSpy.mockRestore();
  });
});
