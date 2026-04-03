import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import type { Job, JobEvent, JobStatus, ArtifactType, SpecPhase, SpecItem } from "@remote-kiro/common";
import { JobStatus as JobStatusEnum, SpecPhaseStatus, SpecPhase as SpecPhaseEnum } from "@remote-kiro/common";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createRequestLogger } from "../middleware/logger.js";
import { normalizeEvent } from "../middleware/event-adapter.js";
import {
  parseJsonBody,
  requirePathParam,
  requireFields,
} from "../middleware/request-parser.js";
import {
  buildSuccessResponse,
  buildErrorResponse,
  ValidationError,
  NotFoundError,
} from "../middleware/error-handler.js";
import { getJobById, transitionJobStatus, createJob, updateJobReviewData } from "../db/jobs.js";
import { getAIAgentById } from "../db/ai-agents.js";
import { createJobEvent } from "../db/job-events.js";
import { createArtifact } from "../db/artifacts.js";
import { getRepositoryById } from "../db/repositories.js";
import { getProfileById } from "../db/profiles.js";
import { getSpecByJobId, updateSpecPhase, updateSpecCurrentPhase } from "../db/specs.js";
import { getCredentialByRepoId } from "../db/credentials.js";
import { getSecret } from "../secrets.js";
import { validateTransition } from "../state-machine.js";
import { publishReviewPR } from "../sqs/publisher.js";

const s3 = new S3Client({});
const ARTIFACTS_BUCKET = process.env.ARTIFACTS_BUCKET ?? "";
const PRESIGNED_UPLOAD_EXPIRY = 900; // 15 minutes

// ─── POST /jobs/{jobId}/claim ───

async function handleClaim(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { agentId } = requireFields<{ agentId: string }>(body, ["agentId"]);

  await transitionJobStatus(jobId, JobStatusEnum.QUEUED, {
    status: JobStatusEnum.CLAIMED,
    assignedAgentId: agentId,
  });

  const jobEvent: JobEvent = {
    jobId,
    eventTs: new Date().toISOString(),
    eventType: "status_change",
    message: `Job claimed by agent ${agentId}`,
    stage: null,
    metadata: {
      previousStatus: JobStatusEnum.QUEUED,
      newStatus: JobStatusEnum.CLAIMED,
      agentId,
    },
  };
  await createJobEvent(jobEvent);

  const updatedJob = await getJobById(jobId);
  return buildSuccessResponse(200, updatedJob);
}

// ─── PATCH /jobs/{jobId}/status ───

async function handleStatusUpdate(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { status } = requireFields<{ status: string }>(body, ["status"]);

  const newStatus = status as JobStatus;
  const stage = (body.stage as string) ?? null;
  const prNumber = body.prNumber as number | undefined;
  const prUrl = body.prUrl as string | undefined;
  const commitSha = body.commitSha as string | undefined;

  const currentJob = await getJobById(jobId);
  if (!currentJob) {
    throw new NotFoundError(`Job ${jobId} not found`);
  }

  validateTransition(currentJob.status, newStatus);

  const updateFields: Record<string, unknown> = { status: newStatus };
  if (prNumber !== undefined) updateFields.prNumber = prNumber;
  if (prUrl !== undefined) updateFields.prUrl = prUrl;
  if (commitSha !== undefined) updateFields.commitSha = commitSha;
  if (newStatus === JobStatusEnum.RUNNING && !currentJob.startedAt) {
    updateFields.startedAt = new Date().toISOString();
  }

  await transitionJobStatus(jobId, currentJob.status, updateFields as any);

  const jobEvent: JobEvent = {
    jobId,
    eventTs: new Date().toISOString(),
    eventType: "status_change",
    message: `Status changed from ${currentJob.status} to ${newStatus}`,
    stage,
    metadata: {
      previousStatus: currentJob.status,
      newStatus,
    },
  };
  await createJobEvent(jobEvent);

  const updatedJob = await getJobById(jobId);
  return buildSuccessResponse(200, updatedJob);
}

// ─── POST /jobs/{jobId}/events ───

