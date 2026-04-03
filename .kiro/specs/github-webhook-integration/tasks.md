# Implementation Plan: GitHub Webhook Integration

## Overview

Implement GitHub webhook endpoint for auto-triggering review jobs on PR events.

## Tasks

- [x] 1. Implement webhook signature validation
  - [x] 1.1 Create `packages/backend/src/middleware/webhook-auth.ts` with HMAC-SHA256 validation
  - [x] 1.2 Use `crypto.timingSafeEqual` for constant-time comparison

- [x] 2. Build webhook Lambda handler
  - [x] 2.1 Create `packages/backend/src/handlers/webhook.ts`
  - [x] 2.2 Parse GitHub event type from `x-github-event` header
  - [x] 2.3 Extract repository URL and PR details from event payload
  - [x] 2.4 Match repository URL against registered repositories in DynamoDB
  - [x] 2.5 Check auto-review setting on matched repository
  - [x] 2.6 Deduplicate by checking for existing QUEUED/RUNNING review jobs for same PR
  - [x] 2.7 Create `review_pr` job and publish SQS message

- [x] 3. Add SAM infrastructure
  - [x] 3.1 Add `WebhookFunction` Lambda resource in `template.yaml`
  - [x] 3.2 Configure API Gateway route for `POST /webhooks/github` without auth
  - [x] 3.3 Add `GitHubWebhookSecret` parameter and pass to Lambda environment
  - [x] 3.4 Configure minimal IAM role (DynamoDB read, SQS publish)
