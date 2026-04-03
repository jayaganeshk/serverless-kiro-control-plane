# Implementation Plan: Remote Kiro Coding Assistant

## Overview

Incremental implementation of the serverless control-plane: shared backend foundation first, then resource-specific Lambdas, then the local agent daemon, then the portal SPA, and finally integration wiring. TypeScript throughout (backend Lambdas, agent daemon, Vue.js portal).

## Tasks

- [x] 1. Set up monorepo structure and shared backend foundation
  - [x] 1.1 Create monorepo directory layout with `packages/backend`, `packages/agent`, `packages/portal`, and shared `packages/common`
    - Initialize TypeScript configs, package.json files, and build scripts for each package
    - Define shared types/interfaces in `packages/common`: Job, Repository, Profile, Agent, JobEvent, Artifact, SQS message schemas, API response envelope
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5_

  - [x] 1.2 Implement DynamoDB access layer in `packages/backend/src/db/`
    - Create table client modules for Repositories, Profiles, Agents, Jobs, JobEvents, Artifacts
    - Implement conditional write helpers for job state machine transitions (ConditionExpression on status field)
    - Implement GSI query helpers for jobs-by-user, jobs-by-status lookups with pagination (nextToken)
    - _Requirements: 15.3, 15.4, 22.3_

  - [x] 1.3 Implement SQS publisher module in `packages/backend/src/sqs/publisher.ts`
    - `publishImplementFeature(jobData)` — builds and sends `implement_feature` message
    - `publishReviewPR(jobData)` — builds and sends `review_pr` message
    - Use jobId for deduplication
    - _Requirements: 5.2, 7.2, 16.4, 22.5_

  - [x] 1.4 Implement backend middleware layer in `packages/backend/src/middleware/`
    - Cognito JWT validation middleware for portal routes
    - IAM SigV4 validation middleware for agent routes (API Gateway IAM authorizer)
    - GitHub webhook signature (HMAC-SHA256) validation middleware
    - Request parsing, structured logging with jobId, and error response formatting
    - _Requirements: 1.3, 10.5, 9.2, 19.5, 19.6, 19.7, 20.1_

  - [x] 1.5 Implement job state machine validation in `packages/backend/src/state-machine.ts`
    - Define valid transitions map: QUEUED→CLAIMED, CLAIMED→RUNNING, RUNNING→COMPLETED, RUNNING→FAILED, QUEUED/CLAIMED/RUNNING→CANCELLED, QUEUED/CLAIMED/RUNNING→TIMED_OUT
    - `validateTransition(currentStatus, newStatus)` function that throws on invalid transitions
    - _Requirements: 15.1, 15.2_

- [x] 2. Checkpoint — Ensure shared foundation compiles and unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement Repository and Profile Lambda handlers
  - [x] 3.1 Implement Repository Lambda in `packages/backend/src/handlers/repository.ts`
    - POST /repositories — create repo record with unique repoId, URL, default branch, default profile, auto-PR-review flag; reject duplicate URLs with 409
    - GET /repositories — list repos for authenticated user
    - PATCH /repositories/{repoId} — update default branch, default profile, auto-PR-review flag
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ]* 3.2 Write unit tests for Repository Lambda
    - Test create, list, update, and duplicate URL rejection (409)
    - _Requirements: 2.1, 2.5, 2.6, 2.7_

  - [x] 3.3 Implement Profile Lambda in `packages/backend/src/handlers/profile.ts`
    - POST /profiles — create profile with name, role (`feature`/`reviewer`), config metadata
    - GET /profiles — list all published profiles
    - POST /profiles/{profileId}/publish-bundle — upload bundle to S3 with versioned key, validate manifest.json presence, reject missing manifest with 400, reject bundles with external network MCP endpoints, update profile with new bundle version
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 3.4 Write unit tests for Profile Lambda
    - Test profile creation, listing, bundle upload with valid/invalid manifest, security rejection
    - _Requirements: 3.1, 4.3, 4.4, 4.6_

