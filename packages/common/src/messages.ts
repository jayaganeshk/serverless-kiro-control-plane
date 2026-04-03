// ─── SQS Message Schemas ───

export interface ImplementFeatureMessage {
  messageType: "implement_feature";
  jobId: string;
  jobType: "implement_feature";
  repoId: string;
  repoUrl: string;
  baseBranch: string;
  workBranch: string;
  profileId: string;
  bundleVersion: number;
  manifest: Record<string, unknown> | null;
  requestedBy: string;
  title: string;
  description: string;
  constraints: string | null;
  aiAgentId: string | null;
  createdAt: string;
}

export interface ReviewPRMessage {
  messageType: "review_pr";
  jobId: string;
  jobType: "review_pr";
  parentJobId: string;
  repoId: string;
  repoUrl: string;
  baseBranch: string;
  workBranch: string;
  profileId: string;
  bundleVersion: number;
  prNumber: number;
  prUrl: string;
  aiAgentId: string | null;
  createdAt: string;
}

export interface ImplementReviewFixMessage {
  messageType: "implement_review_fix";
  jobId: string;
  jobType: "implement_review_fix";
  parentJobId: string;
  repoId: string;
  repoUrl: string;
  baseBranch: string;
  workBranch: string;
  profileId: string;
  bundleVersion: number;
  manifest: Record<string, unknown> | null;
  requestedBy: string;
  title: string;
  description: string;
  reviewReport: string;
  prNumber: number;
  prUrl: string;
  aiAgentId: string | null;
  createdAt: string;
}

export interface ResumeJobMessage {
  messageType: "resume_job";
  jobId: string;
  jobType: "implement_feature" | "implement_review_fix";
  repoId: string;
  repoUrl: string;
  baseBranch: string;
  workBranch: string;
  profileId: string;
  bundleVersion: number;
  manifest: Record<string, unknown> | null;
  requestedBy: string;
  title: string;
  description: string;
  constraints: string | null;
  aiAgentId: string | null;
  resumeFromPhase: string;
  createdAt: string;
}

export type SQSJobMessage = ImplementFeatureMessage | ReviewPRMessage | ImplementReviewFixMessage | ResumeJobMessage;
