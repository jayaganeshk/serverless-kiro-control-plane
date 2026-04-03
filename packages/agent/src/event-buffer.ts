import type { BackendApiClient, PostJobEventData } from "./api-client";

interface BufferedEvent {
  jobId: string;
  eventData: PostJobEventData;
}

export class EventBuffer {
  private readonly apiClient: BackendApiClient;
  private buffer: BufferedEvent[] = [];

  constructor(apiClient: BackendApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Attempts to post a job event via the API client.
   * If the call fails (network error), the event is stored in the local buffer.
   */
  async bufferEvent(jobId: string, eventData: PostJobEventData): Promise<void> {
    try {
      await this.apiClient.postJobEvent(jobId, eventData);
    } catch {
      this.buffer.push({ jobId, eventData });
    }
  }

  /**
   * Attempts to send all buffered events. Successfully sent events are removed
   * from the buffer; events that fail to send remain buffered.
   */
  async flush(): Promise<void> {
    const pending = [...this.buffer];
    this.buffer = [];

    for (const entry of pending) {
      try {
        await this.apiClient.postJobEvent(entry.jobId, entry.eventData);
      } catch {
        this.buffer.push(entry);
      }
    }
  }

  /** Returns the number of events currently buffered. */
  getBufferSize(): number {
    return this.buffer.length;
  }
}
