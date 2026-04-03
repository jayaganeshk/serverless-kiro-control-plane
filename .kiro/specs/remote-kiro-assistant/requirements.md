# Requirements Document

## Introduction

The Remote Kiro Coding Assistant is a serverless control-plane application that enables users to submit coding tasks from a web portal, dispatch those tasks to a local execution agent running on a user-controlled machine, execute the task through Kiro ACP (Agent Control Protocol), create a pull request, and automatically run a review step against that PR. The system uses AWS serverless architecture with REST-only portal APIs, SQS-based asynchronous job dispatch, local execution of Kiro and Git operations, versioned Kiro configuration profiles, and automatic PR review as a first-class workflow step.

## Glossary

- **Portal**: The Vue.js single-page application hosted on S3 and CloudFront that serves as the user-facing web interface for the system.
- **Backend**: The set of AWS Lambda functions behind Amazon API Gateway that implement the REST API for the system.
- **Local_Agent**: A background process running on a user-controlled machine that polls SQS for jobs, executes Kiro ACP, performs Git operations, and reports results back to the Backend.
- **Job**: A unit of work tracked in DynamoDB representing either a feature implementation request or a PR review request.
- **Feature_Job**: A Job of type `implement_feature` that instructs the Local_Agent to implement a coding task, create a branch, and open a pull request.
- **Review_Job**: A Job of type `review_pr` that instructs the Local_Agent to review a pull request using Kiro in reviewer mode and post findings to GitHub.
- **Repository**: A registered Git repository record stored in DynamoDB containing the URL, default branch, default profile, and review policy.
- **Execution_Profile**: A named configuration record in DynamoDB that references a versioned Config_Bundle and defines Kiro behavior for a specific role such as feature implementation or PR review.
- **Config_Bundle**: A versioned artifact stored in S3 containing Kiro configuration files including agents, skills, steering rules, and settings packaged as a structured archive.
- **Job_State_Machine**: The defined set of statuses and stage transitions that a Job progresses through from creation to completion or failure.
- **Artifact**: A file produced during job execution such as logs, patches, review reports, or transcripts, stored in S3 and referenced by job ID.
- **Job_Event**: A timestamped record in DynamoDB capturing a state transition, log entry, or notable occurrence during job processing.
- **Capability_Tag**: A label assigned to a Local_Agent indicating the tools and runtimes available on the host machine, such as `node`, `python`, `java`, `docker`, `frontend`, `backend`, `fullstack`, or `reviewer`.
- **Workspace**: A local directory on the agent machine where a repository is cloned, configured, and used for Kiro execution.
- **DLQ**: Dead Letter Queue, an SQS queue that receives messages that could not be successfully processed after the configured number of retry attempts.
- **Cognito**: Amazon Cognito, the AWS service used for user authentication and JWT token issuance for Portal access.
- **SQS**: Amazon Simple Queue Service, used for asynchronous job dispatch from the Backend to Local_Agents.
- **PR**: Pull Request, a GitHub mechanism for proposing and reviewing code changes on a branch.
- **Kiro_ACP**: Kiro Agent Control Protocol, a JSON-RPC 2.0 protocol over stdin/stdout used to programmatically control a `kiro-cli acp` subprocess. The protocol follows a lifecycle of `initialize` (declaring protocol version and client capabilities), `session/new` (creating a session with a working directory and optional MCP servers), and `session/prompt` (sending prompts and receiving streaming updates including `AgentMessageChunk`, `ToolCall`, `ToolCallUpdate`, and `TurnEnd` events).

## Requirements

### Requirement 1: User Authentication

**User Story:** As a portal user, I want to authenticate securely through the Portal, so that only authorized users can access the system.

#### Acceptance Criteria

1. WHEN a user navigates to the Portal, THE Portal SHALL redirect unauthenticated users to the Cognito-hosted login page.
2. WHEN Cognito returns a valid JWT token after login, THE Portal SHALL store the token and use the token for all subsequent Backend API calls.
3. WHEN a Backend API request is received without a valid Cognito JWT token, THE Backend SHALL reject the request with HTTP 401 status.
4. WHEN a stored JWT token expires, THE Portal SHALL attempt to refresh the token using the Cognito refresh token before prompting the user to log in again.

### Requirement 2: Repository Registration

