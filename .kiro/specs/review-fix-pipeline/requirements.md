# Requirements Document

## Introduction

After a code review identifies issues in a pull request, the user needs a way to automatically fix those issues without manually creating a new job. The Review Fix Pipeline allows the user to trigger a fix job directly from the parent feature job's review panel. The fix job reuses the same branch and PR, generates fix tasks from the review findings, gets user approval on the tasks, implements the fixes, and pushes the changes to the existing PR.

## Glossary

- **Review_Fix_Job**: A job of type `implement_review_fix` that addresses code review findings by generating and implementing fix tasks.
- **Parent_Job**: The original `implement_feature` job whose PR was reviewed and received a REQUEST_CHANGES outcome.
- **Review_Report**: The markdown report produced by the review job containing findings, issues, and suggestions.
- **Fix_Tasks**: The tasks generated from the review report that describe specific code changes needed to address review findings.
- **Review_Fix_Page**: A dedicated portal page (`ReviewFixPage.vue`) that shows review findings and fix tasks in a two-panel layout.

## Requirements

### Requirement 1: Trigger Fix Job from Review Panel

**User Story:** As a user, I want to trigger a fix job directly from the review panel when a PR receives REQUEST_CHANGES, so that I don't have to manually create a new job.

#### Acceptance Criteria

1. WHEN a feature job has a review outcome of REQUEST_CHANGES, THE portal SHALL display a "Fix Review Issues" button in the review panel.
2. WHEN the user clicks the button, THE backend SHALL create a new `implement_review_fix` job linked to the parent job via `parentJobId`.
3. THE fix job SHALL reuse the parent job's repository, branch, profile, and PR context.
4. THE backend SHALL create the fix job with requirements and design phases auto-approved and the spec starting at the tasks phase.
5. THE backend SHALL record an event on the parent job with the fix job ID for discoverability.

### Requirement 2: Fix Task Generation from Review Findings

**User Story:** As a user, I want the agent to automatically generate fix tasks from the review report, so that the review findings are directly translated into actionable implementation tasks.

#### Acceptance Criteria

1. WHEN a review fix job starts, THE agent SHALL skip requirements and design generation phases.
2. THE agent SHALL generate tasks directly using the review report as the primary input context.
3. EACH generated task SHALL reference specific review findings and describe the code changes needed.
4. THE generated tasks SHALL be stored in the spec's tasks phase with status `draft` for user approval.

### Requirement 3: Fix Task Approval

**User Story:** As a user, I want to review and approve fix tasks before the agent implements them, so that I can verify the proposed fixes are correct.

#### Acceptance Criteria

1. WHEN fix tasks are generated, THE portal SHALL display them in the Review Fix Page for approval.
2. THE user SHALL be able to approve, reject, or provide feedback on the tasks.
3. WHEN tasks are approved, THE agent SHALL implement them and push changes to the existing PR branch.
4. THE agent SHALL NOT create a new PR — it SHALL push commits to the existing work branch.

### Requirement 4: Dedicated Review Fix Page

**User Story:** As a user, I want a dedicated page for review fix jobs that shows both the review findings and the fix tasks, so that I can see the context alongside the proposed fixes.

#### Acceptance Criteria

1. THE portal SHALL have a route `/jobs/{jobId}/review-fix` that renders the Review Fix Page.
2. THE Review Fix Page SHALL display the review findings (from the parent job's review report) in a read-only left panel.
3. THE Review Fix Page SHALL display the fix tasks with approval controls in a right panel.
4. WHEN navigating to a review fix job from the main job detail page, THE portal SHALL auto-redirect to the Review Fix Page.

### Requirement 5: Fix Status on Parent Job

**User Story:** As a user, I want to see on the parent feature job page that fixes have been applied, so that I know the review issues were addressed.

#### Acceptance Criteria

1. WHEN a fix job completes successfully, THE parent job's review panel SHALL display a "Fixes Applied" badge.
2. THE parent job page SHALL show a "View Fix Job" link to navigate to the fix job.
3. WHEN a fix job is in progress, THE parent job SHALL show a "Fix in progress..." indicator.
