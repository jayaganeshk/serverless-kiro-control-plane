import type { JobEvent, Job } from "@remote-kiro/common";
import { JobStatus } from "@remote-kiro/common";
import { listJobsByStatus, transitionJobStatus } from "../db/jobs.js";
import { createJobEvent } from "../db/job-events.js";
import { log } from "../middleware/logger.js";

/** Maximum duration in milliseconds per job type. */
const MAX_DURATION_MS: Record<string, number> = {
  implement_feature: 30 * 60 * 1000, // 30 minutes
  review_pr: 15 * 60 * 1000, // 15 minutes
};

/**
 * Determine whether a RUNNING job has exceeded its allowed duration.
 */
function isTimedOut(job: Job, now: number): boolean {
  if (!job.startedAt) return false;
  const elapsed = now - new Date(job.startedAt).getTime();
  const limit = MAX_DURATION_MS[job.jobType] ?? MAX_DURATION_MS.implement_feature;
  return elapsed > limit;
}

/**
 * Transition a single job to TIMED_OUT and record a JobEvent.
 */
async function timeoutJob(job: Job, now: string): Promise<void> {
  try {
    await transitionJobStatus(job.jobId, job.status, {
      status: JobStatus.TIMED_OUT,
      completedAt: now,
      errorCode: "JOB_TIMED_OUT",
      errorMessage: `Job exceeded maximum duration for ${job.jobType}`,
    });

    const event: JobEvent = {
      jobId: job.jobId,
      eventTs: now,
      eventType: "status_change",
      message: `Job timed out after exceeding maximum duration for ${job.jobType}`,
      stage: null,
      metadata: {
        previousStatus: job.status,
        newStatus: JobStatus.TIMED_OUT,
        jobType: job.jobType,
      },
    };
    await createJobEvent(event);

    log("info", `Timed out job ${job.jobId}`, {
      jobId: job.jobId,
      metadata: { jobType: job.jobType, previousStatus: job.status },
    });
  } catch (err) {
    // Conditional check failure means the job was already transitioned — safe to skip
    log("warn", `Failed to timeout job ${job.jobId}: ${(err as Error).message}`, {
      jobId: job.jobId,
    });
  }
}

/**
 * Fetch all pages of jobs for a given status.
 */
async function fetchAllJobsByStatus(status: JobStatus): Promise<Job[]> {
  const allJobs: Job[] = [];
  let nextToken: string | undefined;

  do {
    const page = await listJobsByStatus(status, { nextToken, limit: 100 });
    allJobs.push(...page.items);
    nextToken = page.nextToken ?? undefined;
  } while (nextToken);

  return allJobs;
}

/**
 * EventBridge scheduled handler (every 5 min).
 * Queries RUNNING jobs that exceed max duration and transitions them to TIMED_OUT.
 */
export async function handler(_event: unknown): Promise<void> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  log("info", "Timeout checker started");

  const runningJobs = await fetchAllJobsByStatus(JobStatus.RUNNING);

  const timedOutJobs = runningJobs.filter((job) => isTimedOut(job, now));

  log("info", "Timeout check summary", {
    metadata: {
      checkedCount: runningJobs.length,
      timedOutCount: timedOutJobs.length,
    },
  });

  for (const job of timedOutJobs) {
    await timeoutJob(job, nowIso);
  }

  log("info", "Timeout checker completed", {
    metadata: {
      checkedCount: runningJobs.length,
      timedOutCount: timedOutJobs.length,
    },
  });
}