**User Story:** As a portal user, I want to register Git repositories in the Portal, so that I can submit coding tasks against those repositories.

#### Acceptance Criteria

1. WHEN a user submits a repository URL via POST /repositories, THE Backend SHALL create a Repository record in DynamoDB with a unique repoId, the provided URL, and a status of active.
2. THE Backend SHALL store a default base branch for each registered Repository.
3. THE Backend SHALL store a default Execution_Profile reference for each registered Repository.
4. THE Backend SHALL store an auto-PR-review flag for each registered Repository indicating whether Review_Jobs are created automatically after successful Feature_Jobs.
5. WHEN a user requests GET /repositories, THE Backend SHALL return the list of all registered Repositories for the authenticated user.
6. WHEN a user submits PATCH /repositories/{repoId}, THE Backend SHALL update the specified Repository fields including default branch, default profile, and auto-PR-review flag.
7. IF a repository URL is submitted that duplicates an existing registered Repository URL for the same user, THEN THE Backend SHALL reject the request with HTTP 409 status and a descriptive error message.

### Requirement 3: Execution Profile Management

**User Story:** As a portal user, I want to select from approved execution profiles, so that Kiro behavior is versioned and reproducible for each task.

#### Acceptance Criteria

1. WHEN an admin submits POST /profiles with a profile name, role designation, and configuration metadata, THE Backend SHALL create an Execution_Profile record in DynamoDB with a unique profileId.
2. WHEN a user requests GET /profiles, THE Backend SHALL return the list of all published Execution_Profiles.
3. THE Backend SHALL store the role designation for each Execution_Profile as either `feature` or `reviewer`.
4. THE Backend SHALL store a reference to the active Config_Bundle version for each Execution_Profile.
5. WHEN a user selects an Execution_Profile during job creation, THE Backend SHALL validate that the selected Execution_Profile exists and is in published status.

### Requirement 4: Config Bundle Publishing

**User Story:** As an admin, I want to publish versioned Kiro configuration bundles, so that execution behavior is controlled and reproducible.

#### Acceptance Criteria

1. WHEN an admin submits POST /profiles/{profileId}/publish-bundle with a Config_Bundle archive, THE Backend SHALL upload the archive to S3 with a versioned key and update the Execution_Profile record to reference the new bundle version.
2. THE Backend SHALL store each Config_Bundle in S3 with a key structure that includes the profileId and a monotonically increasing version number.
3. THE Backend SHALL validate that a Config_Bundle archive contains a manifest.json file before accepting the upload.
4. IF a Config_Bundle archive is missing manifest.json, THEN THE Backend SHALL reject the upload with HTTP 400 status and a descriptive error message.
5. THE Backend SHALL retain previous Config_Bundle versions in S3 to allow rollback.
6. THE Backend SHALL reject Config_Bundle archives that contain executable hooks or MCP server definitions that reference external network endpoints outside the local machine.


### Requirement 5: Feature Job Submission

**User Story:** As a portal user, I want to submit a feature implementation request against a selected repository, so that the Local_Agent can execute the coding task through Kiro.

#### Acceptance Criteria

1. WHEN a user submits POST /jobs with jobType `implement_feature`, a repoId, a branch name, a profileId, a feature description, and optional constraints, THE Backend SHALL create a Job record in DynamoDB with a unique jobId and status QUEUED.
2. WHEN a Feature_Job record is created with status QUEUED, THE Backend SHALL publish an `implement_feature` message to the SQS queue containing the jobId, repoId, branch, profileId, feature description, and constraints.
3. THE Backend SHALL validate that the referenced repoId exists and is active before creating the Job record.
4. THE Backend SHALL validate that the referenced profileId exists and is published before creating the Job record.
5. IF the repoId or profileId is invalid, THEN THE Backend SHALL reject the request with HTTP 400 status and a descriptive error message identifying the invalid reference.
6. THE Backend SHALL record a Job_Event with type `job_created` and timestamp when a new Job is created.

### Requirement 6: Feature Job Execution by Local Agent

**User Story:** As a local agent operator, I want the Local_Agent to receive, execute, and report on feature implementation jobs, so that coding tasks are performed on the local machine using Kiro ACP.

#### Acceptance Criteria

