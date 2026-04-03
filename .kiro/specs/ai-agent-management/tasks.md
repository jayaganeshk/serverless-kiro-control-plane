# Implementation Plan: AI Agent Management

## Overview

Implement full CRUD for AI agent configurations with MCP server management, Bedrock-powered suggestions, and portal UI.

## Tasks

- [x] 1. Define AI agent types in common package
  - [x] 1.1 Add `AIAgentCategory`, `KiroMcpServerEntry`, `KiroAgentConfig`, `AIAgentConfig` types to `packages/common/src/types.ts`
  - [x] 1.2 Export types from package entry point

- [x] 2. Implement AI agent DynamoDB operations
  - [x] 2.1 Create `packages/backend/src/db/ai-agents.ts` with CRUD functions
  - [x] 2.2 Implement `seedDefaultAgents()` for first-access seeding

- [x] 3. Build AI agent Lambda handler
  - [x] 3.1 Create `packages/backend/src/handlers/ai-agent.ts` with CRUD routes
  - [x] 3.2 Define curated MCP server registry as static data structure
  - [x] 3.3 Implement Bedrock Converse API integration for MCP suggestions
  - [x] 3.4 Add `POST /ai-agents/{id}/suggest-mcp` endpoint
  - [x] 3.5 Add Lambda function and API Gateway routes in `template.yaml`

- [x] 4. Build AI agents portal page
  - [x] 4.1 Create `packages/portal/src/views/AIAgentsPage.vue` with agent list
  - [x] 4.2 Implement create/edit agent modal with form fields
  - [x] 4.3 Implement MCP server configuration modal with registry browser
  - [x] 4.4 Implement "Suggest MCP Servers" button with Bedrock integration
  - [x] 4.5 Add AI agents route to `packages/portal/src/router.ts`
  - [x] 4.6 Add AI agents navigation link to sidebar in `App.vue`
  - [x] 4.7 Add AI agents API methods and Pinia store

- [x] 5. Integrate AI agent selection into job creation
  - [x] 5.1 Add AI agent selector dropdown to `JobCreatePage.vue`
  - [x] 5.2 Pass `aiAgentId` in job creation API call
  - [x] 5.3 Agent pipeline loads AI agent config and applies it during Kiro ACP session setup
