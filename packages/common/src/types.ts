// ─── Job Status Enum ───

export enum JobStatus {
  QUEUED = "QUEUED",
  CLAIMED = "CLAIMED",
  RUNNING = "RUNNING",
  AWAITING_APPROVAL = "AWAITING_APPROVAL",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
  TIMED_OUT = "TIMED_OUT",
}

// ─── Job Type ───

export type JobType = "implement_feature" | "review_pr" | "implement_review_fix";

// ─── Feature Job Stages ───

export enum FeatureStage {
  VALIDATING_REPO = "VALIDATING_REPO",
  PREPARING_WORKSPACE = "PREPARING_WORKSPACE",
  APPLYING_BUNDLE = "APPLYING_BUNDLE",
  GENERATING_REQUIREMENTS = "GENERATING_REQUIREMENTS",
  AWAITING_REQUIREMENTS_APPROVAL = "AWAITING_REQUIREMENTS_APPROVAL",
  GENERATING_DESIGN = "GENERATING_DESIGN",
  AWAITING_DESIGN_APPROVAL = "AWAITING_DESIGN_APPROVAL",
  GENERATING_TASKS = "GENERATING_TASKS",
  AWAITING_TASKS_APPROVAL = "AWAITING_TASKS_APPROVAL",
  IMPLEMENTING_TASKS = "IMPLEMENTING_TASKS",
  RUNNING_KIRO = "RUNNING_KIRO",
  RUNNING_TESTS = "RUNNING_TESTS",
  COMMITTING = "COMMITTING",
  PUSHING = "PUSHING",
  CREATING_PR = "CREATING_PR",
  FINALIZING = "FINALIZING",
}

// ─── Review Job Stages ───

export enum ReviewStage {
  FETCHING_PR = "FETCHING_PR",
  PREPARING_DIFF = "PREPARING_DIFF",
  RUNNING_REVIEW = "RUNNING_REVIEW",
  POSTING_REVIEW = "POSTING_REVIEW",
  SETTING_STATUS = "SETTING_STATUS",
  FINALIZING = "FINALIZING",
}

export type Stage = FeatureStage | ReviewStage;

// ─── Valid State Transitions ───

export const VALID_TRANSITIONS: ReadonlyMap<JobStatus, ReadonlySet<JobStatus>> = new Map<JobStatus, Set<JobStatus>>([
  [JobStatus.QUEUED, new Set<JobStatus>([JobStatus.CLAIMED, JobStatus.CANCELLED, JobStatus.TIMED_OUT])],
  [JobStatus.CLAIMED, new Set<JobStatus>([JobStatus.RUNNING, JobStatus.CANCELLED, JobStatus.TIMED_OUT])],
  [JobStatus.RUNNING, new Set<JobStatus>([JobStatus.RUNNING, JobStatus.AWAITING_APPROVAL, JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED, JobStatus.TIMED_OUT])],
  [JobStatus.AWAITING_APPROVAL, new Set<JobStatus>([JobStatus.RUNNING, JobStatus.CANCELLED])],
]);

// ─── Feature Stage Order ───

export const FEATURE_STAGE_ORDER: readonly FeatureStage[] = [
  FeatureStage.VALIDATING_REPO,
  FeatureStage.PREPARING_WORKSPACE,
  FeatureStage.APPLYING_BUNDLE,
  FeatureStage.GENERATING_REQUIREMENTS,
  FeatureStage.AWAITING_REQUIREMENTS_APPROVAL,
  FeatureStage.GENERATING_DESIGN,
  FeatureStage.AWAITING_DESIGN_APPROVAL,
  FeatureStage.GENERATING_TASKS,
  FeatureStage.AWAITING_TASKS_APPROVAL,
  FeatureStage.IMPLEMENTING_TASKS,
  FeatureStage.RUNNING_KIRO,
  FeatureStage.RUNNING_TESTS,
  FeatureStage.COMMITTING,
  FeatureStage.PUSHING,
  FeatureStage.CREATING_PR,
  FeatureStage.FINALIZING,
];

// ─── Review Stage Order ───

