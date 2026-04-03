# Remote Kiro Portal — Usage Guide

The portal is a Vue 3 SPA for managing repositories, profiles, and coding jobs dispatched to remote Kiro agents.

## Authentication

The portal uses AWS Cognito for authentication. On first visit you'll be redirected to the login page.

- Sign in with the email/password created in the Cognito User Pool.
- If prompted with "Set New Password", this is a one-time challenge for newly created users.
- Sessions are maintained via JWT tokens stored in localStorage. Tokens auto-refresh when possible.

## Pages Overview

### Dashboard (`/`)

The landing page after login. Shows:
- Job status summary cards (counts by status: QUEUED, RUNNING, COMPLETED, FAILED, etc.)
- Recent jobs table with links to job details
- Auto-refreshes every 10 seconds

### Repositories (`/repositories`)

Register Git repositories that the agent can work on.

To add a repository:
1. Click "+ Add Repository"
2. Fill in the repository name, Git URL (HTTPS or SSH), and default branch
3. Select a default feature profile (must have an active profile first — see Profiles below)
4. Optionally enable auto PR review
5. Click "Create Repository"

Click a repository name to edit its settings (default branch, profiles, auto-review toggle).

### Profiles (`/profiles`)

Profiles define how the Kiro agent behaves when processing a job. There are two types:

- **Feature profiles** — used for `implement_feature` jobs. Contains steering files, MCP configs, and constraints that guide how Kiro implements features.
- **Reviewer profiles** — used for `review_pr` jobs. Contains review criteria and guidelines.

#### Creating a Profile
1. Click "+ Add Profile"
2. Enter a name (e.g. `my-project-feature`), select the type, and add a description
3. Click "Create Profile"

The profile starts inactive (bundle version 0). You need to publish a bundle to activate it.

#### Publishing a Bundle

A bundle is a ZIP file containing a `manifest.json` and any config files (steering docs, MCP server configs, etc.) that the agent applies to the workspace before running Kiro.

1. On the Profiles page, click "Upload Bundle" next to the profile
2. Select a `.zip` file containing your bundle
3. Click "Publish Bundle"

Each publish increments the bundle version. The profile becomes active after the first bundle is published.

You can also publish bundles from the Admin page (`/admin`), which provides a simpler interface for selecting any profile and uploading a bundle.

#### Bundle ZIP Structure

```
my-bundle.zip
├── manifest.json          # Required — describes the bundle contents
├── .kiro/
│   ├── steering/          # Steering files for the agent
│   │   └── coding-standards.md
│   └── settings/
│       └── mcp.json       # MCP server configurations
└── any-other-files/       # Additional files applied to the workspace
```

### Create Job (`/jobs/create`)

Dispatch a new coding job to an agent:

1. Select a repository from the dropdown
2. Enter the branch name (the agent creates this branch from the repo's default branch)
3. Select a feature profile (only active profiles with published bundles appear)
4. Describe the feature you want implemented
5. Optionally add constraints or guidelines
6. Click "Create Job"

The job is queued in SQS. An agent picks it up, clones the repo, applies the profile bundle, runs Kiro to implement the feature, then commits, pushes, and creates a PR.

### Job Detail (`/jobs/:jobId`)

Real-time view of a job's progress:

- Status and metadata (repo, branch, agent, timestamps)
- PR link once created
- Event timeline showing each stage transition and log message
- Artifacts (logs, patches, transcripts) with download links
- Cancel button for non-terminal jobs
- Auto-refreshes every 10 seconds until the job reaches a terminal status

### Admin (`/admin`)

A simplified bundle publishing interface. Select any profile and upload a new bundle ZIP.

## Environment Variables

The portal needs these in `.env` (or set as `VITE_*` env vars at build time):

| Variable | Description | Source |
|----------|-------------|--------|
| `VITE_API_BASE_URL` | Backend API Gateway URL | SAM output: `ApiUrl` |
| `VITE_COGNITO_DOMAIN` | Cognito hosted UI domain | SAM output: `CognitoDomain` |
| `VITE_CLIENT_ID` | Cognito app client ID | SAM output: `CognitoUserPoolClientId` |
| `VITE_REDIRECT_URI` | OAuth callback URL | `https://<CloudFrontDomain>/callback` |

## Local Development

```bash
cd packages/portal
cp .env.example .env  # fill in values from SAM outputs
npm run dev            # starts Vite dev server on http://localhost:5173
```

## Build & Deploy

```bash
cd packages/portal
npm run build
aws s3 sync dist/ s3://<SPABucketName> --delete
aws cloudfront create-invalidation --distribution-id <CloudFrontDistributionId> --paths "/*"
```

Get `SPABucketName` and `CloudFrontDistributionId` from SAM stack outputs.
