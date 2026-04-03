import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import type { Job, JobEvent, JobStatus, SpecPhase, SpecItem } from "@remote-kiro/common";
import { JobStatus as JobStatusEnum, SpecPhaseStatus, SpecPhase as SpecPhaseEnum, SPEC_PHASE_ORDER, createEmptySpec } from "@remote-kiro/common";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { validateCognitoJwt } from "../middleware/auth.js";
import { createRequestLogger } from "../middleware/logger.js";
import { normalizeEvent } from "../middleware/event-adapter.js";
import {
  parseJsonBody,
  requirePathParam,
  getQueryParam,
  requireFields,
} from "../middleware/request-parser.js";
import {
  buildSuccessResponse,
  buildErrorResponse,
  ValidationError,
  NotFoundError,
} from "../middleware/error-handler.js";
import { ConflictError } from "../db/errors.js";
import { getRepositoryById } from "../db/repositories.js";
import { getProfileById } from "../db/profiles.js";
import { createJob, getJobById, listJobsByUser, transitionJobStatus } from "../db/jobs.js";
import { createJobEvent, listJobEvents } from "../db/job-events.js";
import { validateTransition, isTerminalStatus } from "../state-machine.js";
import { listArtifactsByJob } from "../db/artifacts.js";
import { getSpecByJobId, createSpec, updateSpecPhase, updateSpecCurrentPhase } from "../db/specs.js";
import { addPhaseMessage, getPhaseMessages } from "../db/phase-messages.js";
import { publishImplementFeature, publishResumeJob, publishReviewPR, publishImplementReviewFix } from "../sqs/publisher.js";

const s3 = new S3Client({});
const ARTIFACTS_BUCKET = process.env.ARTIFACTS_BUCKET ?? "";
const PRESIGNED_URL_EXPIRY = 3600; // 60 minutes

// ─── POST /jobs ───

async function handleCreate(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { jobType, repoId, profileId, description } = requireFields<{
    jobType: string;
    repoId: string;
    profileId: string;
    description: string;
  }>(body, ["jobType", "repoId", "profileId", "description"]);

  if (jobType !== "implement_feature") {
    throw new ValidationError(
      'jobType must be "implement_feature"',
    );
  }

  // Validate repoId exists and is active
  const repo = await getRepositoryById(repoId);
  if (!repo) {
    throw new ValidationError(`Repository ${repoId} not found`);
  }
  if (repo.status !== "active") {
    throw new ValidationError(`Repository ${repoId} is not active`);
  }

  const profile = await getProfileById(profileId);
  if (!profile) {
    throw new ValidationError(`Profile ${profileId} not found`);
  }

  const baseBranch = (body.baseBranch as string) ?? repo.defaultBranch;
  const constraints = (body.constraints as string) ?? null;
  const aiAgentId = (body.aiAgentId as string) ?? null;
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const shortId = jobId.substring(0, 6);
  const branchSlug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 40)
    .replace(/-+$/, "");
  const workBranch = `kiro/${branchSlug}-${shortId}`;

  const job: Job = {
    jobId,
    jobType: "implement_feature",
    parentJobId: null,
    repoId,
    repoUrl: repo.url,
    baseBranch,
    workBranch,
    title: description.substring(0, 120),
    description,
    status: JobStatusEnum.QUEUED,
    requestedBy: userId,
    assignedAgentId: null,
    featureProfileId: profileId,
    reviewProfileId: repo.defaultReviewProfileId ?? null,
    aiAgentId,
    bundleVersion: profile.bundleVersion,
    prNumber: null,
    prUrl: null,
    commitSha: null,
    reviewOutcome: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    specPhase: SpecPhaseEnum.REQUIREMENTS,
    reviewReport: null,
    reviewJobId: null,
    reviewHistory: [],
  };

  // Create Job record
  await createJob(job);

  // Create the initial spec for this job
  const spec = createEmptySpec(jobId);
  await createSpec(spec);

  // Write job_created event
  const jobEvent: JobEvent = {
    jobId,
    eventTs: now,
    eventType: "job_created",
    message: `Job created: ${description.substring(0, 80)}`,
    stage: null,
    metadata: { jobType: "implement_feature", repoId, profileId },
  };
  await createJobEvent(jobEvent);

  // Publish SQS message
  await publishImplementFeature({
    messageType: "implement_feature",
    jobId,
    jobType: "implement_feature",
    repoId,
    repoUrl: repo.url,
    baseBranch,
    workBranch,
    profileId,
    bundleVersion: profile.bundleVersion,
    manifest: profile.manifest,
    requestedBy: userId,
    title: description.substring(0, 120),
    description,
    constraints,
    aiAgentId,
    createdAt: now,
  });

  return buildSuccessResponse(201, job);
}

