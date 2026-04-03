# Requirements Document

## Introduction

The Spec-Driven Workflow adds a human-in-the-loop approval process to the feature implementation pipeline. Before the agent writes any code, it generates a structured specification in three sequential phases — requirements, design, and tasks — each requiring explicit user approval via the portal UI. This ensures the agent understands the request correctly, proposes a sound architecture, and breaks the work into verifiable steps before implementation begins.

The workflow integrates across the backend (DynamoDB spec storage, approval/rejection APIs), the agent (Kiro ACP-driven spec generation, approval polling), and the portal (tabbed spec viewer with inline editing, approval buttons, and feedback chat).

## Glossary

- **Spec**: A structured document stored in DynamoDB containing three phases (requirements, design, tasks) for a given job, each with a status, items, and revision history.
- **SpecPhase**: One of `requirements`, `design`, or `tasks` — the three sequential phases of the spec workflow.
- **SpecPhaseStatus**: One of `pending`, `generating`, `draft`, `approved`, or `rejected` — the lifecycle state of a single phase.
- **SpecItem**: An individual item within a phase (e.g., a single requirement, a design section, or a task) with an ID, content, and optional completion status.
- **Approval_API**: The `POST /jobs/{jobId}/spec/approve` endpoint that advances a phase from `draft` to `approved`.
- **Rejection_API**: The `POST /jobs/{jobId}/spec/reject` endpoint that marks a phase as `rejected` with a reason, triggering regeneration.
- **Feedback_API**: The `POST /jobs/{jobId}/spec/messages` endpoint that allows users to send revision feedback on a draft phase without fully rejecting it.
- **Await_Approval_Stage**: The agent pipeline stage that polls the backend until the current spec phase is approved or rejected before proceeding.

## Requirements

### Requirement 1: Three-Phase Spec Generation

**User Story:** As a user, I want the agent to generate requirements, design, and tasks in sequence before writing code, so that I can verify the plan at each stage.

#### Acceptance Criteria

1. WHEN a feature job starts, THE agent SHALL generate the requirements phase first by prompting Kiro ACP with the job description and repository context.
2. WHEN requirements are approved, THE agent SHALL generate the design phase using the approved requirements as input.
3. WHEN design is approved, THE agent SHALL generate the tasks phase using the approved requirements and design as input.
4. WHEN all three phases are approved, THE agent SHALL proceed to implement the tasks.
5. EACH phase SHALL be stored in DynamoDB under the job's spec record with status, items, timestamps, and revision number.

### Requirement 2: Phase Approval and Rejection

**User Story:** As a user, I want to approve or reject each spec phase, so that I can course-correct the agent's plan before it writes code.

#### Acceptance Criteria

1. WHEN a phase is in `draft` status, THE portal SHALL display "Approve" and "Reject" buttons for that phase.
2. WHEN the user clicks "Approve", THE backend SHALL transition the phase status from `draft` to `approved`, record the approval timestamp, and resume the agent job from AWAITING_APPROVAL to RUNNING.
3. WHEN the user clicks "Reject" with a reason, THE backend SHALL transition the phase status to `rejected`, record the rejection reason, increment the revision number, and resume the agent to regenerate the phase.
4. WHEN a phase is rejected, THE agent SHALL regenerate that phase incorporating the rejection reason as additional context.
5. THE backend SHALL NOT allow approval or rejection of a phase that is not in `draft` status.

### Requirement 3: Feedback Chat on Draft Phases

**User Story:** As a user, I want to send feedback on a draft phase without rejecting it, so that I can request targeted revisions while preserving the overall structure.

#### Acceptance Criteria

1. WHEN a phase is in `draft` status, THE portal SHALL display a text input for sending feedback messages.
2. WHEN the user submits feedback, THE backend SHALL auto-reject the phase with the feedback as the reason and resume the agent to regenerate.
3. THE feedback message SHALL be included in the Kiro ACP prompt when regenerating the phase.

### Requirement 4: Spec Viewer UI

**User Story:** As a user, I want to view the spec in a tabbed interface with requirements, design, and tasks tabs, so that I can review each phase clearly.

#### Acceptance Criteria

1. THE portal SHALL display the spec in a three-tab layout (Requirements, Design, Tasks) below the job header.
2. EACH tab SHALL show the phase status badge (pending, generating, draft, approved, rejected).
3. THE currently active phase SHALL be auto-selected when the job detail page loads.
4. WHEN a phase is approved, THE portal SHALL automatically switch to the next phase tab.
5. THE tasks tab SHALL display each task as a checklist item with real-time status updates (pending, in_progress, completed, failed) during implementation.
6. THE design tab SHALL render markdown content with proper formatting.

### Requirement 5: Agent Await-Approval Polling

**User Story:** As a developer, I want the agent to pause and poll for approval after generating each spec phase, so that the workflow blocks until the user reviews the output.

#### Acceptance Criteria

1. AFTER generating a spec phase, THE agent SHALL transition the job status to AWAITING_APPROVAL and begin polling the backend for phase status changes.
2. WHEN the phase status changes to `approved`, THE agent SHALL proceed to the next phase or to implementation.
3. WHEN the phase status changes to `rejected`, THE agent SHALL regenerate the phase with the rejection reason.
4. THE polling interval SHALL be configurable with a default of 5 seconds.
5. THE agent SHALL support a maximum wait time per phase, after which the job fails with a timeout error.

### Requirement 6: Inline Item Editing

**User Story:** As a user, I want to edit individual spec items before approving, so that I can fine-tune the agent's output without regenerating the entire phase.

#### Acceptance Criteria

1. WHEN a phase is in `draft` status, THE portal SHALL allow inline editing of individual spec items.
2. WHEN the user edits an item, THE portal SHALL call the `PATCH /jobs/{jobId}/spec/items` endpoint to update the item content.
3. THE backend SHALL update the item in DynamoDB without changing the phase status.
