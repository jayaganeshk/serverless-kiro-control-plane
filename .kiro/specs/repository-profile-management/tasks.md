# Implementation Plan: Repository & Profile Management

## Overview

Implement CRUD for repositories and profiles with portal UI, backend handlers, DynamoDB storage, and S3 bundle management.

## Tasks

- [x] 1. Define repository and profile types in common package
  - [x] 1.1 Add `Repository`, `McpServerConfig`, `GitCredentialType` types
  - [x] 1.2 Add `Profile` type with manifest and bundle version fields

- [x] 2. Implement repository DynamoDB operations
  - [x] 2.1 Create `packages/backend/src/db/repositories.ts` with CRUD functions
  - [x] 2.2 Implement GSI1 listing for repository enumeration

- [x] 3. Implement profile DynamoDB operations
  - [x] 3.1 Create `packages/backend/src/db/profiles.ts` with CRUD functions
  - [x] 3.2 Implement GSI1 listing for profile enumeration

- [x] 4. Build repository Lambda handler
  - [x] 4.1 Create `packages/backend/src/handlers/repository.ts` with CRUD routes
  - [x] 4.2 Implement Git credential storage and retrieval endpoints
  - [x] 4.3 Add Lambda function and API Gateway routes in `template.yaml`

- [x] 5. Build profile Lambda handler
  - [x] 5.1 Create `packages/backend/src/handlers/profile.ts` with CRUD routes
  - [x] 5.2 Implement presigned URL generation for bundle upload
  - [x] 5.3 Add Lambda function and API Gateway routes in `template.yaml`

- [x] 6. Build repository portal pages
  - [x] 6.1 Create `RepositoryListPage.vue` with repository table
  - [x] 6.2 Create `RepositoryDetailPage.vue` with settings form
  - [x] 6.3 Implement MCP server configuration UI on repository detail

- [x] 7. Build profile portal page
  - [x] 7.1 Create `ProfileListPage.vue` with profile list and create/edit modals
  - [x] 7.2 Implement bundle upload with presigned URL flow

- [x] 8. Implement agent bundle application
  - [x] 8.1 Create `packages/agent/src/stages/apply-bundle.ts` that downloads and extracts config bundles
  - [x] 8.2 Create `packages/agent/src/bundle-cache.ts` for local caching of downloaded bundles