- [x] 4. Implement Job Lambda handlers
  - [x] 4.1 Implement Job submission handler in `packages/backend/src/handlers/job.ts`
    - POST /jobs — validate repoId exists and active, validate profileId exists and published, create Job record (QUEUED), write job_created JobEvent, publish SQS message; reject invalid refs with 400
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 4.2 Implement Job query handlers
    - GET /jobs — paginated list for authenticated user, most recent first, optional status filter
    - GET /jobs/{jobId} — full job record with status, stage, PR metadata, agent ID, timestamps, linked jobs
    - GET /jobs/{jobId}/events — chronological event list
    - GET /jobs/{jobId}/artifacts — artifact list with presigned download URLs
    - _Requirements: 14.1, 14.2, 14.3, 12.4, 13.3_

  - [x] 4.3 Implement Job claim, status update, events, artifacts, complete, and fail handlers in `packages/backend/src/handlers/job-worker.ts`
    - POST /jobs/{jobId}/claim — conditional write QUEUED→CLAIMED with agentId, reject non-QUEUED with 409
    - PATCH /jobs/{jobId}/status — validate transition via state machine, update status/stage/PR metadata, record JobEvent with previous and new status
    - POST /jobs/{jobId}/events — store event in JobEvents table (partition: jobId, sort: timestamp)
    - POST /jobs/{jobId}/artifacts/presign — generate presigned S3 PUT URL scoped to jobId/artifactId
    - POST /jobs/{jobId}/complete — transition to COMPLETED, record event; if auto-PR-review enabled on repo, create Review_Job and publish review_pr SQS message
    - POST /jobs/{jobId}/fail — transition to FAILED with failure reason and stage, record event
    - _Requirements: 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 12.1, 12.2, 12.3, 12.5, 13.1, 13.2, 13.4, 15.1, 15.2, 15.3, 15.4_

  - [x] 4.4 Implement Job cancellation handler
    - POST /jobs/{jobId}/cancel — cancel QUEUED/CLAIMED/RUNNING jobs, reject terminal statuses with 409, record JobEvent
    - _Requirements: 11.1, 11.2, 11.4_

  - [ ]* 4.5 Write unit tests for Job handlers
    - Test job creation with valid/invalid refs, claim idempotency, state machine enforcement, cancellation of various statuses, auto-review triggering
    - _Requirements: 5.1, 5.5, 6.2, 6.3, 11.1, 11.4, 15.1, 15.2_

- [x] 5. Implement Agent and Webhook Lambda handlers
  - [x] 5.1 Implement Agent Lambda in `packages/backend/src/handlers/agent.ts`
    - POST /agents/register — create/update Agent record with agentId, machine ID, label, capability tags, repo allowlist, workspace root, last-seen timestamp
    - POST /agents/{agentId}/heartbeat — update last-seen timestamp
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 5.2 Implement Webhook Lambda in `packages/backend/src/handlers/webhook.ts`
    - POST /webhooks/github — validate HMAC-SHA256 signature (reject invalid with 401), parse push events, check for open PR with completed Feature_Job, deduplicate (no existing QUEUED/RUNNING review for same PR), create Review_Job and publish SQS message
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 5.3 Implement Timeout Checker Lambda in `packages/backend/src/handlers/timeout.ts`
    - EventBridge scheduled (every 5 min) — query RUNNING jobs exceeding max duration (30 min feature, 15 min review), transition to TIMED_OUT, record JobEvent
    - _Requirements: 18.1, 18.2_

  - [ ]* 5.4 Write unit tests for Agent, Webhook, and Timeout handlers
    - Test agent registration/heartbeat, webhook signature validation, deduplication logic, timeout detection
    - _Requirements: 10.2, 9.2, 9.3, 9.4, 18.2_

- [x] 6. Checkpoint — Ensure all backend handlers compile and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Local Agent — config, API client, and core infrastructure
  - [x] 7.1 Implement agent config loader in `packages/agent/src/config.ts`
    - Load config file: machine ID, label, capability tags, repo allowlist, workspace root, polling interval, max concurrent jobs, bundle cache dir
    - Validate `kiro-cli` on PATH (spawn `kiro-cli acp` and verify it starts), validate Git on PATH; log error and exit non-zero if missing
    - _Requirements: 23.1, 23.2, 23.3, 23.4_

  - [x] 7.2 Implement Backend API client in `packages/agent/src/api-client.ts`
    - HTTPS-only calls with AWS SigV4 request signing (same IAM role used for SQS access)
    - Methods: claimJob, updateJobStatus, postJobEvent, requestArtifactPresign, completeJob, failJob, registerAgent, sendHeartbeat
    - Exponential backoff retry (up to 3 retries) on network errors and 5xx responses
    - _Requirements: 17.1, 19.2, 19.6_

  - [x] 7.3 Implement Kiro ACP client in `packages/agent/src/kiro-acp-client.ts`
    - Spawn `kiro-cli acp` as subprocess with stdin/stdout/stderr pipes
    - JSON-RPC 2.0 request/response handling with auto-incrementing IDs
    - `initialize(clientInfo)` — send initialize request with protocolVersion 1, clientCapabilities (fs read/write, terminal), clientInfo
    - `createSession(cwd, mcpServers)` — send session/new request, return sessionId
    - `sendPrompt(sessionId, promptText, timeout)` — send session/prompt, stream updates, return stopReason
    - Parse streaming updates from stdout: handle session/update and session/notification methods
    - Capture AgentMessageChunk content for transcript logging
    - Monitor ToolCall events for progress tracking and Job_Event reporting
    - Detect TurnEnd for completion
    - Handle subprocess crash (KIRO_ACP_CRASH error code) and prompt timeout (KIRO_ACP_TIMEOUT)
    - Capture stderr for error diagnostics
    - Clean subprocess termination on completion or failure
    - _Requirements: 6.9, 8.5_

  - [x] 7.3 Implement event buffer in `packages/agent/src/event-buffer.ts`
    - Buffer JobEvents locally when Backend is unreachable
    - Flush buffer when connectivity is restored
    - _Requirements: 17.3_

  - [x] 7.4 Implement heartbeat loop in `packages/agent/src/heartbeat.ts`
    - Periodic heartbeat at configured polling interval, independent of job processing
    - _Requirements: 10.3_

  - [x] 7.5 Implement bundle cache in `packages/agent/src/bundle-cache.ts`
    - Download Config_Bundle from S3, cache in configured directory
    - Verify bundle version matches job message version
    - Skip download if cached version matches
    - _Requirements: 24.2, 24.3_