// ─── GET /jobs ───

async function handleListJobs(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const status = getQueryParam(event, "status") as JobStatus | undefined;
  const nextToken = getQueryParam(event, "nextToken");

  const result = await listJobsByUser(userId, {
    status,
    nextToken,
  });

  return buildSuccessResponse(200, result.items, {
    nextToken: result.nextToken,
  });
}

// ─── GET /jobs/{jobId} ───

async function handleGetJob(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const job = await getJobById(jobId);
  if (!job) {
    throw new NotFoundError(`Job ${jobId} not found`);
  }
  return buildSuccessResponse(200, job);
}

// ─── GET /jobs/{jobId}/events ───

async function handleGetJobEvents(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const events = await listJobEvents(jobId);
  return buildSuccessResponse(200, events);
}

// ─── GET /jobs/{jobId}/artifacts ───

async function handleGetJobArtifacts(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const artifacts = await listArtifactsByJob(jobId);

  const withUrls = await Promise.all(
    artifacts.map(async (artifact) => {
      const command = new GetObjectCommand({
        Bucket: ARTIFACTS_BUCKET,
        Key: artifact.s3Key,
      });
      const downloadUrl = await getSignedUrl(s3, command, {
        expiresIn: PRESIGNED_URL_EXPIRY,
      });
      return { ...artifact, downloadUrl };
    }),
  );

  return buildSuccessResponse(200, withUrls);
}

// ─── POST /jobs/{jobId}/cancel ───

async function handleCancel(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const now = new Date().toISOString();

  const currentJob = await getJobById(jobId);
  if (!currentJob) {
    throw new NotFoundError(`Job ${jobId} not found`);
  }

  if (isTerminalStatus(currentJob.status)) {
    throw new ConflictError(
      `Job ${jobId} is in terminal status ${currentJob.status} and cannot be cancelled`,
      "INVALID_STATUS_TRANSITION",
    );
  }

  validateTransition(currentJob.status, JobStatusEnum.CANCELLED);

  await transitionJobStatus(jobId, currentJob.status, {
    status: JobStatusEnum.CANCELLED,
    completedAt: now,
  });

  const jobEvent: JobEvent = {
    jobId,
    eventTs: now,
    eventType: "status_change",
    message: `Job cancelled from ${currentJob.status}`,
    stage: null,
    metadata: {
      previousStatus: currentJob.status,
      newStatus: JobStatusEnum.CANCELLED,
    },
  };
  await createJobEvent(jobEvent);

  const updatedJob = await getJobById(jobId);
  return buildSuccessResponse(200, updatedJob);
}

// ─── GET /jobs/{jobId}/spec ───

async function handleGetSpec(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const spec = await getSpecByJobId(jobId);
  if (!spec) {
    throw new NotFoundError(`Spec for job ${jobId} not found`);
  }
  return buildSuccessResponse(200, spec);
}

// ─── POST /jobs/{jobId}/spec/approve ───

