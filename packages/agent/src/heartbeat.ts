import type { BackendApiClient } from "./api-client";

// ─── HeartbeatLoop ───

export class HeartbeatLoop {
  private readonly apiClient: BackendApiClient;
  private readonly agentId: string;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(apiClient: BackendApiClient, agentId: string, intervalMs: number) {
    this.apiClient = apiClient;
    this.agentId = agentId;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer !== null) {
      return;
    }

    this.timer = setInterval(async () => {
      try {
        await this.apiClient.sendHeartbeat(this.agentId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[HeartbeatLoop] Failed to send heartbeat: ${msg}`);
      }
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