1. WHEN the Local_Agent receives an `implement_feature` message from SQS, THE Local_Agent SHALL call POST /jobs/{jobId}/claim to claim the Job.
2. WHEN the Backend receives a claim request for a Job in QUEUED status, THE Backend SHALL update the Job status to CLAIMED and record the agentId.
3. IF the Backend receives a claim request for a Job not in QUEUED status, THEN THE Backend SHALL reject the claim with HTTP 409 status.
4. WHEN the Local_Agent has claimed a Feature_Job, THE Local_Agent SHALL update the Job status to RUNNING via PATCH /jobs/{jobId}/status.
5. WHILE processing a Feature_Job, THE Local_Agent SHALL progress through the following stages in order: VALIDATING_REPO, PREPARING_WORKSPACE, APPLYING_BUNDLE, RUNNING_KIRO, RUNNING_TESTS, COMMITTING, PUSHING, CREATING_PR, FINALIZING.
6. WHILE processing a Feature_Job, THE Local_Agent SHALL post a Job_Event via POST /jobs/{jobId}/events for each stage transition.
7. WHEN the Local_Agent enters the PREPARING_WORKSPACE stage, THE Local_Agent SHALL clone the repository if absent locally, fetch latest refs, checkout the base branch, and create a working branch.
8. WHEN the Local_Agent enters the APPLYING_BUNDLE stage, THE Local_Agent SHALL download the Config_Bundle from S3 and materialize the bundle contents into the .kiro/ directory of the Workspace.
9. WHEN the Local_Agent enters the RUNNING_KIRO stage, THE Local_Agent SHALL spawn a `kiro-cli acp` subprocess, send an `initialize` request with protocolVersion 1 and client capabilities (fs read/write, terminal), create a session via `session/new` with the Workspace directory as cwd, and send a `session/prompt` request with the feature description and constraints as the prompt text.
10. WHEN the Local_Agent enters the RUNNING_TESTS stage, THE Local_Agent SHALL execute the validation steps defined in the Config_Bundle such as tests, lint, and build commands.
11. WHEN the Local_Agent enters the COMMITTING stage, THE Local_Agent SHALL commit all changes to the working branch with a descriptive commit message.
12. WHEN the Local_Agent enters the PUSHING stage, THE Local_Agent SHALL push the working branch to the remote repository.
13. WHEN the Local_Agent enters the CREATING_PR stage, THE Local_Agent SHALL create a PR in GitHub from the working branch to the base branch with the feature description as the PR body.
14. WHEN the PR is created successfully, THE Local_Agent SHALL update the Job record with the PR URL, PR number, and head branch name via PATCH /jobs/{jobId}/status.
15. WHEN all Feature_Job stages complete successfully, THE Local_Agent SHALL call POST /jobs/{jobId}/complete to set the Job status to COMPLETED.
16. IF any stage of a Feature_Job fails, THEN THE Local_Agent SHALL call POST /jobs/{jobId}/fail with the failure reason and the stage at which the failure occurred.
17. WHEN a Feature_Job reaches COMPLETED status, THE Local_Agent SHALL delete the SQS message.
18. WHEN a Feature_Job reaches FAILED status, THE Local_Agent SHALL delete the SQS message.

### Requirement 7: Automatic PR Review Triggering

**User Story:** As a portal user, I want PR reviews to be triggered automatically after a feature PR is created, so that every PR receives a structured review without manual intervention.

#### Acceptance Criteria

1. WHEN a Feature_Job reaches COMPLETED status and the associated Repository has auto-PR-review enabled, THE Backend SHALL create a Review_Job linked to the original Feature_Job with the PR metadata.
2. WHEN a Review_Job is created, THE Backend SHALL publish a `review_pr` message to the SQS queue containing the jobId, repoId, PR number, PR branch, and reviewer profileId.
3. THE Backend SHALL use the Repository default reviewer Execution_Profile for automatically triggered Review_Jobs unless the original Feature_Job specifies an override.
4. THE Backend SHALL store the parent Feature_Job jobId as a reference in the Review_Job record.

### Requirement 8: PR Review Job Execution by Local Agent

**User Story:** As a local agent operator, I want the Local_Agent to execute PR review jobs using Kiro in reviewer mode, so that structured review findings are posted to GitHub.

#### Acceptance Criteria