async function handleApprovePhase(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { phase } = requireFields<{ phase: string }>(body, ["phase"]);

  const spec = await getSpecByJobId(jobId);
  if (!spec) {
    throw new NotFoundError(`Spec for job ${jobId} not found`);
  }

  const phaseData = spec.phases[phase as SpecPhase];
  if (!phaseData) {
    throw new ValidationError(`Invalid phase: ${phase}`);
  }

  if (phaseData.status !== SpecPhaseStatus.DRAFT) {
    throw new ValidationError(`Phase ${phase} is not in draft status (current: ${phaseData.status})`);
  }

  const now = new Date().toISOString();
  await updateSpecPhase(jobId, phase as SpecPhase, {
    status: SpecPhaseStatus.APPROVED,
    approvedAt: now,
  });

  // Determine the next phase
  const phaseIndex = SPEC_PHASE_ORDER.indexOf(phase as SpecPhase);
  const nextPhase = SPEC_PHASE_ORDER[phaseIndex + 1] ?? null;

  if (nextPhase) {
    await updateSpecCurrentPhase(jobId, nextPhase);
  }

  // Write spec_update event
  await createJobEvent({
    jobId,
    eventTs: now,
    eventType: "spec_update",
    message: `Phase ${phase} approved`,
    stage: null,
    metadata: { phase, action: "approved", nextPhase },
  });

  // Resume the job from AWAITING_APPROVAL → RUNNING
  const currentJob = await getJobById(jobId);
  if (currentJob && currentJob.status === JobStatusEnum.AWAITING_APPROVAL) {
    await transitionJobStatus(jobId, JobStatusEnum.AWAITING_APPROVAL, {
      status: JobStatusEnum.RUNNING,
      specPhase: nextPhase ?? (phase as SpecPhase),
    });

    const resumeJobType = (currentJob.jobType === "implement_review_fix" ? "implement_review_fix" : "implement_feature") as "implement_feature" | "implement_review_fix";
    const profile = await getProfileById(currentJob.featureProfileId);
    await publishResumeJob({
      messageType: "resume_job",
      jobId,
      jobType: resumeJobType,
      repoId: currentJob.repoId,
      repoUrl: currentJob.repoUrl,
      baseBranch: currentJob.baseBranch,
      workBranch: currentJob.workBranch,
      profileId: currentJob.featureProfileId,
      bundleVersion: profile?.bundleVersion ?? currentJob.bundleVersion,
      manifest: profile?.manifest ?? null,
      requestedBy: currentJob.requestedBy,
      title: currentJob.title,
      description: currentJob.description,
      constraints: null,
      aiAgentId: currentJob.aiAgentId,
      resumeFromPhase: nextPhase ? `GENERATING_${nextPhase.toUpperCase()}` : "IMPLEMENTING_TASKS",
      createdAt: now,
    });
  }

  const updatedSpec = await getSpecByJobId(jobId);
  return buildSuccessResponse(200, updatedSpec);
}

// ─── POST /jobs/{jobId}/spec/reject ───

async function handleRejectPhase(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { phase, reason } = requireFields<{ phase: string; reason: string }>(body, ["phase", "reason"]);

  const spec = await getSpecByJobId(jobId);
  if (!spec) {
    throw new NotFoundError(`Spec for job ${jobId} not found`);
  }

  const phaseData = spec.phases[phase as SpecPhase];
  if (!phaseData) {
    throw new ValidationError(`Invalid phase: ${phase}`);
  }

  if (phaseData.status !== SpecPhaseStatus.DRAFT) {
    throw new ValidationError(`Phase ${phase} is not in draft status (current: ${phaseData.status})`);
  }

  const now = new Date().toISOString();
  await updateSpecPhase(jobId, phase as SpecPhase, {
    status: SpecPhaseStatus.REJECTED,
    rejectionReason: reason,
    revision: phaseData.revision + 1,
  });

  await createJobEvent({
    jobId,
    eventTs: now,
    eventType: "spec_update",
    message: `Phase ${phase} rejected: ${reason}`,
    stage: null,
    metadata: { phase, action: "rejected", reason },
  });

  const currentJob = await getJobById(jobId);
  if (currentJob && currentJob.status === JobStatusEnum.AWAITING_APPROVAL) {
    await transitionJobStatus(jobId, JobStatusEnum.AWAITING_APPROVAL, {
      status: JobStatusEnum.RUNNING,
    });

    const rejResumeJobType = (currentJob.jobType === "implement_review_fix" ? "implement_review_fix" : "implement_feature") as "implement_feature" | "implement_review_fix";
    const profile = await getProfileById(currentJob.featureProfileId);
    await publishResumeJob({
      messageType: "resume_job",
      jobId,
      jobType: rejResumeJobType,
      repoId: currentJob.repoId,
      repoUrl: currentJob.repoUrl,
      baseBranch: currentJob.baseBranch,
      workBranch: currentJob.workBranch,
      profileId: currentJob.featureProfileId,
      bundleVersion: profile?.bundleVersion ?? currentJob.bundleVersion,
      manifest: profile?.manifest ?? null,
      requestedBy: currentJob.requestedBy,
      title: currentJob.title,
      description: currentJob.description,
      constraints: null,
      aiAgentId: currentJob.aiAgentId,
      resumeFromPhase: `GENERATING_${phase.toUpperCase()}`,
      createdAt: now,
    });
  }

  const updatedSpec = await getSpecByJobId(jobId);
  return buildSuccessResponse(200, updatedSpec);
}

// ─── PATCH /jobs/{jobId}/spec/items ───

