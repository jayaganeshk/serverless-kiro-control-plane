# Implementation Plan: Spec-Driven Workflow

## Overview

Add a three-phase approval workflow (requirements → design → tasks) to the feature implementation pipeline. Covers DynamoDB storage, backend API endpoints, agent generation/polling stages, and portal UI.

## Tasks

- [x] 1. Define spec types and enums in common package
  - [x] 1.1 Add `SpecPhase`, `SpecPhaseStatus`, `SpecItem`, `SpecPhaseData`, `JobSpec` types to `packages/common/src/types.ts`
  - [x] 1.2 Add `SPEC_PHASE_ORDER` constant and `createEmptySpec()` factory function
  - [x] 1.3 Add `TaskItemStatus` type for tracking task execution progress

- [x] 2. Implement spec DynamoDB operations
  - [x] 2.1 Create `packages/backend/src/db/specs.ts` with `createSpec`, `getSpec`, `upsertSpec`, `updateSpecPhase`, `updateSpecItems` functions
  - [x] 2.2 Spec record uses `PK=JOB#{jobId}, SK=SPEC` key pattern in the single table

- [x] 3. Add spec API endpoints to job handler
  - [x] 3.1 `GET /jobs/{jobId}/spec` — retrieve full spec
  - [x] 3.2 `PUT /jobs/{jobId}/spec` — agent upserts spec during generation
  - [x] 3.3 `POST /jobs/{jobId}/spec/approve` — approve current draft phase, publish resume_job to SQS
  - [x] 3.4 `POST /jobs/{jobId}/spec/reject` — reject phase with reason, publish resume_job to SQS
  - [x] 3.5 `POST /jobs/{jobId}/spec/messages` — feedback auto-rejects and regenerates phase
  - [x] 3.6 `PATCH /jobs/{jobId}/spec/items` — update individual item content
  - [x] 3.7 Add API Gateway routes in `template.yaml` for all spec endpoints

- [x] 4. Implement generate-spec agent stage
  - [x] 4.1 Create `packages/agent/src/stages/generate-spec.ts` with Kiro ACP prompt construction
  - [x] 4.2 Build phase-specific prompts that include job description, file tree, and prior approved phases
  - [x] 4.3 Parse Kiro output into `SpecItem[]` array
  - [x] 4.4 Store generated spec via backend API and set phase status to `draft`

- [x] 5. Implement await-approval agent stage
  - [x] 5.1 Create `packages/agent/src/stages/await-approval.ts` that polls `GET /jobs/{jobId}/spec`
  - [x] 5.2 Detect `approved` status → proceed to next phase
  - [x] 5.3 Detect `rejected` status → throw `AwaitingApprovalError` to trigger regeneration
  - [x] 5.4 Implement configurable poll interval (default 5s) and max wait timeout

- [x] 6. Integrate spec stages into agent pipeline
  - [x] 6.1 Add generate-spec and await-approval stages to the implement_feature pipeline in `packages/agent/src/index.ts`
  - [x] 6.2 Wire the three generate→await cycles for requirements, design, and tasks
  - [x] 6.3 Handle resume_job messages to re-enter the pipeline at the correct phase

- [x] 7. Build spec viewer UI in portal
  - [x] 7.1 Add spec state and actions to jobs Pinia store (`packages/portal/src/stores/jobs.ts`)
  - [x] 7.2 Add spec API methods to `packages/portal/src/api.ts`
  - [x] 7.3 Build three-tab spec panel in `JobDetailPage.vue` with status badges
  - [x] 7.4 Render requirements and design phases as markdown
  - [x] 7.5 Render tasks phase as checklist with real-time status badges
  - [x] 7.6 Add approve/reject buttons and feedback input for draft phases
  - [x] 7.7 Implement auto-tab-switch on phase approval
  - [x] 7.8 Add inline item editing for draft phase items