1. WHEN the Local_Agent receives a `review_pr` message from SQS, THE Local_Agent SHALL claim and process the Review_Job following the same claim protocol as Feature_Jobs.
2. WHILE processing a Review_Job, THE Local_Agent SHALL progress through the following stages in order: FETCHING_PR, PREPARING_DIFF, RUNNING_REVIEW, POSTING_REVIEW, SETTING_STATUS, FINALIZING.
3. WHEN the Local_Agent enters the FETCHING_PR stage, THE Local_Agent SHALL fetch the latest PR refs and metadata from GitHub.
4. WHEN the Local_Agent enters the PREPARING_DIFF stage, THE Local_Agent SHALL generate the diff between the PR branch and the base branch.
5. WHEN the Local_Agent enters the RUNNING_REVIEW stage, THE Local_Agent SHALL spawn a `kiro-cli acp` subprocess, initialize a session with the Workspace directory as cwd, and send a `session/prompt` request with the reviewer Execution_Profile context and the PR diff as the prompt text.
6. WHEN the Local_Agent enters the POSTING_REVIEW stage, THE Local_Agent SHALL post the review findings as a PR review to GitHub with inline comments where applicable.
7. WHEN the Local_Agent enters the SETTING_STATUS stage, THE Local_Agent SHALL set a commit status or check result on the PR head commit in GitHub.
8. WHEN all Review_Job stages complete successfully, THE Local_Agent SHALL upload the review artifact JSON and markdown report to S3 via presigned URL obtained from POST /jobs/{jobId}/artifacts/presign.
9. WHEN all Review_Job stages complete successfully, THE Local_Agent SHALL call POST /jobs/{jobId}/complete to set the Job status to COMPLETED.
10. IF any stage of a Review_Job fails, THEN THE Local_Agent SHALL call POST /jobs/{jobId}/fail with the failure reason and the stage at which the failure occurred.

### Requirement 9: Re-Review on New Commits

**User Story:** As a portal user, I want a new review to be triggered automatically when new commits are pushed to a PR branch, so that reviews stay current with the latest code changes.

#### Acceptance Criteria

1. WHEN GitHub sends a webhook event for a push to a branch that has an open PR associated with a completed Feature_Job, THE Backend SHALL create a new Review_Job for that PR.
2. WHEN the Backend receives a GitHub webhook POST /webhooks/github, THE Backend SHALL validate the webhook signature using the configured webhook secret before processing.
3. IF the webhook signature is invalid, THEN THE Backend SHALL reject the request with HTTP 401 status.
4. THE Backend SHALL deduplicate re-review requests by checking that no QUEUED or RUNNING Review_Job already exists for the same PR before creating a new one.


### Requirement 10: Local Agent Registration and Heartbeat

**User Story:** As a local agent operator, I want to register the Local_Agent with the Backend and send periodic heartbeats, so that the Backend knows which agents are available.

#### Acceptance Criteria

1. WHEN the Local_Agent starts, THE Local_Agent SHALL call POST /agents/register with the machine ID, machine label, Capability_Tags, repo allowlist, and workspace root path.
2. WHEN the Backend receives an agent registration request, THE Backend SHALL create or update an Agent record in DynamoDB with a unique agentId, the provided metadata, and a last-seen timestamp.
3. WHILE the Local_Agent is running, THE Local_Agent SHALL call POST /agents/{agentId}/heartbeat at the configured polling interval to update the last-seen timestamp.
4. THE Backend SHALL consider an Agent offline if no heartbeat has been received within three times the configured polling interval.
5. THE Backend SHALL authenticate agent API calls using IAM authentication (SigV4 signed requests) with the same IAM role the agent uses for SQS access.

### Requirement 11: Job Cancellation

**User Story:** As a portal user, I want to cancel a queued or running job, so that I can stop work that is no longer needed.

#### Acceptance Criteria

1. WHEN a user submits POST /jobs/{jobId}/cancel for a Job in QUEUED status, THE Backend SHALL update the Job status to CANCELLED and record a Job_Event.
2. WHEN a user submits POST /jobs/{jobId}/cancel for a Job in CLAIMED or RUNNING status, THE Backend SHALL update the Job status to CANCELLED and record a Job_Event.
3. WHILE processing a Job, THE Local_Agent SHALL check the Job status before each stage transition and stop processing if the status is CANCELLED.
4. IF a user submits POST /jobs/{jobId}/cancel for a Job in COMPLETED, FAILED, CANCELLED, or TIMED_OUT status, THEN THE Backend SHALL reject the request with HTTP 409 status and a descriptive error message.

