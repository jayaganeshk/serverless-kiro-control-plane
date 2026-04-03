import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import type { SQSJobMessage } from "@remote-kiro/common";

// ─── Types ───

export interface SQSPollerOptions {
  sqsQueueUrl: string;
  pollingIntervalMs: number;
  maxConcurrentJobs: number;
  repoAllowlist: string[];
  onMessage: (message: SQSJobMessage, receiptHandle: string) => Promise<void>;
  sqsClient?: SQSClient;
}

// ─── SQSPoller ───

export class SQSPoller {
  private readonly sqsQueueUrl: string;
  private readonly pollingIntervalMs: number;
  private readonly maxConcurrentJobs: number;
  private readonly repoAllowlist: string[];
  private readonly onMessage: (
    message: SQSJobMessage,
    receiptHandle: string,
  ) => Promise<void>;
  private readonly sqsClient: SQSClient;

  private running = false;
  private currentJobs = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SQSPollerOptions) {
    this.sqsQueueUrl = options.sqsQueueUrl;
    this.pollingIntervalMs = options.pollingIntervalMs;
    this.maxConcurrentJobs = options.maxConcurrentJobs;
    this.repoAllowlist = options.repoAllowlist;
    this.onMessage = options.onMessage;
    this.sqsClient = options.sqsClient ?? new SQSClient({});
  }

  // ─── Lifecycle ───

  start(): void {
    if (this.running) return;
    this.running = true;
    this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ─── Concurrency tracking ───

  getCurrentJobCount(): number {
    return this.currentJobs;
  }

  incrementJobCount(): void {
    this.currentJobs++;
  }

  decrementJobCount(): void {
    if (this.currentJobs > 0) {
      this.currentJobs--;
    }
  }

  // ─── Delete message helper ───

  async deleteMessage(receiptHandle: string): Promise<void> {
    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.sqsQueueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  // ─── Core polling loop ───

  private poll(): void {
    if (!this.running) return;

    // Concurrency gating: defer if at capacity
    if (this.currentJobs >= this.maxConcurrentJobs) {
      this.scheduleNextPoll();
      return;
    }

    this.receiveAndProcess().catch(() => {
      // Network errors are handled inside receiveAndProcess;
      // this catch is a safety net to keep the loop alive.
    });
  }

  private async receiveAndProcess(): Promise<void> {
    try {
      const response = await this.sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: this.sqsQueueUrl,
          WaitTimeSeconds: 20,
          MaxNumberOfMessages: 1,
        }),
      );

      const messages = response.Messages;
      if (!messages || messages.length === 0) {
        this.scheduleNextPoll();
        return;
      }

      const sqsMessage = messages[0];
      if (!sqsMessage.Body || !sqsMessage.ReceiptHandle) {
        this.scheduleNextPoll();
        return;
      }

      let parsed: SQSJobMessage;
      try {
        parsed = JSON.parse(sqsMessage.Body) as SQSJobMessage;
      } catch {
        // Malformed message — delete and skip
        await this.deleteMessage(sqsMessage.ReceiptHandle);
        this.scheduleNextPoll();
        return;
      }

      // Filter by repo allowlist
      if (
        this.repoAllowlist.length > 0 &&
        !this.repoAllowlist.includes(parsed.repoId)
      ) {
        await this.deleteMessage(sqsMessage.ReceiptHandle);
        this.scheduleNextPoll();
        return;
      }

      // Fire-and-forget: call onMessage without awaiting
      this.onMessage(parsed, sqsMessage.ReceiptHandle).catch(() => {
        // Errors in onMessage are handled by the pipeline, not the poller
      });

      this.scheduleNextPoll();
    } catch {
      // Network error — wait pollingIntervalMs before retrying
      this.scheduleNextPoll();
    }
  }

  private scheduleNextPoll(): void {
    if (!this.running) return;
    this.pollTimer = setTimeout(() => this.poll(), this.pollingIntervalMs);
  }
}
