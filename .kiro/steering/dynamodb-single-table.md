---
inclusion: fileMatch
fileMatchPattern: "packages/backend/src/db/**"
---

# DynamoDB Single-Table Design

This project uses a **single DynamoDB table** for all entities. Every item shares the same `PK` (partition key) and `SK` (sort key) structure.

## Table Name

Environment variable: `TABLE_NAME` (e.g., `dev-RemoteKiro`)

## Key Schema

| Key | Type | Description |
|-----|------|-------------|
| PK  | S    | Partition key — entity-prefixed identifier |
| SK  | S    | Sort key — entity type or composite sub-key |

## Entity Key Patterns

| Entity     | PK                    | SK                              | Example PK          | Example SK                        |
|------------|-----------------------|---------------------------------|---------------------|-----------------------------------|
| Repository | `REPO#<repoId>`       | `REPO`                          | `REPO#r-abc123`     | `REPO`                            |
| Profile    | `PROFILE#<profileId>` | `PROFILE`                       | `PROFILE#p-xyz789`  | `PROFILE`                         |
| Agent      | `AGENT#<agentId>`     | `AGENT`                         | `AGENT#a-def456`    | `AGENT`                           |
| Job        | `JOB#<jobId>`         | `JOB`                           | `JOB#j-111222`      | `JOB`                             |
| JobEvent   | `JOB#<jobId>`         | `EVENT#<eventTs>`               | `JOB#j-111222`      | `EVENT#2025-03-18T10:00:00.000Z`  |
| Artifact   | `JOB#<jobId>`         | `ARTIFACT#<artifactId>`         | `JOB#j-111222`      | `ARTIFACT#art-001`                |

## Global Secondary Indexes

### GSI1 — User-scoped queries

| Key      | Attribute  | Used By                                    |
|----------|------------|--------------------------------------------|
| GSI1PK   | `GSI1PK`   | `USER#<userId>` for repos and jobs by user |
| GSI1SK   | `GSI1SK`   | `REPO#<createdAt>` or `JOB#<createdAt>`    |

**Access patterns:**
- List repositories by user: `GSI1PK = USER#<userId>` AND `GSI1SK begins_with REPO#`
- List jobs by user: `GSI1PK = USER#<userId>` AND `GSI1SK begins_with JOB#`

### GSI2 — Status-based queries and entity listings

| Key      | Attribute  | Used By                                         |
|----------|------------|--------------------------------------------------|
| GSI2PK   | `GSI2PK`   | `JOBSTATUS#<status>` or `PROFILES` or `AGENTS`  |
| GSI2SK   | `GSI2SK`   | `<createdAt>` timestamp for ordering             |

**Access patterns:**
- List jobs by status: `GSI2PK = JOBSTATUS#<status>` AND `GSI2SK` for ordering
- List all profiles: `GSI2PK = PROFILES`
- List all agents: `GSI2PK = AGENTS` (future use)

## Item Attribute Mapping

All original entity attributes are stored directly on the item alongside the key attributes (`PK`, `SK`, `GSI1PK`, `GSI1SK`, `GSI2PK`, `GSI2SK`).

### Repository Item
```
PK:     REPO#<repoId>
SK:     REPO
GSI1PK: USER#<createdBy>
GSI1SK: REPO#<createdAt>
+ all Repository fields (repoId, name, url, provider, defaultBranch, etc.)
```

### Profile Item
```
PK:     PROFILE#<profileId>
SK:     PROFILE
GSI2PK: PROFILES
GSI2SK: <createdAt>
+ all Profile fields (profileId, name, profileType, bundleVersion, etc.)
```

### Agent Item
```
PK:     AGENT#<agentId>
SK:     AGENT
+ all Agent fields (agentId, machineLabel, capabilities, status, etc.)
```

### Job Item
```
PK:     JOB#<jobId>
SK:     JOB
GSI1PK: USER#<requestedBy>
GSI1SK: JOB#<createdAt>
GSI2PK: JOBSTATUS#<status>
GSI2SK: <createdAt>
+ all Job fields (jobId, jobType, repoId, status, requestedBy, etc.)
```

### JobEvent Item
```
PK:     JOB#<jobId>
SK:     EVENT#<eventTs>
+ all JobEvent fields (jobId, eventTs, eventType, message, stage, metadata)
```

### Artifact Item
```
PK:     JOB#<jobId>
SK:     ARTIFACT#<artifactId>
+ all Artifact fields (jobId, artifactId, artifactType, s3Key, etc.)
```

## Key Rules for Developers

1. **Always use the `TABLE_NAME` env var** — never hardcode table names.
2. **PK/SK are synthetic keys** — they are derived from entity IDs, not stored as business fields.
3. **GSI attributes are only set on entities that need them** — e.g., Agents don't need GSI1.
4. **JobEvents and Artifacts share the Job's PK** (`JOB#<jobId>`) — this enables efficient queries for all events/artifacts of a job using `begins_with` on SK.
5. **Status transitions on Jobs must also update GSI2PK** — since `JOBSTATUS#<status>` changes when status changes.
6. **Use `removeUndefinedValues: true`** in the DocumentClient marshalling options.