### Requirement 12: Artifact Management

**User Story:** As a portal user, I want to view logs, patches, and reports generated during job execution, so that I can understand what the Local_Agent did and review the outputs.

#### Acceptance Criteria

1. WHEN the Local_Agent needs to upload an artifact, THE Local_Agent SHALL call POST /jobs/{jobId}/artifacts/presign with the artifact type and filename to obtain a presigned S3 upload URL.
2. WHEN the Backend receives a presign request, THE Backend SHALL generate a presigned S3 PUT URL scoped to the job ID and artifact ID and return the URL to the Local_Agent.
3. WHEN the Local_Agent has uploaded an artifact to S3, THE Local_Agent SHALL record the artifact metadata in DynamoDB via the Backend API including artifact type, filename, S3 key, and size.
4. WHEN a user requests GET /jobs/{jobId}/artifacts, THE Backend SHALL return the list of artifacts associated with the Job including presigned download URLs.
5. THE Backend SHALL support the following artifact types: `log`, `patch`, `review_report`, `transcript`, and `screenshot`.

### Requirement 13: Job Event Tracking

**User Story:** As a portal user, I want to see the detailed event history of a job, so that I can understand the progression and diagnose issues.

#### Acceptance Criteria

1. WHEN the Local_Agent posts a Job_Event via POST /jobs/{jobId}/events, THE Backend SHALL store the event in the JobEvents DynamoDB table with the jobId as partition key and the event timestamp as sort key.
2. THE Backend SHALL store the event type, stage name, message, and optional metadata for each Job_Event.
3. WHEN a user requests GET /jobs/{jobId}/events, THE Backend SHALL return the list of Job_Events for the specified Job in chronological order.
4. THE Backend SHALL record system-generated Job_Events for status transitions including job creation, claim, completion, failure, and cancellation.

### Requirement 14: Portal Job Visibility

**User Story:** As a portal user, I want to browse and inspect jobs from the Portal, so that I can monitor progress and review outcomes.

#### Acceptance Criteria

1. WHEN a user requests GET /jobs, THE Backend SHALL return a paginated list of Jobs for the authenticated user with the most recent jobs first.
2. WHEN a user requests GET /jobs with a filter parameter for status, THE Backend SHALL return only Jobs matching the specified status.
3. WHEN a user requests GET /jobs/{jobId}, THE Backend SHALL return the full Job record including status, stage, PR metadata, agent ID, timestamps, and linked job references.
4. THE Portal SHALL display the current status and stage of each Job with visual indicators for QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED, and TIMED_OUT states.
5. THE Portal SHALL provide a link to the GitHub PR from the Job detail view when PR metadata is available.
6. THE Portal SHALL display the Job_Event timeline on the Job detail view.
7. THE Portal SHALL display downloadable links for Job artifacts on the Job detail view.

### Requirement 15: Job State Machine Integrity

**User Story:** As a system operator, I want the job state machine to enforce valid transitions, so that jobs cannot enter inconsistent states.

#### Acceptance Criteria

1. THE Backend SHALL enforce the following valid status transitions for Jobs: QUEUED to CLAIMED, CLAIMED to RUNNING, RUNNING to COMPLETED, RUNNING to FAILED, QUEUED to CANCELLED, CLAIMED to CANCELLED, RUNNING to CANCELLED, QUEUED to TIMED_OUT, CLAIMED to TIMED_OUT, RUNNING to TIMED_OUT.
2. IF a status update request specifies a transition not in the valid transition set, THEN THE Backend SHALL reject the request with HTTP 409 status and a descriptive error message.
3. THE Backend SHALL use DynamoDB conditional writes to prevent concurrent status updates from creating race conditions.
4. THE Backend SHALL record the previous status and new status in the Job_Event for every status transition.

### Requirement 16: SQS Message Handling and Idempotency

**User Story:** As a system operator, I want job processing to be idempotent and resilient to duplicate SQS deliveries, so that duplicate messages do not cause duplicate work or inconsistent state.

#### Acceptance Criteria