export const REVIEW_STAGE_ORDER: readonly ReviewStage[] = [
  ReviewStage.FETCHING_PR,
  ReviewStage.PREPARING_DIFF,
  ReviewStage.RUNNING_REVIEW,
  ReviewStage.POSTING_REVIEW,
  ReviewStage.SETTING_STATUS,
  ReviewStage.FINALIZING,
];

// ─── Terminal Statuses ───

export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
  JobStatus.TIMED_OUT,
]);

// ─── Spec-Driven Development ───

export enum SpecPhase {
  REQUIREMENTS = "requirements",
  DESIGN = "design",
  TASKS = "tasks",
}

export enum SpecPhaseStatus {
  PENDING = "pending",
  GENERATING = "generating",
  DRAFT = "draft",
  APPROVED = "approved",
  REJECTED = "rejected",
}

export const SPEC_PHASE_ORDER: readonly SpecPhase[] = [
  SpecPhase.REQUIREMENTS,
  SpecPhase.DESIGN,
  SpecPhase.TASKS,
];

export type TaskItemStatus = "pending" | "in_progress" | "completed" | "failed";

export interface SpecItem {
  id: string;
  content: string;
  completed?: boolean;
  taskStatus?: TaskItemStatus;
}

export interface SpecPhaseData {
  phase: SpecPhase;
  status: SpecPhaseStatus;
  items: SpecItem[];
  generatedAt: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  revision: number;
}

export interface JobSpec {
  jobId: string;
  currentPhase: SpecPhase;
  phases: Record<SpecPhase, SpecPhaseData>;
  updatedAt: string;
}

export function createEmptySpec(jobId: string): JobSpec {
  const now = new Date().toISOString();
  const makePhase = (phase: SpecPhase): SpecPhaseData => ({
    phase,
    status: phase === SpecPhase.REQUIREMENTS ? SpecPhaseStatus.PENDING : SpecPhaseStatus.PENDING,
    items: [],
    generatedAt: null,
    approvedAt: null,
    rejectionReason: null,
    revision: 0,
  });

  return {
    jobId,
    currentPhase: SpecPhase.REQUIREMENTS,
    phases: {
      [SpecPhase.REQUIREMENTS]: makePhase(SpecPhase.REQUIREMENTS),
      [SpecPhase.DESIGN]: makePhase(SpecPhase.DESIGN),
      [SpecPhase.TASKS]: makePhase(SpecPhase.TASKS),
    },
    updatedAt: now,
  };
}

// ─── Updated Feature Stages (spec-driven) ───

export enum FeatureStageV2 {
  VALIDATING_REPO = "VALIDATING_REPO",
  PREPARING_WORKSPACE = "PREPARING_WORKSPACE",
  APPLYING_BUNDLE = "APPLYING_BUNDLE",
  GENERATING_REQUIREMENTS = "GENERATING_REQUIREMENTS",
  AWAITING_REQUIREMENTS_APPROVAL = "AWAITING_REQUIREMENTS_APPROVAL",
  GENERATING_DESIGN = "GENERATING_DESIGN",
  AWAITING_DESIGN_APPROVAL = "AWAITING_DESIGN_APPROVAL",
  GENERATING_TASKS = "GENERATING_TASKS",
  AWAITING_TASKS_APPROVAL = "AWAITING_TASKS_APPROVAL",
  IMPLEMENTING_TASKS = "IMPLEMENTING_TASKS",
  RUNNING_TESTS = "RUNNING_TESTS",
  COMMITTING = "COMMITTING",
  PUSHING = "PUSHING",
  CREATING_PR = "CREATING_PR",
  FINALIZING = "FINALIZING",
}

// ─── Updated Valid State Transitions ───

export const VALID_TRANSITIONS_V2: ReadonlyMap<JobStatus, ReadonlySet<JobStatus>> = new Map<JobStatus, Set<JobStatus>>([
  [JobStatus.QUEUED, new Set<JobStatus>([JobStatus.CLAIMED, JobStatus.CANCELLED, JobStatus.TIMED_OUT])],
  [JobStatus.CLAIMED, new Set<JobStatus>([JobStatus.RUNNING, JobStatus.CANCELLED, JobStatus.TIMED_OUT])],
  [JobStatus.RUNNING, new Set<JobStatus>([JobStatus.RUNNING, JobStatus.AWAITING_APPROVAL, JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED, JobStatus.TIMED_OUT])],
  [JobStatus.AWAITING_APPROVAL, new Set<JobStatus>([JobStatus.RUNNING, JobStatus.CANCELLED])],
]);