async function handlePostEvent(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { eventType, message } = requireFields<{
    eventType: string;
    message: string;
  }>(body, ["eventType", "message"]);

  const stage = (body.stage as string) ?? null;
  const metadata = (body.metadata as Record<string, unknown>) ?? {};

  const jobEvent: JobEvent = {
    jobId,
    eventTs: new Date().toISOString(),
    eventType: eventType as JobEvent["eventType"],
    message,
    stage,
    metadata,
  };
  await createJobEvent(jobEvent);

  return buildSuccessResponse(201, jobEvent);
}

// ─── POST /jobs/{jobId}/artifacts/presign ───

async function handleArtifactPresign(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { artifactType, filename } = requireFields<{
    artifactType: string;
    filename: string;
  }>(body, ["artifactType", "filename"]);

  const contentType = (body.contentType as string) ?? "application/octet-stream";
  const artifactId = crypto.randomUUID();
  const s3Key = `artifacts/${jobId}/${artifactId}/${filename}`;

  const command = new PutObjectCommand({
    Bucket: ARTIFACTS_BUCKET,
    Key: s3Key,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn: PRESIGNED_UPLOAD_EXPIRY,
  });

  await createArtifact({
    jobId,
    artifactId,
    artifactType: artifactType as ArtifactType,
    s3Key,
    contentType,
    createdAt: new Date().toISOString(),
  });

  return buildSuccessResponse(200, { artifactId, uploadUrl, s3Key });
}

// ─── POST /jobs/{jobId}/complete ───