1. WHEN the Local_Agent receives an SQS message, THE Local_Agent SHALL attempt to claim the Job via the Backend API before performing any work.
2. IF the claim request fails with HTTP 409 because the Job is already claimed, THEN THE Local_Agent SHALL delete the SQS message without performing any work.
3. THE Local_Agent SHALL delete the SQS message only after the Job reaches a terminal status of COMPLETED, FAILED, or CANCELLED.
4. THE Backend SHALL configure a Dead Letter Queue for the SQS job queue with a maximum receive count of 3.
5. WHEN a message is moved to the DLQ after exceeding the maximum receive count, THE Backend SHALL record a Job_Event indicating DLQ transfer for the associated Job.

### Requirement 17: Local Agent Network Resilience

**User Story:** As a local agent operator, I want the Local_Agent to tolerate temporary network interruptions, so that transient connectivity issues do not cause job failures.

#### Acceptance Criteria

1. WHEN a Backend API call from the Local_Agent fails due to a network error or HTTP 5xx response, THE Local_Agent SHALL retry the call with exponential backoff up to 3 times before treating the call as failed.
2. WHEN SQS polling fails due to a network error, THE Local_Agent SHALL wait for the configured polling interval before retrying.
3. WHILE the Local_Agent is unable to reach the Backend, THE Local_Agent SHALL continue to buffer Job_Events locally and flush the buffer when connectivity is restored.

### Requirement 18: Job Timeout

**User Story:** As a system operator, I want jobs to be timed out if they run too long, so that stuck jobs do not block the system indefinitely.

#### Acceptance Criteria

1. THE Backend SHALL enforce a configurable maximum duration for each Job type, defaulting to 30 minutes for Feature_Jobs and 15 minutes for Review_Jobs.
2. WHEN a Job has been in RUNNING status longer than the maximum duration, THE Backend SHALL update the Job status to TIMED_OUT and record a Job_Event.
3. WHILE processing a Job, THE Local_Agent SHALL check elapsed time before each stage transition and self-terminate the Job if the maximum duration is exceeded.


### Requirement 19: Credential and Secret Security

**User Story:** As a system operator, I want sensitive credentials to be protected, so that secrets are not exposed in plaintext in storage or transit.

#### Acceptance Criteria

1. THE Backend SHALL transmit all API traffic over HTTPS only.
2. THE Local_Agent SHALL transmit all API traffic to the Backend over HTTPS only.
3. THE Backend SHALL store no Git credentials or GitHub tokens in DynamoDB or S3.
4. THE Local_Agent SHALL use locally configured Git credentials and GitHub authentication and SHALL NOT transmit Git credentials to the Backend.
5. THE Backend SHALL validate Cognito JWT tokens on every portal API request.
6. THE Backend SHALL validate IAM SigV4 signatures on every agent API request.
7. THE Backend SHALL validate GitHub webhook signatures on every webhook request.

### Requirement 20: Observability and Logging

**User Story:** As a system operator, I want comprehensive logging and metrics, so that I can monitor system health and diagnose issues.

#### Acceptance Criteria

1. THE Backend SHALL log all Lambda invocations to CloudWatch Logs with the jobId included in structured log entries where applicable.
2. THE Backend SHALL emit CloudWatch metrics for job creation count, job completion count, job failure count, and job duration.
3. THE Backend SHALL emit CloudWatch metrics for SQS queue depth and DLQ message count.
4. THE Local_Agent SHALL write local execution logs to a configurable log directory with the jobId as part of the log filename.
5. WHEN a Job completes or fails, THE Local_Agent SHALL upload the execution log as an artifact to S3.

### Requirement 21: Portal User Interface Pages

**User Story:** As a portal user, I want a clear and functional web interface, so that I can manage repositories, profiles, and jobs without needing CLI access.

#### Acceptance Criteria

1. THE Portal SHALL provide a login page that redirects to Cognito for authentication.
2. THE Portal SHALL provide a dashboard page displaying a summary of recent Jobs with counts by status.
3. THE Portal SHALL provide a repository list page displaying all registered Repositories with their default branch and profile.
4. THE Portal SHALL provide a repository detail page allowing the user to edit the default branch, default profile, and auto-PR-review setting.
5. THE Portal SHALL provide a profile list page displaying all published Execution_Profiles with their role and active bundle version.
6. THE Portal SHALL provide a job creation form allowing the user to select a Repository, specify a branch, select an Execution_Profile, enter a feature description, and enter optional constraints.
7. THE Portal SHALL provide a job detail page displaying the Job status, stage, PR link, event timeline, and artifact download links.
8. THE Portal SHALL provide an admin page for publishing Config_Bundles to Execution_Profiles.
9. THE Portal SHALL use polling at a configurable interval to refresh job status on the dashboard and job detail pages without requiring WebSocket connections.