async function handleUpdateSpecItems(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { phase, items } = requireFields<{ phase: string; items: SpecItem[] }>(body, ["phase", "items"]);

  const spec = await getSpecByJobId(jobId);
  if (!spec) {
    throw new NotFoundError(`Spec for job ${jobId} not found`);
  }

  const phaseData = spec.phases[phase as SpecPhase];
  if (!phaseData) {
    throw new ValidationError(`Invalid phase: ${phase}`);
  }

  if (phaseData.status !== SpecPhaseStatus.DRAFT && phaseData.status !== SpecPhaseStatus.APPROVED) {
    throw new ValidationError(`Cannot update items in phase with status: ${phaseData.status}`);
  }

  await updateSpecPhase(jobId, phase as SpecPhase, { items });

  const now = new Date().toISOString();
  await createJobEvent({
    jobId,
    eventTs: now,
    eventType: "spec_update",
    message: `Phase ${phase} items updated (${items.length} items)`,
    stage: null,
    metadata: { phase, action: "items_updated", itemCount: items.length },
  });

  const updatedSpec = await getSpecByJobId(jobId);
  return buildSuccessResponse(200, updatedSpec);
}

// ─── POST /jobs/{jobId}/spec/messages ───

async function handlePostPhaseMessage(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const body = parseJsonBody<Record<string, unknown>>(event);
  const phase = body.phase as string;
  const message = body.message as string;

  if (!phase || !["requirements", "design", "tasks", "vibe"].includes(phase)) {
    throw new ValidationError("phase must be one of: requirements, design, tasks, vibe");
  }
  if (!message?.trim()) {
    throw new ValidationError("message is required");
  }

  const job = await getJobById(jobId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const now = new Date().toISOString();
  await addPhaseMessage({
    jobId,
    phase,
    messageId: crypto.randomUUID(),
    message: message.trim(),
    sender: userId,
    createdAt: now,
  });

  // Auto-reject and trigger re-generation when feedback is posted on a draft
  // spec phase while the job is awaiting approval. The agent will see both the
  // original generated content and this feedback when it re-generates.
  let regenerating = false;
  if (phase !== "vibe" && job.status === JobStatusEnum.AWAITING_APPROVAL) {
    const spec = await getSpecByJobId(jobId);
    const phaseData = spec?.phases[phase as SpecPhase];
    if (phaseData && phaseData.status === SpecPhaseStatus.DRAFT) {
      await updateSpecPhase(jobId, phase as SpecPhase, {
        status: SpecPhaseStatus.REJECTED,
        rejectionReason: message.trim(),
        revision: phaseData.revision + 1,
      });

      await createJobEvent({
        jobId,
        eventTs: now,
        eventType: "spec_update",
        message: `Phase ${phase} revision requested via feedback: ${message.trim()}`,
        stage: null,
        metadata: { phase, action: "feedback_revision", reason: message.trim() },
      });

      await transitionJobStatus(jobId, JobStatusEnum.AWAITING_APPROVAL, {
        status: JobStatusEnum.RUNNING,
      });

      const rejResumeJobType = (job.jobType === "implement_review_fix"
        ? "implement_review_fix"
        : "implement_feature") as "implement_feature" | "implement_review_fix";
      const profile = await getProfileById(job.featureProfileId);
      await publishResumeJob({
        messageType: "resume_job",
        jobId,
        jobType: rejResumeJobType,
        repoId: job.repoId,
        repoUrl: job.repoUrl,
        baseBranch: job.baseBranch,
        workBranch: job.workBranch,
        profileId: job.featureProfileId,
        bundleVersion: profile?.bundleVersion ?? job.bundleVersion,
        manifest: profile?.manifest ?? null,
        requestedBy: job.requestedBy,
        title: job.title,
        description: job.description,
        constraints: null,
        aiAgentId: job.aiAgentId,
        resumeFromPhase: `GENERATING_${phase.toUpperCase()}`,
        createdAt: now,
      });

      regenerating = true;
    }
  }

  return buildSuccessResponse(201, { posted: true, regenerating });
}

// ─── GET /jobs/{jobId}/spec/messages ───

async function handleGetPhaseMessages(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const phase = getQueryParam(event, "phase");
  if (!phase || !["requirements", "design", "tasks", "vibe"].includes(phase)) {
    throw new ValidationError("phase query parameter is required");
  }

  const messages = await getPhaseMessages(jobId, phase);
  return buildSuccessResponse(200, messages);
}

// ─── POST /jobs/{jobId}/review ───

async function handleTriggerReview(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const job = await getJobById(jobId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  if (!job.prNumber || !job.prUrl) {
    throw new ValidationError("Job has no PR to review");
  }

  const body = parseJsonBody<Record<string, unknown>>(event);
  const reviewAiAgentId = (body.aiAgentId as string) ?? job.aiAgentId ?? null;
  const reviewProfileId = job.reviewProfileId ?? job.featureProfileId;
  if (!reviewProfileId) {
    throw new ValidationError("No profile configured for this job");
  }

  const reviewProfile = await getProfileById(reviewProfileId);
  const now = new Date().toISOString();
  const reviewJobId = crypto.randomUUID();

  const reviewJob: Job = {
    jobId: reviewJobId,
    jobType: "review_pr",
    parentJobId: jobId,
    repoId: job.repoId,
    repoUrl: job.repoUrl,
    baseBranch: job.baseBranch,
    workBranch: job.workBranch,
    title: `Review PR #${job.prNumber}`,
    description: `Manual code review of PR #${job.prNumber} requested by user`,
    status: JobStatusEnum.QUEUED,
    requestedBy: userId,
    assignedAgentId: null,
    featureProfileId: job.featureProfileId,
    reviewProfileId,
    aiAgentId: reviewAiAgentId,
    bundleVersion: reviewProfile?.bundleVersion ?? job.bundleVersion,
    prNumber: job.prNumber,
    prUrl: job.prUrl,
    commitSha: job.commitSha,
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
    message: `Review job created for PR #${job.prNumber} (manual trigger)`,
    stage: null,
    metadata: {
      jobType: "review_pr",
      parentJobId: jobId,
      repoId: job.repoId,
      profileId: reviewProfileId,
    },
  };
  await createJobEvent(reviewEvent);

  await publishReviewPR({
    messageType: "review_pr",
    jobId: reviewJobId,
    jobType: "review_pr",
    parentJobId: jobId,
    repoId: job.repoId,
    repoUrl: job.repoUrl,
    baseBranch: job.baseBranch,
    workBranch: job.workBranch,
    profileId: reviewProfileId,
    bundleVersion: reviewProfile?.bundleVersion ?? job.bundleVersion,
    prNumber: job.prNumber,
    prUrl: job.prUrl,
    aiAgentId: reviewAiAgentId,
    createdAt: now,
  });

  return buildSuccessResponse(201, {
    reviewJobId,
    message: `Review job created for PR #${job.prNumber}`,
  });
}

// ─── POST /jobs/{jobId}/review/fix ───

async function handleTriggerReviewFix(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const jobId = requirePathParam(event, "jobId");
  const job = await getJobById(jobId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  if (!job.reviewReport) {
    throw new ValidationError("Job has no review report to fix");
  }
  if (!job.prNumber || !job.prUrl) {
    throw new ValidationError("Job has no PR — nothing to push fixes to");
  }

  const profileId = job.featureProfileId;
  const profile = await getProfileById(profileId);
  const now = new Date().toISOString();
  const fixJobId = crypto.randomUUID();

  const fixJob: Job = {
    jobId: fixJobId,
    jobType: "implement_review_fix",
    parentJobId: jobId,
    repoId: job.repoId,
    repoUrl: job.repoUrl,
    baseBranch: job.baseBranch,
    workBranch: job.workBranch,
    title: `Fix review issues for PR #${job.prNumber}`,
    description: `Implement fixes from code review on PR #${job.prNumber}`,
    status: JobStatusEnum.QUEUED,
    requestedBy: userId,
    assignedAgentId: null,
    featureProfileId: profileId,
    reviewProfileId: job.reviewProfileId,
    aiAgentId: job.aiAgentId,
    bundleVersion: profile?.bundleVersion ?? job.bundleVersion,
    prNumber: job.prNumber,
    prUrl: job.prUrl,
    commitSha: job.commitSha,
    reviewOutcome: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    specPhase: SpecPhaseEnum.TASKS,
    reviewReport: null,
    reviewJobId: null,
    reviewHistory: [],
  };

  await createJob(fixJob);

  // Pre-populate spec: auto-approve requirements (from review report) and
  // design, then start at tasks phase so the agent only needs to generate
  // fix tasks and implement them.
  const now2 = new Date().toISOString();
  const spec = createEmptySpec(fixJobId);
  spec.currentPhase = SpecPhaseEnum.TASKS;
  spec.phases[SpecPhaseEnum.REQUIREMENTS] = {
    phase: SpecPhaseEnum.REQUIREMENTS,
    status: SpecPhaseStatus.APPROVED,
    items: [{ id: "REQ-1", content: `Fix issues from code review:\n\n${job.reviewReport}`, completed: false }],
    generatedAt: now2,
    approvedAt: now2,
    rejectionReason: null,
    revision: 0,
  };
  spec.phases[SpecPhaseEnum.DESIGN] = {
    phase: SpecPhaseEnum.DESIGN,
    status: SpecPhaseStatus.APPROVED,
    items: [{ id: "DESIGN-1", content: "Apply targeted fixes to existing codebase based on review findings. No architectural changes required.", completed: false }],
    generatedAt: now2,
    approvedAt: now2,
    rejectionReason: null,
    revision: 0,
  };
  await createSpec(spec);

  await createJobEvent({
    jobId: fixJobId,
    eventTs: now,
    eventType: "job_created",
    message: `Review fix job created for PR #${job.prNumber}`,
    stage: null,
    metadata: {
      jobType: "implement_review_fix",
      parentJobId: jobId,
      repoId: job.repoId,
      prNumber: job.prNumber,
    },
  });

  await createJobEvent({
    jobId,
    eventTs: now,
    eventType: "log",
    message: `Review fix job ${fixJobId} created`,
    stage: null,
    metadata: {
      action: "review_fix_created",
      fixJobId,
    },
  });

  await publishImplementReviewFix({
    messageType: "implement_review_fix",
    jobId: fixJobId,
    jobType: "implement_review_fix",
    parentJobId: jobId,
    repoId: job.repoId,
    repoUrl: job.repoUrl,
    baseBranch: job.baseBranch,
    workBranch: job.workBranch,
    profileId,
    bundleVersion: profile?.bundleVersion ?? job.bundleVersion,
    manifest: profile?.manifest ?? null,
    requestedBy: userId,
    title: fixJob.title,
    description: fixJob.description,
    reviewReport: job.reviewReport,
    prNumber: job.prNumber,
    prUrl: job.prUrl,
    aiAgentId: job.aiAgentId,
    createdAt: now,
  });

  return buildSuccessResponse(201, {
    fixJobId,
    message: `Review fix job created for PR #${job.prNumber}`,
  });
}

// ─── Router ───

export async function handler(
  rawEvent: unknown,
): Promise<APIGatewayProxyResult> {
  const event = normalizeEvent(rawEvent as Record<string, unknown>);
  const logger = createRequestLogger(event);
  try {
    const userId = await validateCognitoJwt(event);
    const method = event.httpMethod;
    const hasJobId = !!event.pathParameters?.jobId;
    const path = event.path ?? "";

    logger.info("Job handler invoked", { method, hasJobId });

    if (method === "POST" && !hasJobId) {
      return await handleCreate(event, userId);
    }

    if (method === "GET" && !hasJobId) {
      return await handleListJobs(event, userId);
    }

    if (method === "GET" && hasJobId) {
      if (path.endsWith("/spec/messages")) {
        return await handleGetPhaseMessages(event);
      }
      if (path.endsWith("/events")) {
        return await handleGetJobEvents(event);
      }
      if (path.endsWith("/artifacts")) {
        return await handleGetJobArtifacts(event);
      }
      if (path.endsWith("/spec")) {
        return await handleGetSpec(event);
      }
      return await handleGetJob(event);
    }

    if (method === "POST" && hasJobId && path.endsWith("/cancel")) {
      return await handleCancel(event);
    }
    if (method === "POST" && hasJobId && path.endsWith("/spec/approve")) {
      return await handleApprovePhase(event);
    }
    if (method === "POST" && hasJobId && path.endsWith("/spec/reject")) {
      return await handleRejectPhase(event);
    }
    if (method === "POST" && hasJobId && path.endsWith("/spec/messages")) {
      return await handlePostPhaseMessage(event, userId);
    }
    if (method === "POST" && hasJobId && path.endsWith("/review/fix")) {
      return await handleTriggerReviewFix(event, userId);
    }
    if (method === "POST" && hasJobId && path.endsWith("/review")) {
      return await handleTriggerReview(event, userId);
    }
    if (method === "PATCH" && hasJobId && path.endsWith("/spec/items")) {
      return await handleUpdateSpecItems(event);
    }

    return buildSuccessResponse(404, {
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  } catch (err) {
    logger.error("Job handler error", {
      error: (err as Error).message,
    });
    return buildErrorResponse(err as Error);
  }
}