// ─── Review Outcome ───

export type ReviewOutcome = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

// ─── Artifact Type ───

export type ArtifactType = "log" | "patch" | "review_report" | "transcript" | "screenshot";

// ─── Job Event Type ───

export type JobEventType = "status_change" | "stage_transition" | "log" | "error" | "job_created" | "spec_update";

// ─── Repository Interface ───

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface Repository {
  repoId: string;
  name: string;
  url: string;
  provider: string;
  defaultBranch: string;
  defaultFeatureProfileId: string;
  defaultReviewProfileId: string | null;
  autoReviewEnabled: boolean;
  mcpServers: McpServerConfig[];
  status: "active" | "archived";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Git Credential Types ───

export type GitCredentialType = "https_basic" | "ssh_key" | "codecommit_iam";

export interface GitCredential {
  repoId: string;
  credentialType: GitCredentialType;
  secretArn: string | null;
  username: string | null;
  configured: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Profile Interface ───

export interface Profile {
  profileId: string;
  name: string;
  profileType: "feature" | "reviewer";
  bundleVersion: number;
  bundleS3Key: string;
  description: string;
  manifest: Record<string, unknown> | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Agent Interface ───

export interface AgentMachineInfo {
  hostname: string;
  os: string;
  arch: string;
  cpuCores: number;
  memoryGB: number;
  nodeVersion: string;
  ipAddress: string | null;
}

export interface Agent {
  agentId: string;
  machineLabel: string;
  capabilities: string[];
  workspaceRoot: string;
  status: "online" | "offline";
  lastHeartbeatAt: string;
  repoAllowlist: string[];
  maxConcurrentJobs: number;
  currentJobIds: string[];
  agentVersion: string | null;
  machine: AgentMachineInfo | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Job Interface ───

export interface ReviewHistoryEntry {
  reviewJobId: string;
  reviewReport: string;
  reviewOutcome: string;
  reviewedAt: string;
}

export interface Job {
  jobId: string;
  jobType: JobType;
  parentJobId: string | null;
  repoId: string;
  repoUrl: string;
  baseBranch: string;
  workBranch: string;
  title: string;
  description: string;
  status: JobStatus;
  requestedBy: string;
  assignedAgentId: string | null;
  featureProfileId: string;
  reviewProfileId: string | null;
  aiAgentId: string | null;
  bundleVersion: number;
  prNumber: number | null;
  prUrl: string | null;
  commitSha: string | null;
  reviewOutcome: ReviewOutcome | null;
  reviewReport: string | null;
  reviewJobId: string | null;
  reviewHistory: ReviewHistoryEntry[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  specPhase: SpecPhase | null;
}

// ─── Job Event Interface ───

export interface JobEvent {
  jobId: string;
  eventTs: string;
  eventType: JobEventType;
  message: string;
  stage: string | null;
  metadata: Record<string, unknown>;
}

// ─── AI Agent Config (Kiro CLI Agent) ───

export type AIAgentCategory =
  | "ui_frontend"
  | "backend"
  | "python"
  | "aws_serverless"
  | "fullstack"
  | "code_review"
  | "security_review"
  | "custom";

export interface KiroMcpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
  disabled?: boolean;
  autoApprove?: string[];
}

export interface KiroAgentConfig {
  name: string;
  description: string;
  prompt: string;
  model?: string;
  tools?: string[];
  allowedTools?: string[];
  mcpServers?: Record<string, KiroMcpServerEntry>;
  includeMcpJson?: boolean;
  resources?: string[];
}

export interface AIAgentConfig {
  aiAgentId: string;
  name: string;
  category: AIAgentCategory;
  description: string;
  kiroConfig: KiroAgentConfig;
  isDefault: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Artifact Interface ───

export interface Artifact {
  jobId: string;
  artifactId: string;
  artifactType: ArtifactType;
  s3Key: string;
  contentType: string;
  createdAt: string;
}