async function handleComplete(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const now = new Date().toISOString();

  const currentJob = await getJobById(jobId);
  if (!currentJob) {
    throw new NotFoundError(`Job ${jobId} not found`);
  }

  await transitionJobStatus(jobId, JobStatusEnum.RUNNING, {
    status: JobStatusEnum.COMPLETED,
    completedAt: now,
  });

  const jobEvent: JobEvent = {
    jobId,
    eventTs: now,
    eventType: "status_change",
    message: "Job completed successfully",
    stage: null,
    metadata: {
      previousStatus: JobStatusEnum.RUNNING,
      newStatus: JobStatusEnum.COMPLETED,
    },
  };
  await createJobEvent(jobEvent);

  // Auto-review: if repo has autoReviewEnabled, create a Review_Job
  if (
    currentJob.jobType === "implement_feature" &&
    currentJob.prNumber &&
    currentJob.prUrl
  ) {
    const repo = await getRepositoryById(currentJob.repoId);
    if (repo?.autoReviewEnabled) {
      const reviewProfileId =
        currentJob.reviewProfileId ?? repo.defaultReviewProfileId;

      if (reviewProfileId) {
        const reviewProfile = await getProfileById(reviewProfileId);
        const reviewJobId = crypto.randomUUID();
        const reviewJob: Job = {
          jobId: reviewJobId,
          jobType: "review_pr",
          parentJobId: jobId,
          repoId: currentJob.repoId,
          repoUrl: currentJob.repoUrl,
          baseBranch: currentJob.baseBranch,
          workBranch: currentJob.workBranch,
          title: `Review PR #${currentJob.prNumber}`,
          description: `Automated review of PR #${currentJob.prNumber} from feature job ${jobId}`,
          status: JobStatusEnum.QUEUED,
          requestedBy: currentJob.requestedBy,
          assignedAgentId: null,
          featureProfileId: currentJob.featureProfileId,
          reviewProfileId,
          aiAgentId: currentJob.aiAgentId,
          bundleVersion: reviewProfile?.bundleVersion ?? currentJob.bundleVersion,
          prNumber: currentJob.prNumber,
          prUrl: currentJob.prUrl,
          commitSha: currentJob.commitSha,
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

        const reviewEvent: JobEvent = {
          jobId: reviewJobId,
          eventTs: now,
          eventType: "job_created",
          message: `Review job created for PR #${currentJob.prNumber}`,
          stage: null,
          metadata: {
            jobType: "review_pr",
            parentJobId: jobId,
            repoId: currentJob.repoId,
            profileId: reviewProfileId,
          },
        };
        await createJobEvent(reviewEvent);

        await publishReviewPR({
          messageType: "review_pr",
          jobId: reviewJobId,
          jobType: "review_pr",
          parentJobId: jobId,
          repoId: currentJob.repoId,
          repoUrl: currentJob.repoUrl,
          baseBranch: currentJob.baseBranch,
          workBranch: currentJob.workBranch,
          profileId: reviewProfileId,
          bundleVersion: reviewProfile?.bundleVersion ?? currentJob.bundleVersion,
          prNumber: currentJob.prNumber,
          prUrl: currentJob.prUrl,
          aiAgentId: currentJob.aiAgentId,
          createdAt: now,
        });
      }
    }
  }

  const updatedJob = await getJobById(jobId);
  return buildSuccessResponse(200, updatedJob);
}

// ─── POST /jobs/{jobId}/fail ───

async function handleFail(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { errorMessage } = requireFields<{ errorMessage: string }>(body, [
    "errorMessage",
  ]);

  const errorCode = (body.errorCode as string) ?? null;
  const stage = (body.stage as string) ?? null;
  const now = new Date().toISOString();

  const currentJob = await getJobById(jobId);
  if (!currentJob) {
    throw new NotFoundError(`Job ${jobId} not found`);
  }

  await transitionJobStatus(jobId, JobStatusEnum.RUNNING, {
    status: JobStatusEnum.FAILED,
    errorCode,
    errorMessage,
    completedAt: now,
  });

  const jobEvent: JobEvent = {
    jobId,
    eventTs: now,
    eventType: "status_change",
    message: `Job failed: ${errorMessage}`,
    stage,
    metadata: {
      previousStatus: JobStatusEnum.RUNNING,
      newStatus: JobStatusEnum.FAILED,
      errorCode,
      errorMessage,
    },
  };
  await createJobEvent(jobEvent);

  const updatedJob = await getJobById(jobId);
  return buildSuccessResponse(200, updatedJob);
}

// ─── PATCH /jobs/{jobId}/spec ─── (agent updates spec phase data)

async function handleSpecUpdate(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { phase, status, items } = requireFields<{
    phase: string;
    status: string;
    items: SpecItem[];
  }>(body, ["phase", "status", "items"]);

  const now = new Date().toISOString();
  const spec = await getSpecByJobId(jobId);
  if (!spec) {
    throw new NotFoundError(`Spec for job ${jobId} not found`);
  }

  const phaseData = spec.phases[phase as SpecPhase];
  const newRevision = phaseData ? phaseData.revision : 0;

  await updateSpecPhase(jobId, phase as SpecPhase, {
    status: status as any,
    items,
    generatedAt: now,
    revision: newRevision,
  });

  if (status === SpecPhaseStatus.DRAFT) {
    await updateSpecCurrentPhase(jobId, phase as SpecPhase);
  }

  await createJobEvent({
    jobId,
    eventTs: now,
    eventType: "spec_update",
    message: `Agent generated ${phase} (${items.length} items)`,
    stage: null,
    metadata: { phase, status, itemCount: items.length },
  });

  const updatedSpec = await getSpecByJobId(jobId);
  return buildSuccessResponse(200, updatedSpec);
}

// ─── POST /jobs/{jobId}/spec/generate ─── (agent signals phase generation started)

async function handleSpecGenerate(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { phase } = requireFields<{ phase: string }>(body, ["phase"]);

  const now = new Date().toISOString();
  await updateSpecPhase(jobId, phase as SpecPhase, {
    status: SpecPhaseStatus.GENERATING,
  });

  await createJobEvent({
    jobId,
    eventTs: now,
    eventType: "spec_update",
    message: `Generating ${phase}...`,
    stage: null,
    metadata: { phase, action: "generating" },
  });

  return buildSuccessResponse(200, { jobId, phase, status: "generating" });
}

// ─── GET /jobs/{jobId}/credential ───

async function handleGetCredential(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const job = await getJobById(jobId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const cred = await getCredentialByRepoId(job.repoId);
  if (!cred || !cred.configured) {
    return buildSuccessResponse(200, { configured: false });
  }

  const result: Record<string, unknown> = {
    credentialType: cred.credentialType,
    configured: true,
    username: cred.username,
  };

  if (cred.secretArn) {
    const secret = await getSecret(job.repoId);
    if (secret) {
      result.secret = secret;
    }
  }

  return buildSuccessResponse(200, result);
}

// ─── GET /worker/jobs/{jobId}/spec (agent-facing, no auth) ───

async function handleGetSpecWorker(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const spec = await getSpecByJobId(jobId);
  if (!spec) throw new NotFoundError(`Spec not found for job ${jobId}`);
  return buildSuccessResponse(200, spec);
}

// ─── PATCH /jobs/{jobId}/review-data ───

async function handleStoreReviewData(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { parentJobId, reviewReport, reviewOutcome } = requireFields<{
    parentJobId: string;
    reviewReport: string;
    reviewOutcome: string;
  }>(body, ["parentJobId", "reviewReport", "reviewOutcome"]);

  const parentJob = await getJobById(parentJobId);
  if (!parentJob) {
    throw new NotFoundError(`Parent job ${parentJobId} not found`);
  }

  await updateJobReviewData(parentJobId, {
    reviewReport,
    reviewOutcome,
    reviewJobId: jobId,
  });

  return buildSuccessResponse(200, { stored: true });
}

// ─── Router ───

export async function handler(
  rawEvent: unknown,
): Promise<APIGatewayProxyResult> {
  const event = normalizeEvent(rawEvent as Record<string, unknown>);
  const logger = createRequestLogger(event);
  try {
    // Agent routes use IAM SigV4 auth — validated at API Gateway level, no JWT needed
    const method = event.httpMethod;
    const path = event.path ?? "";
    const hasJobId = !!event.pathParameters?.jobId;

    logger.info("Job worker handler invoked", { method, path, hasJobId });

    if (method === "GET" && path.match(/\/worker\/ai-agents\/[^/]+$/)) {
      const aiAgentId = event.pathParameters?.aiAgentId ?? path.split("/").pop()!;
      const agent = await getAIAgentById(aiAgentId);
      if (!agent) {
        return buildSuccessResponse(404, { error: { code: "NOT_FOUND", message: "AI Agent not found" } });
      }
      return buildSuccessResponse(200, agent);
    }

    if (!hasJobId) {
      return buildSuccessResponse(404, {
        error: { code: "NOT_FOUND", message: "Route not found" },
      });
    }

    if (method === "GET" && path.endsWith("/credential")) {
      return await handleGetCredential(event);
    }

    if (method === "POST" && path.endsWith("/claim")) {
      return await handleClaim(event);
    }

    if (method === "PATCH" && path.match(/\/jobs\/[^/]+\/status$/)) {
      return await handleStatusUpdate(event);
    }

    if (method === "POST" && path.endsWith("/artifacts/presign")) {
      return await handleArtifactPresign(event);
    }

    if (method === "POST" && path.endsWith("/events")) {
      return await handlePostEvent(event);
    }

    if (method === "POST" && path.endsWith("/complete")) {
      return await handleComplete(event);
    }

    if (method === "POST" && path.endsWith("/fail")) {
      return await handleFail(event);
    }

    if (method === "GET" && path.match(/\/worker\/jobs\/[^/]+\/spec$/)) {
      return await handleGetSpecWorker(event);
    }

    if (method === "PATCH" && path.endsWith("/review-data")) {
      return await handleStoreReviewData(event);
    }

    if (method === "PATCH" && path.endsWith("/spec")) {
      return await handleSpecUpdate(event);
    }

    if (method === "POST" && path.endsWith("/spec/generate")) {
      return await handleSpecGenerate(event);
    }

    return buildSuccessResponse(404, {
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  } catch (err) {
    logger.error("Job worker handler error", {
      error: (err as Error).message,
    });
    return buildErrorResponse(err as Error);
  }
}