### Requirement 22: Serverless Infrastructure

**User Story:** As a system operator, I want all cloud components to be serverless, so that the system scales automatically and has minimal operational overhead.

#### Acceptance Criteria

1. THE Backend SHALL use Amazon API Gateway for all REST API endpoints.
2. THE Backend SHALL use AWS Lambda for all API request handling, queue publishing, webhook processing, and administrative operations.
3. THE Backend SHALL use Amazon DynamoDB for all operational metadata and job state storage.
4. THE Backend SHALL use Amazon S3 for all artifact storage including logs, patches, review reports, and Config_Bundles.
5. THE Backend SHALL use Amazon SQS for all asynchronous job dispatch to Local_Agents.
6. THE Portal SHALL be hosted as a static site on Amazon S3 with Amazon CloudFront as the CDN.
7. THE Backend SHALL use Amazon Cognito for portal user authentication and JWT token issuance.

### Requirement 23: Local Agent Configuration

**User Story:** As a local agent operator, I want to configure the Local_Agent with machine-specific settings, so that the agent operates correctly in the local environment.

#### Acceptance Criteria

1. THE Local_Agent SHALL read configuration from a local configuration file specifying machine ID, machine label, Capability_Tags, repo allowlist, workspace root, polling interval, maximum concurrent jobs, and default bundle cache directory.
2. THE Local_Agent SHALL validate that `kiro-cli` is installed and accessible on the local PATH and that `kiro-cli acp` can be spawned as a subprocess before starting job processing.
3. THE Local_Agent SHALL validate that Git is installed and accessible on the local PATH before starting job processing.
4. IF `kiro-cli` or Git is not found on the local PATH, THEN THE Local_Agent SHALL log an error and exit with a non-zero exit code.
5. THE Local_Agent SHALL respect the maximum concurrent jobs setting and defer polling for new messages when the limit is reached.
6. THE Local_Agent SHALL process only jobs for repositories listed in the repo allowlist when the allowlist is configured.

### Requirement 24: Config Bundle Application to Workspace

**User Story:** As a local agent operator, I want the Config_Bundle to be applied consistently to the workspace, so that Kiro executes with the correct versioned configuration.

#### Acceptance Criteria

1. WHEN the Local_Agent applies a Config_Bundle to a Workspace, THE Local_Agent SHALL extract the bundle contents into the .kiro/ directory of the Workspace, overwriting any existing .kiro/ contents.
2. THE Local_Agent SHALL cache downloaded Config_Bundles in the configured bundle cache directory to avoid redundant downloads.
3. WHEN the Local_Agent downloads a Config_Bundle, THE Local_Agent SHALL verify that the bundle version matches the version specified in the Job message.
4. THE Local_Agent SHALL apply Layer 4 machine global config from ~/.kiro/ as defaults, with Layer 3 workspace config from the Config_Bundle taking precedence.

### Requirement 25: GitHub Integration for PR Operations

**User Story:** As a local agent operator, I want the Local_Agent to create and review pull requests on GitHub, so that code changes and review findings are visible in the repository.

#### Acceptance Criteria

1. WHEN the Local_Agent creates a PR, THE Local_Agent SHALL use the locally configured GitHub authentication method such as SSH key, credential manager, GitHub CLI, or personal access token.
2. WHEN the Local_Agent creates a PR, THE Local_Agent SHALL set the PR title to a summary derived from the feature description and the PR body to the full feature description and constraints.
3. WHEN the Local_Agent posts a review to a PR, THE Local_Agent SHALL submit the review with a state of APPROVE, REQUEST_CHANGES, or COMMENT based on the review findings severity.
4. WHEN the Local_Agent sets a commit status on a PR, THE Local_Agent SHALL use a context name of `kiro-review` to distinguish the status from other CI checks.
5. IF the Local_Agent fails to authenticate with GitHub for PR operations, THEN THE Local_Agent SHALL fail the Job with a descriptive error message indicating the authentication failure.
