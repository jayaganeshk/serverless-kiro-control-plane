# Building a Remote AI Coding Assistant with Kiro and AWS Serverless

*How I built a full-stack system that lets an AI agent write code, create pull requests, and review its own work — all orchestrated through a serverless control-plane on AWS.*

---

## The Problem

AI coding assistants have gotten remarkably good at writing code. Tools like Kiro can understand a codebase, reason about requirements, and produce working implementations. But there's a gap between "AI can write code" and "AI can ship code reliably as part of a team's workflow."

Here's what I kept running into:

**1. No structured planning.** You tell an AI "build me a login page" and it starts writing code immediately. There's no step where it shows you what it *plans* to do — the requirements it understood, the architecture it's going to use, the specific tasks it will execute. By the time you see output, it's already committed to an approach that might be wrong.

**2. No approval loop.** AI coding tools operate in one of two modes: either fully autonomous (scary) or fully interactive (slow). There's no middle ground where the AI plans the work, you review and approve the plan, and then it executes autonomously.

**3. No review cycle.** The AI writes code, but who reviews it? Manual review defeats the purpose. What if the AI could review its own PRs, identify issues, and then fix them — with human oversight at each step?

**4. No operational backbone.** Running AI coding tasks needs infrastructure: job queuing, state management, artifact storage, timeout handling, credential management. Without this, you're running ad-hoc scripts and hoping for the best.

I wanted a system where I could say "implement this feature" from a web portal, have the AI show me its plan for approval, watch it execute, review the output, and fix any issues — all without leaving the browser.

So I built one.

---

## What Remote Kiro Does

Remote Kiro is a serverless control-plane that orchestrates AI coding tasks end-to-end. You interact with it through a web portal. Behind the scenes, it dispatches work to a local agent running on your machine (or a dev server) that drives Kiro through its Agent Control Protocol.

The workflow looks like this:

```
You describe a feature
    → AI generates requirements (you approve)
        → AI generates a design (you approve)
            → AI generates tasks (you approve)
                → AI implements each task
                    → AI commits, pushes, creates a PR
                        → AI reviews its own PR
                            → AI fixes review issues (you approve the fixes)
```

Every arrow is a checkpoint. You're always in control of what gets built and when.

---

## The Architecture

The system is split into three tiers, all TypeScript, deployed on AWS with SAM.

### High-Level View

```
┌─────────────────────────────────────────────────────────────────────┐
│                           AWS Cloud                                 │
│                                                                     │
│   CloudFront ──► S3 (Portal SPA)                                   │
│                                                                     │
│   API Gateway ──► Lambda Functions ──► DynamoDB (Single Table)     │
│                        │                                            │
│                        ├──► SQS (Job Queue + DLQ)                  │
│                        ├──► S3 (Artifacts & Config Bundles)        │
│                        ├──► Cognito (User Auth)                    │
│                        ├──► EventBridge (Job Timeouts)             │
│                        └──► Bedrock (AI Suggestions)               │
│                                                                     │
└────────────────────────────┬────────────────────────────────────────┘
                             │ SQS Polling
                             ▼
                   ┌────────────────────┐
                   │    Local Agent      │
                   │   (Your Machine)    │
                   │                     │
                   │   Kiro ACP Client   │
                   │   Git Operations    │
                   │   Pipeline Runner   │
                   └────────────────────┘
```

### Tier 1: The Portal

A Vue 3 single-page application hosted on S3 behind CloudFront. It authenticates users via Cognito (inline login — no redirect to hosted UI) and talks to the backend through API Gateway.

The portal is where you:
- Register Git repositories and configure their settings
- Create execution profiles with Kiro configuration bundles
- Submit coding jobs and track them in real time
- Review and approve spec phases (requirements, design, tasks)
- View code review results and trigger fixes
- Configure AI agents with MCP server integrations

It polls the backend for job updates and renders live event timelines, spec phase tabs, and task progress indicators. When a review comes back with issues, you can trigger a fix job directly from the review panel and watch the AI address each finding.

### Tier 2: The Backend

Six Lambda functions behind an HTTP API Gateway, all sharing a single DynamoDB table:

