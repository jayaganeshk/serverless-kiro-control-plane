import type { SQSJobMessage, JobType } from "@remote-kiro/common";
import { JobStatus } from "@remote-kiro/common";
import { BackendApiClient, ApiClientError } from "./api-client";
import type { SQSPoller } from "./poller";
import type { EventBuffer } from "./event-buffer";
import { AwaitingApprovalError } from "./stages/await-approval";

// ─── Constants ───

/** Max duration in ms per job type */
const MAX_DURATION_MS: Record<JobType, number> = {
  implement_feature: 30 * 60 * 1000,
  review_pr: 15 * 60 * 1000,
  implement_review_fix: 30 * 60 * 1000,
};

const TERMINAL_STATUSES = new Set([
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
  JobStatus.TIMED_OUT,
]);

// ─── Types ───

export interface StageRunner {
  name: string;
  run: (jobId: string, message: SQSJobMessage) => Promise<void>;
}

export type PipelineLogger = (msg: string, jobId?: string) => void;

export interface JobPipelineOptions {
  apiClient: BackendApiClient;
  poller: SQSPoller;
  eventBuffer: EventBuffer;
  agentId: string;
  logger?: PipelineLogger;
}

// ─── JobPipeline ───

export class JobPipeline {
  private readonly apiClient: BackendApiClient;
  private readonly poller: SQSPoller;
  private readonly eventBuffer: EventBuffer;
  private readonly agentId: string;
  private readonly log: PipelineLogger;

  constructor(options: JobPipelineOptions) {
    this.apiClient = options.apiClient;
    this.poller = options.poller;
    this.eventBuffer = options.eventBuffer;
    this.agentId = options.agentId;
    this.log = options.logger ?? ((msg, jid) => {
      const ts = new Date().toISOString();
      const prefix = jid ? `[${ts}] [PIPELINE] [job:${jid}]` : `[${ts}] [PIPELINE]`;
      console.log(`${prefix} ${msg}`);
    });
  }

  async run(
    message: SQSJobMessage,
    receiptHandle: string,
    stages: StageRunner[],
  ): Promise<void> {
    const { jobId, jobType } = message;
    const startTime = Date.now();
    const maxDurationMs = MAX_DURATION_MS[jobType as JobType] ?? MAX_DURATION_MS.implement_feature;

    this.poller.incrementJobCount();
    const isResume = message.messageType === "resume_job";
    this.log(`Pipeline starting (${stages.length} stages${isResume ? ", resume" : ""})`, jobId);

    try {
      // ── Step 0: Check if job is still active ──
      const preCheck = await this.getJobStatus(jobId);
      if (preCheck && TERMINAL_STATUSES.has(preCheck as JobStatus)) {
        this.log(`Job is already in terminal status: ${preCheck} — skipping`, jobId);
        await this.poller.deleteMessage(receiptHandle);
        return;
      }

      if (!isResume) {
        // ── Step 1: Claim the job ──
        this.log("Claiming job...", jobId);
        try {
          await this.apiClient.claimJob(jobId, this.agentId);
          this.log("Job claimed successfully", jobId);
        } catch (err) {
          if (err instanceof ApiClientError && err.statusCode === 409) {
            this.log("Job already claimed or in unexpected status — skipping", jobId);
            await this.poller.deleteMessage(receiptHandle);
            return;
          }
          throw err;
        }

        // ── Step 2: Set status to RUNNING ──
        this.log("Setting status to RUNNING...", jobId);
        await this.apiClient.updateJobStatus(jobId, {
          status: JobStatus.RUNNING,
        });
        this.log("Status set to RUNNING", jobId);
      } else {
        this.log("Resuming job (already RUNNING)", jobId);
      }

      // ── Step 3: Run stages sequentially ──
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        const cancelled = await this.isJobCancelled(jobId);
        if (cancelled) {
          this.log("Job was cancelled — aborting pipeline", jobId);
          await this.poller.deleteMessage(receiptHandle);
          return;
        }

        const elapsed = Date.now() - startTime;
        if (elapsed >= maxDurationMs) {
          this.log(`Job timeout reached at stage ${stage.name} (${Math.round(elapsed / 1000)}s)`, jobId);
          await this.handleTimeout(jobId, receiptHandle, stage.name);
          return;
        }

        this.log(`[${i + 1}/${stages.length}] Entering stage: ${stage.name}`, jobId);
        await this.eventBuffer.bufferEvent(jobId, {
          eventType: "stage_transition",
          message: `Entering stage: ${stage.name}`,
          stage: stage.name,
        });

        const stageStart = Date.now();
        await stage.run(jobId, message);
        const stageDuration = ((Date.now() - stageStart) / 1000).toFixed(1);
        this.log(`[${i + 1}/${stages.length}] Stage ${stage.name} completed (${stageDuration}s)`, jobId);
      }

      // ── Step 4: Complete the job ──
      this.log("All stages completed — marking job as COMPLETED", jobId);
      await this.apiClient.completeJob(jobId);
      await this.poller.deleteMessage(receiptHandle);
      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.log(`Pipeline finished successfully (${totalDuration}s total)`, jobId);
    } catch (err) {
      if (err instanceof AwaitingApprovalError) {
        this.log("Job paused — awaiting user approval", jobId);
        await this.poller.deleteMessage(receiptHandle);
        return;
      }

      const errorMessage = err instanceof Error ? err.message : String(err);
      this.log(`Pipeline FAILED: ${errorMessage}`, jobId);

      try {
        await this.apiClient.failJob(jobId, {
          errorMessage,
          errorCode: getErrorCode(err),
        });
        this.log("Failure reported to backend", jobId);
      } catch (failErr) {
        const failMsg = failErr instanceof Error ? failErr.message : String(failErr);
        this.log(`Could not report failure to backend: ${failMsg}`, jobId);
      }

      await this.poller.deleteMessage(receiptHandle);
    } finally {
      this.poller.decrementJobCount();
    }
  }

  // ─── Helpers ───

  private async getJobStatus(jobId: string): Promise<string | null> {
    try {
      const response = await this.apiClient.getJob(jobId);
      const job = response.data as { status?: string } | undefined;
      return job?.status ?? null;
    } catch {
      return null;
    }
  }

  private async isJobCancelled(jobId: string): Promise<boolean> {
    try {
      const response = await this.apiClient.getJob(jobId);
      const job = response.data as { status?: string } | undefined;
      return job?.status === JobStatus.CANCELLED;
    } catch {
      return false;
    }
  }

  private async handleTimeout(
    jobId: string,
    receiptHandle: string,
    currentStage: string,
  ): Promise<void> {
    try {
      await this.apiClient.failJob(jobId, {
        errorMessage: `Job exceeded maximum duration at stage: ${currentStage}`,
        errorCode: "JOB_TIMEOUT",
        stage: currentStage,
      });
    } catch {
      // Best-effort timeout reporting
    }
    await this.poller.deleteMessage(receiptHandle);
  }
}

// ─── Helpers ───

function getErrorCode(err: unknown): string {
  if (err instanceof Error && "code" in err) {
    return String((err as { code: string }).code);
  }
  return "STAGE_FAILURE";
}
