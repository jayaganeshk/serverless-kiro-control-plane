# Implementation Plan: Review Fix Pipeline

## Overview

Implement the end-to-end review fix workflow: backend API to create fix jobs, agent pipeline to generate/implement fix tasks from review findings, and dedicated portal UI.

## Tasks

- [x] 1. Add ImplementReviewFixMessage to common types
  - [x] 1.1 Define `ImplementReviewFixMessage` in `packages/common/src/messages.ts` with `reviewReport`, `prNumber`, `prUrl`, and `parentJobId` fields
  - [x] 1.2 Add to `SQSJobMessage` union type

- [x] 2. Implement backend review fix endpoint
  - [x] 2.1 Add `POST /jobs/{jobId}/review/fix` handler in `packages/backend/src/handlers/job.ts`
  - [x] 2.2 Create fix job with auto-approved requirements and design phases
  - [x] 2.3 Publish `implement_review_fix` SQS message with review report content
  - [x] 2.4 Record event on parent job with `action: "review_fix_created"` and `fixJobId`
  - [x] 2.5 Add API Gateway route in `template.yaml`

- [x] 3. Modify agent pipeline for review fix jobs
  - [x] 3.1 Add `implement_review_fix` pipeline variant in `packages/agent/src/index.ts`
  - [x] 3.2 Skip requirements and design generation stages
  - [x] 3.3 Inject review report into task generation prompt in `generate-spec.ts`
  - [x] 3.4 Replace CREATING_PR stage with UPDATING_PR stage for fix jobs
  - [x] 3.5 Create `packages/agent/src/stages/update-pr.ts` for pushing to existing branches

- [x] 4. Build Review Fix Page in portal
  - [x] 4.1 Create `packages/portal/src/views/ReviewFixPage.vue` with two-panel layout
  - [x] 4.2 Left panel: read-only review findings from parent job's review report
  - [x] 4.3 Right panel: fix tasks with approval/rejection/feedback controls
  - [x] 4.4 Add route `/jobs/:jobId/review-fix` in `packages/portal/src/router.ts`
  - [x] 4.5 Add auto-redirect from `JobDetailPage.vue` for `implement_review_fix` jobs

- [x] 5. Add fix status tracking to parent job page
  - [x] 5.1 Detect fix job events in parent job's event history
  - [x] 5.2 Show "Fix in progress..." spinner during fix job execution
  - [x] 5.3 Show "Fixes Applied" badge when fix job completes
  - [x] 5.4 Show "View Fix Job" link to navigate to the fix job
