import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import type { Job, JobEvent } from "@remote-kiro/common";
import { JobStatus as JobStatusEnum } from "@remote-kiro/common";
import { validateWebhookSignature } from "../middleware/webhook-auth.js";
import { createRequestLogger } from "../middleware/logger.js";
import { normalizeEvent } from "../middleware/event-adapter.js";
import { parseJsonBody } from "../middleware/request-parser.js";
import {
  buildSuccessResponse,
  buildErrorResponse,
} from "../middleware/error-handler.js";
import { createJob, listJobsByStatus } from "../db/jobs.js";
import { createJobEvent } from "../db/job-events.js";
import { getProfileById } from "../db/profiles.js";
import { publishReviewPR } from "../sqs/publisher.js";

// ─── GitHub Webhook Push Event (subset of fields we care about) ───

interface GitHubPushEvent {
  ref: string;
  repository: {
    clone_url?: string;
    html_url?: string;
    ssh_url?: string;
  };
}

// ─── POST /webhooks/github ───

async function handleGitHubWebhook(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  // 1. Validate webhook signature (throws AuthError → 401 via buildErrorResponse)
  validateWebhookSignature(event);

  // 2. Parse push event body
  const body = parseJsonBody<GitHubPushEvent>(event);
  const ref = body.ref ?? "";
  const repoUrl = body.repository?.clone_url ?? body.repository?.html_url ?? "";

  // Only process push events on branches (refs/heads/*)
  if (!ref.startsWith("refs/heads/")) {
    return buildSuccessResponse(200, { message: "Ignored: not a branch push" });
  }

  const branch = ref.replace("refs/heads/", "");

  // 3. Look up completed Feature_Jobs that match this repo/branch and have a PR
  const completedJobs = await listJobsByStatus(JobStatusEnum.COMPLETED);
  const matchingFeatureJob = completedJobs.items.find(
    (job) =>
      job.jobType === "implement_feature" &&
      job.repoUrl === repoUrl &&
      job.workBranch === branch &&
      job.prNumber !== null &&
      job.prUrl !== null,
  );

  // 4. No matching Feature_Job — nothing to do
  if (!matchingFeatureJob) {
    return buildSuccessResponse(200, { message: "No matching feature job found" });
  }

  // 5. Deduplicate: check for existing QUEUED or RUNNING Review_Job for the same PR
  const [queuedJobs, runningJobs] = await Promise.all([
    listJobsByStatus(JobStatusEnum.QUEUED),
    listJobsByStatus(JobStatusEnum.RUNNING),
  ]);

  const hasExistingReview = [...queuedJobs.items, ...runningJobs.items].some(
    (job) =>
      job.jobType === "review_pr" &&
      job.repoUrl === repoUrl &&
      job.prNumber === matchingFeatureJob.prNumber,
  );

  if (hasExistingReview) {
    return buildSuccessResponse(200, { message: "Review already queued or running for this PR" });
  }

  // 6. Create a new Review_Job record (QUEUED) linked to the Feature_Job
  const now = new Date().toISOString();
  const reviewJobId = crypto.randomUUID();
  const reviewProfileId =
    matchingFeatureJob.reviewProfileId ??
    matchingFeatureJob.featureProfileId;

  const reviewProfile = await getProfileById(reviewProfileId);

  const reviewJob: Job = {
    jobId: reviewJobId,
    jobType: "review_pr",
    parentJobId: matchingFeatureJob.jobId,
    repoId: matchingFeatureJob.repoId,
    repoUrl: matchingFeatureJob.repoUrl,
    baseBranch: matchingFeatureJob.baseBranch,
    workBranch: matchingFeatureJob.workBranch,
    title: `Re-review PR #${matchingFeatureJob.prNumber}`,
    description: `Re-review triggered by push to ${branch} for PR #${matchingFeatureJob.prNumber}`,
    status: JobStatusEnum.QUEUED,
    requestedBy: matchingFeatureJob.requestedBy,
    assignedAgentId: null,
    featureProfileId: matchingFeatureJob.featureProfileId,
    reviewProfileId,
    aiAgentId: matchingFeatureJob.aiAgentId,
    bundleVersion: reviewProfile?.bundleVersion ?? matchingFeatureJob.bundleVersion,
    prNumber: matchingFeatureJob.prNumber,
    prUrl: matchingFeatureJob.prUrl,
    commitSha: null,
    reviewOutcome: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    specPhase: null,
    reviewReport: null,
    reviewJobId: null,
    reviewHistory: [],
  };

  await createJob(reviewJob);

  // 7. Write job_created JobEvent
  const jobEvent: JobEvent = {
    jobId: reviewJobId,
    eventTs: now,
    eventType: "job_created",
    message: `Re-review job created for PR #${matchingFeatureJob.prNumber} (push to ${branch})`,
    stage: null,
    metadata: {
      jobType: "review_pr",
      parentJobId: matchingFeatureJob.jobId,
      repoId: matchingFeatureJob.repoId,
      profileId: reviewProfileId,
      trigger: "webhook_push",
    },
  };
  await createJobEvent(jobEvent);

  // 8. Publish review_pr SQS message
  await publishReviewPR({
    messageType: "review_pr",
    jobId: reviewJobId,
    jobType: "review_pr",
    parentJobId: matchingFeatureJob.jobId,
    repoId: matchingFeatureJob.repoId,
    repoUrl: matchingFeatureJob.repoUrl,
    baseBranch: matchingFeatureJob.baseBranch,
    workBranch: matchingFeatureJob.workBranch,
    profileId: reviewProfileId,
    bundleVersion: reviewProfile?.bundleVersion ?? matchingFeatureJob.bundleVersion,
    prNumber: matchingFeatureJob.prNumber!,
    prUrl: matchingFeatureJob.prUrl!,
    aiAgentId: matchingFeatureJob.aiAgentId,
    createdAt: now,
  });

  // 9. Return 201
  return buildSuccessResponse(201, reviewJob);
}

// ─── Router ───

export async function handler(
  rawEvent: unknown,
): Promise<APIGatewayProxyResult> {
  const event = normalizeEvent(rawEvent as Record<string, unknown>);
  const logger = createRequestLogger(event);
  try {
    const method = event.httpMethod;
    const path = event.path ?? "";

    logger.info("Webhook handler invoked", { method, path });

    if (method === "POST" && path.endsWith("/webhooks/github")) {
      return await handleGitHubWebhook(event);
    }

    return buildSuccessResponse(404, {
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  } catch (err) {
    logger.error("Webhook handler error", {
      error: (err as Error).message,
    });
    return buildErrorResponse(err as Error);
  }
}