| Lambda | Responsibility |
|--------|---------------|
| **Job Handler** | Job CRUD, spec approval/rejection, review triggers, fix job creation |
| **Repository Handler** | Repository registration, settings, Git credentials |
| **Profile Handler** | Execution profile CRUD, config bundle upload (presigned URLs to S3) |
| **AI Agent Handler** | AI agent CRUD, MCP server registry, Bedrock-powered suggestions |
| **Webhook Handler** | GitHub webhook ingestion, signature validation, auto-review triggers |
| **Timeout Handler** | EventBridge-triggered sweep of stale RUNNING jobs |

The backend is the state machine. It tracks every job through its lifecycle (`QUEUED → CLAIMED → RUNNING → AWAITING_APPROVAL → RUNNING → COMPLETED`), records events, manages specs, and dispatches work to the agent via SQS.

**Why a single DynamoDB table?** Every entity — jobs, events, specs, repositories, profiles, agents, artifacts — lives in one table with composite keys (`PK`, `SK`) and two GSIs. This keeps things simple: one table to provision, one set of IAM permissions, and all related data for a job is co-located for efficient queries.

### Tier 3: The Local Agent

A Node.js daemon that runs on your machine (or any machine with access to your Git repos). It:

1. **Polls SQS** for job messages
2. **Runs a pipeline** of stages specific to the job type
3. **Drives Kiro** through the Agent Control Protocol (JSON-RPC over stdin/stdout)
4. **Reports back** to the backend API with status updates, events, and artifacts

The agent is where the actual work happens — cloning repos, applying configuration bundles, generating specs, implementing code, running tests, committing, pushing, and creating PRs. It runs locally so it has access to your file system, Git credentials, and development tools.

---

## The Spec-Driven Workflow: Why It Matters

This is the core differentiator. Before the agent writes a single line of code, it generates a three-phase specification:

### Phase 1: Requirements

The agent reads the job description and the repository context, then produces a list of requirements with acceptance criteria. This is your chance to verify the AI understood what you're asking for.

```
Requirement 1: User Authentication
  - WHEN a user submits credentials, THE system SHALL validate against Cognito
  - IF credentials are invalid, THE system SHALL display an error message
  ...
```

You can approve, reject with a reason (the agent regenerates incorporating your feedback), or send targeted feedback to refine specific items.

### Phase 2: Design

Using the approved requirements, the agent generates an architecture document — data models, API contracts, component structure, sequence diagrams. This is where you catch architectural mistakes before they're baked into code.

### Phase 3: Tasks

The agent breaks the approved design into concrete implementation tasks. Each task describes what file to change, what to add, and how it connects to other tasks. This gives you visibility into the exact execution plan.

Only after you approve all three phases does the agent start writing code. And when it does, you can watch each task's status update in real time: `pending → in_progress → completed`.

**Why this matters:** An AI that writes the wrong thing fast is worse than useless — it creates confident-looking code that solves the wrong problem. The spec workflow ensures alignment before execution, and the approval gates ensure you stay in control.

---

## The Review-Fix Loop

After the agent creates a PR, you can trigger a code review — also powered by Kiro. The review agent fetches the PR diff, analyzes it against the requirements, and posts findings.

If the review outcome is `REQUEST_CHANGES`, you can click "Fix Review Issues" directly from the portal. This creates a child job that:

1. Reads the review findings
2. Generates fix tasks (with your approval)
3. Implements the fixes
4. Pushes to the same branch, updating the existing PR

The parent job's UI shows a "Fixes Applied" badge when the fix job completes. You can drill into the fix job to see exactly what was changed and why.

This creates a closed loop: **implement → review → fix → done** — all orchestrated through the portal with human approval at each gate.

---

## AI Agent Configuration & MCP Servers

Different jobs need different AI behaviors. A frontend task needs different tools than a backend refactoring job. Remote Kiro handles this through AI Agent configurations.

Each AI agent defines:
- A **system prompt** that shapes the AI's behavior
- A **category** (frontend, backend, fullstack, code review, security review, etc.)
- A set of **MCP servers** — external tools the AI can use during execution

MCP (Model Context Protocol) servers extend the AI's capabilities. The system ships with a curated registry of 30+ pre-configured servers: filesystem access, database clients, AWS SDK tools, GitHub APIs, Docker, Kubernetes, and more.

Don't know which MCP servers your agent needs? The system uses Amazon Bedrock to analyze your agent's category and description and suggest relevant servers. You review the suggestions and add the ones you want.

When you create a job, you select which AI agent to use. The agent's configuration gets applied to the Kiro session, giving the AI the right tools and persona for the task.

---

## Infrastructure Choices

### Why Serverless?