- [x] 8. Implement Local Agent — SQS poller and job processing pipeline
  - [x] 8.1 Implement SQS poller in `packages/agent/src/poller.ts`
    - Long-polling loop with configurable interval
    - Concurrency gating: defer polling when max concurrent jobs reached
    - Retry on network errors with configured interval wait
    - Filter jobs by repo allowlist when configured
    - _Requirements: 16.1, 23.5, 23.6, 17.2_

  - [x] 8.2 Implement job processing pipeline in `packages/agent/src/pipeline.ts`
    - Orchestrate: claim → set RUNNING → run stages → complete/fail
    - On claim 409 (already claimed), delete SQS message and skip
    - Delete SQS message only on terminal status (COMPLETED, FAILED, CANCELLED)
    - Check job status before each stage transition; stop if CANCELLED
    - Check elapsed time before each stage; self-terminate if max duration exceeded
    - _Requirements: 6.1, 6.4, 6.15, 6.16, 6.17, 6.18, 11.3, 16.1, 16.2, 16.3, 18.3_

  - [x] 8.3 Implement feature job stages in `packages/agent/src/stages/`
    - `validate-repo.ts` — VALIDATING_REPO: verify repo URL accessible
    - `prepare-workspace.ts` — PREPARING_WORKSPACE: clone if absent, fetch, checkout base branch, create work branch
    - `apply-bundle.ts` — APPLYING_BUNDLE: download bundle (via cache), extract to .kiro/ overwriting existing, apply Layer 4 defaults with Layer 3 precedence
    - `run-kiro.ts` — RUNNING_KIRO: use KiroAcpClient to spawn `kiro-cli acp`, initialize session with workspace cwd and MCP servers from bundle manifest, send feature prompt (description + constraints), capture transcript from AgentMessageChunk updates, monitor ToolCall events for progress, handle stopReason
    - `run-tests.ts` — RUNNING_TESTS: execute validation steps from Config_Bundle (tests, lint, build)
    - `commit.ts` — COMMITTING: commit changes with descriptive message
    - `push.ts` — PUSHING: push work branch to remote
    - `create-pr.ts` — CREATING_PR: create GitHub PR (title from feature description, body with full description + constraints), update job with PR URL/number/branch
    - `finalize.ts` — FINALIZING: upload execution log artifact, call complete
    - Post JobEvent for each stage transition
    - _Requirements: 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 24.1, 24.4, 25.1, 25.2, 25.5, 20.4, 20.5_

  - [x] 8.4 Implement review job stages in `packages/agent/src/stages/`
    - `fetch-pr.ts` — FETCHING_PR: fetch PR refs and metadata from GitHub
    - `prepare-diff.ts` — PREPARING_DIFF: generate diff between PR branch and base branch
    - `run-review.ts` — RUNNING_REVIEW: use KiroAcpClient to spawn `kiro-cli acp`, initialize session with workspace cwd, send review prompt with PR diff and review checklist, capture structured review findings from response
    - `post-review.ts` — POSTING_REVIEW: post review to GitHub with inline comments, state (APPROVE/REQUEST_CHANGES/COMMENT) based on severity
    - `set-status.ts` — SETTING_STATUS: set commit status with context `kiro-review`
    - `finalize-review.ts` — FINALIZING: upload review artifact JSON and markdown report via presigned URL, call complete
    - Post JobEvent for each stage transition
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 25.3, 25.4, 25.5_

  - [ ]* 8.5 Write unit tests for agent poller, pipeline, and stage modules
    - Test concurrency gating, claim-conflict handling, SQS message deletion logic, stage sequencing, cancellation check, timeout self-termination
    - _Requirements: 16.2, 11.3, 18.3, 23.5_

