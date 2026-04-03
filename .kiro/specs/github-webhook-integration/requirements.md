# Requirements Document

## Introduction

The GitHub Webhook Integration enables automatic triggering of code review jobs when pull request events occur on registered repositories. A GitHub webhook sends push/PR events to an API Gateway endpoint, which validates the webhook signature, matches the repository to a registered repo, and creates a review job. This automates the review cycle so that every PR gets reviewed by the Kiro agent without manual intervention.

## Glossary

- **Webhook_Endpoint**: The `POST /webhooks/github` API Gateway endpoint that receives GitHub webhook events.
- **Webhook_Signature**: The `X-Hub-Signature-256` header containing an HMAC-SHA256 digest used to verify the event came from GitHub.
- **Webhook_Secret**: A shared secret configured in both GitHub and the backend (via SAM parameter) used to compute and verify signatures.
- **PR_Event**: A GitHub `pull_request` webhook event containing details about a pull request action (opened, synchronize, etc.).
- **Push_Event**: A GitHub `push` webhook event triggered when commits are pushed to a branch.

## Requirements

### Requirement 1: Webhook Event Reception

**User Story:** As a system, I want to receive GitHub webhook events at a public endpoint, so that PR events can trigger automated reviews.

#### Acceptance Criteria

1. THE backend SHALL expose a `POST /webhooks/github` endpoint that does not require Cognito authentication.
2. THE endpoint SHALL accept JSON payloads with GitHub webhook event format.
3. THE endpoint SHALL validate the `X-Hub-Signature-256` header using the configured webhook secret.
4. IF the signature is invalid or missing, THE endpoint SHALL return HTTP 401.
5. THE endpoint SHALL return HTTP 200 for valid webhooks, even if no action is taken.

### Requirement 2: Repository Matching

**User Story:** As a system, I want to match incoming webhook events to registered repositories, so that only configured repos trigger review jobs.

#### Acceptance Criteria

1. WHEN a webhook event is received, THE handler SHALL extract the repository URL from the event payload.
2. THE handler SHALL search registered repositories for a matching URL.
3. IF no matching repository is found, THE handler SHALL log the event and return HTTP 200 with no action.
4. IF the matching repository does not have auto-review enabled, THE handler SHALL skip review job creation.

### Requirement 3: Auto-Review on PR Events

**User Story:** As a user, I want pull request events to automatically create review jobs, so that every PR gets reviewed without manual intervention.

#### Acceptance Criteria

1. WHEN a PR event with action `opened` or `synchronize` is received for a registered repository with auto-review enabled, THE handler SHALL create a `review_pr` job.
2. THE review job SHALL use the repository's default review profile and review AI agent.
3. THE handler SHALL NOT create duplicate review jobs for the same PR if one is already QUEUED or RUNNING.
4. THE created job SHALL be dispatched to the SQS job queue.

### Requirement 4: Webhook Security

**User Story:** As a security-conscious operator, I want webhook events to be cryptographically validated, so that only genuine GitHub events trigger actions.

#### Acceptance Criteria

1. THE webhook secret SHALL be stored as a SAM parameter and passed to the Lambda function via environment variable.
2. THE signature validation SHALL use HMAC-SHA256 with constant-time comparison.
3. THE webhook Lambda SHALL have its own IAM role with minimal permissions (DynamoDB read, SQS publish).