The control-plane (backend + portal) has bursty, unpredictable traffic — sometimes you're submitting 10 jobs in a row, sometimes nothing for hours. Serverless means zero cost when idle and automatic scaling when busy. The entire backend costs pennies to run during development.

### Why SQS for Job Dispatch?

The agent runs on *your* machine, not in the cloud. SQS provides the decoupling: the backend publishes a message, the agent polls for it. If the agent is offline, messages wait in the queue. If processing fails, the DLQ catches it. The visibility timeout prevents duplicate processing.

### Why a Single DynamoDB Table?

With a single-table design, all data for a job — the job record, its events, spec, and artifacts — shares the same partition key (`JOB#{jobId}`). This means a single query can fetch everything related to a job. Two GSIs handle listing operations (jobs by status, repos, profiles, etc.).

### Why Local Agent Instead of Cloud Execution?

Running Kiro locally means:
- Access to your existing Git credentials and SSH keys
- No need to ship your codebase to a cloud sandbox
- Full access to your development environment and tools
- No per-minute compute charges for long-running tasks

The tradeoff is that you need a machine running the agent. For a team, this could be a shared dev server or a dedicated EC2 instance.

---

## The Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (all four packages) |
| Frontend | Vue 3, Pinia, Vue Router, Lucide icons, Marked |
| Backend | AWS Lambda (Node.js 20), API Gateway (HTTP), DynamoDB |
| Queue | Amazon SQS with Dead Letter Queue |
| Storage | S3 (artifacts, config bundles, portal SPA) |
| Auth | Amazon Cognito (USER_PASSWORD_AUTH, JWT) |
| CDN | CloudFront with Origin Access Control |
| AI | Kiro ACP (local), Amazon Bedrock (MCP suggestions) |
| Infra | AWS SAM (Serverless Application Model) |
| Git | GitHub, AWS CodeCommit |

Everything is in a monorepo with four packages sharing a common types library. The backend deploys via `sam deploy`, the portal via `aws s3 sync`, and the agent runs as `node dist/index.js`.

---

## What I Learned

**Structured AI output beats freeform.** When the AI generates requirements, design, and tasks in a defined format, the quality goes up dramatically compared to "just implement this." The structure forces the AI to think step-by-step and makes the output reviewable.

**Approval gates are worth the friction.** It's tempting to make everything autonomous. But the approval steps catch mistakes that would otherwise snowball. A wrong requirement leads to a wrong design leads to wrong tasks leads to wrong code. Catching it at the requirements stage costs you 30 seconds; catching it in code review costs you 30 minutes.

**The review-fix loop is surprisingly effective.** Having the AI review its own work and then fix the issues it found creates a quality bar that's higher than either step alone. The review catches things the implementation missed, and the fix cycle addresses them systematically.

**DynamoDB single-table design pays off.** The upfront complexity of designing access patterns is repaid every time you add a new entity. Adding AI agents, specs, and artifacts to the system required zero table changes — just new key patterns in the same table.

**SQS is the right abstraction for agent dispatch.** The decoupled architecture means the backend doesn't care where the agent runs, and the agent doesn't care how the backend is deployed. This made local development trivial: the agent runs on my laptop, the backend runs in AWS, and SQS bridges the gap.

---

## What's Next

This system is functional and I use it daily. Areas I'm exploring:

- **Multi-agent orchestration** — Split a large feature across multiple agents working in parallel
- **Streaming UI updates** — Replace polling with WebSocket for real-time event streams
- **Cloud-hosted agent option** — Run the agent in ECS/Fargate for teams that don't want to manage local infrastructure
- **Cost tracking** — Track Kiro ACP token usage and Bedrock costs per job
- **Team collaboration** — Multiple users reviewing and approving specs, shared dashboards

---

## Try It Yourself

The project is built with standard AWS services and open-source tools. If you have:

- An AWS account
- Node.js 20+
- SAM CLI
- Kiro CLI

You can deploy the entire stack in under 10 minutes:

```bash
git clone <repo-url>
cd serverless-remote-coding-agent
npm install && npm run build
sam build && sam deploy --guided
```

Then deploy the portal, start the agent, and create your first job from the web UI.

The full source code, architecture documentation, and Kiro spec files for every feature are in the repository.

---

*Built with TypeScript, AWS Serverless, Vue 3, and Kiro. Specifications for every feature tracked in `.kiro/specs/` using the spec-driven development workflow.*
