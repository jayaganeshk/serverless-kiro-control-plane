# Requirements Document

## Introduction

AI Agent Management provides a portal interface for creating, editing, and managing AI agent configurations. Each AI agent defines a Kiro CLI agent persona with a system prompt, MCP server integrations, and category-based presets. Users can select which AI agent to use when creating feature or review jobs. The system includes an AI-powered MCP server suggestion engine backed by Amazon Bedrock that recommends relevant MCP servers based on the agent's category and description.

## Glossary

- **AI_Agent**: A configuration record stored in DynamoDB defining a Kiro CLI agent with a name, description, system prompt, category, and MCP server list.
- **MCP_Server**: A Model Context Protocol server configuration specifying a command, arguments, environment variables, and auto-approve rules for tool calls.
- **MCP_Registry**: A curated catalog of known MCP servers organized by category (filesystem, database, cloud, web, etc.) with pre-configured command templates.
- **Bedrock_Suggestion**: An AI-generated recommendation from Amazon Bedrock that suggests MCP servers based on the agent's category and use case description.
- **Agent_Category**: A classification for AI agents such as `ui_frontend`, `backend`, `python`, `aws_serverless`, `fullstack`, `code_review`, `security_review`, or `custom`.
- **Kiro_Agent_Config**: The JSON configuration format used by Kiro CLI's `agents.json` file, defining the agent name, system prompt, and MCP server entries.

## Requirements

### Requirement 1: AI Agent CRUD

**User Story:** As a user, I want to create, view, edit, and delete AI agent configurations, so that I can customize the Kiro agent behavior for different job types.

#### Acceptance Criteria

1. THE portal SHALL display a list of all AI agents with name, category, description, and MCP server count.
2. THE user SHALL be able to create a new AI agent by specifying name, category, description, and system prompt.
3. THE user SHALL be able to edit an existing AI agent's name, description, system prompt, category, and MCP servers.
4. THE user SHALL be able to delete an AI agent (with confirmation).
5. THE backend SHALL provide REST endpoints: `GET /ai-agents`, `GET /ai-agents/{id}`, `POST /ai-agents`, `PUT /ai-agents/{id}`, `DELETE /ai-agents/{id}`.
6. THE system SHALL seed default AI agents on first access if none exist.

### Requirement 2: MCP Server Configuration

**User Story:** As a user, I want to add and configure MCP servers for an AI agent, so that the Kiro agent has access to external tools during execution.

#### Acceptance Criteria

1. THE portal SHALL display a list of MCP servers configured for each AI agent.
2. THE user SHALL be able to add MCP servers by selecting from the curated registry or entering custom configurations.
3. EACH MCP server configuration SHALL include command, arguments, environment variables, timeout, and auto-approve tool patterns.
4. THE user SHALL be able to edit and remove individual MCP server entries.
5. THE portal SHALL display a searchable MCP server registry organized by category.

### Requirement 3: AI-Powered MCP Suggestions

**User Story:** As a user, I want the system to suggest relevant MCP servers based on my agent's category and description, so that I can quickly configure the right tools.

#### Acceptance Criteria

1. THE portal SHALL provide a "Suggest MCP Servers" button that sends the agent's category and description to the backend.
2. THE backend SHALL use Amazon Bedrock to analyze the agent context and suggest relevant MCP servers from the registry.
3. THE suggestions SHALL include the server name, rationale, and pre-filled configuration.
4. THE user SHALL be able to accept or dismiss individual suggestions.

### Requirement 4: Agent Selection in Job Creation

**User Story:** As a user, I want to select which AI agent to use when creating a job, so that the job runs with the appropriate agent configuration.

#### Acceptance Criteria

1. THE job creation form SHALL include an optional AI agent selector dropdown.
2. WHEN an AI agent is selected, THE job SHALL be created with the `aiAgentId` field set.
3. THE agent pipeline SHALL load the AI agent configuration and apply it as the Kiro agent config during execution.