- [x] 9. Implement Local Agent — entry point and daemon wiring
  - [x] 9.1 Implement agent entry point in `packages/agent/src/index.ts`
    - Load config, validate prerequisites, register agent, start heartbeat loop, start SQS poller
    - Wire pipeline with API client, event buffer, bundle cache, and stage runners
    - Local logging to configurable log directory with jobId in filename
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 10.1, 20.4_

- [x] 10. Checkpoint — Ensure agent compiles and unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement Portal SPA — auth, API client, and routing
  - [x] 11.1 Scaffold Vue.js project in `packages/portal/` with Vue Router and Pinia
    - Configure build for S3/CloudFront static hosting
    - _Requirements: 22.6_

  - [x] 11.2 Implement Cognito auth module in `packages/portal/src/auth.ts`
    - Redirect unauthenticated users to Cognito hosted login page
    - Store JWT token on successful login, inject into all API calls via Authorization header
    - Token refresh using Cognito refresh token before prompting re-login
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 11.3 Implement API client in `packages/portal/src/api.ts`
    - Axios/fetch wrapper with JWT injection, error handling, response envelope parsing
    - _Requirements: 1.2, 19.1_

  - [x] 11.4 Implement Vue Router with auth guards in `packages/portal/src/router.ts`
    - Protected routes redirect to login if no valid token
    - _Requirements: 1.1_

- [x] 12. Implement Portal SPA — Pinia stores and page views
  - [x] 12.1 Implement Pinia stores in `packages/portal/src/stores/`
    - `repositories.ts` — CRUD operations for repositories
    - `profiles.ts` — list profiles, publish bundle
    - `jobs.ts` — create job, list jobs (with status filter), get job detail, get events, get artifacts, cancel job
    - _Requirements: 2.5, 3.2, 5.1, 14.1, 14.2, 14.3, 11.1_

  - [x] 12.2 Implement page views in `packages/portal/src/views/`
    - `LoginPage.vue` — Cognito redirect
    - `DashboardPage.vue` — recent jobs summary with counts by status, polling refresh
    - `RepositoryListPage.vue` — list repos with default branch and profile
    - `RepositoryDetailPage.vue` — edit default branch, profile, auto-PR-review
    - `ProfileListPage.vue` — list profiles with role and active bundle version
    - `JobCreatePage.vue` — form: select repo, branch, profile, feature description, optional constraints
    - `JobDetailPage.vue` — status, stage, PR link, event timeline, artifact downloads, polling refresh
    - `AdminPage.vue` — publish Config_Bundles to profiles
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7, 21.8, 21.9_

  - [x] 12.3 Implement status chips and visual indicators for job states
    - Visual indicators for QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED, TIMED_OUT
    - _Requirements: 14.4_

  - [x] 12.4 Implement polling-based refresh on dashboard and job detail pages
    - Configurable polling interval, no WebSocket
    - _Requirements: 21.9_

  - [ ]* 12.5 Write unit tests for Pinia stores and key page components
    - Test store actions, polling behavior, auth guard redirects
    - _Requirements: 1.1, 14.1, 21.9_

- [x] 13. Checkpoint — Ensure portal compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Infrastructure configuration and integration wiring
  - [x] 14.1 Create IaC templates (CDK or SAM) for AWS resources
    - DynamoDB tables: Repositories, Profiles, Agents, Jobs, JobEvents, Artifacts with GSIs
    - SQS queues: main queue + DLQ with maxReceiveCount=3
    - S3 buckets: artifacts/bundles, SPA hosting
    - CloudFront distribution for SPA
    - Cognito user pool and app client
    - API Gateway with routes, Cognito authorizer, custom authorizer for agent routes
    - Lambda functions with IAM roles
    - EventBridge rule for timeout checker (every 5 min)
    - CloudWatch log groups and metric filters for job counts and durations
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 16.4, 16.5, 20.1, 20.2, 20.3_

  - [ ]* 14.2 Write integration tests for end-to-end job flow
    - Test: submit job → claim → run stages → complete → auto-review trigger
    - Test: webhook re-review deduplication
    - Test: cancellation during RUNNING
    - Test: timeout detection
    - _Requirements: 5.1, 6.1, 7.1, 9.1, 11.1, 18.2_

- [x] 15. Final checkpoint — Ensure all packages compile, tests pass, and IaC validates
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- TypeScript is used across all packages (backend, agent, portal)
- The monorepo structure with `packages/common` enables shared types between backend, agent, and portal
