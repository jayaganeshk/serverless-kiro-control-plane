# Requirements Document

## Introduction

Repository and Profile Management provides the foundational CRUD interfaces for registering Git repositories and creating execution profiles that control how the agent behaves when working on a repository. Repositories define the Git source, default branch, review policies, and MCP server integrations. Profiles define a named configuration bundle (Kiro agents, skills, steering rules, settings) that can be assigned to jobs. Together they form the configuration backbone of the system.

## Glossary

- **Repository**: A registered Git repository record containing URL, provider, default branch, assigned profiles, and review policy.
- **Execution_Profile**: A named configuration record defining a Kiro behavior profile with a config bundle, system prompt, and manifest.
- **Config_Bundle**: A versioned S3 artifact containing `.kiro/` directory structure (agents, skills, steering, settings) that gets applied to the workspace before Kiro execution.
- **Bundle_Version**: An incrementing integer tracking the version of the uploaded config bundle for a profile.
- **Auto_Review**: A repository setting that, when enabled, automatically triggers a review job after a feature job creates a PR.
- **MCP_Server_Config**: Repository-level MCP server configuration that gets injected into the agent's Kiro session for all jobs on that repository.

## Requirements

### Requirement 1: Repository Registration

**User Story:** As a user, I want to register Git repositories, so that I can create jobs against them.

#### Acceptance Criteria

1. THE portal SHALL provide a form to register a new repository with URL, name, provider, and default branch.
2. THE backend SHALL validate the repository URL format and detect the provider (GitHub, CodeCommit).
3. THE backend SHALL store the repository record in DynamoDB with a unique `repoId`.
4. THE portal SHALL display a list of all registered repositories with name, URL, and status.
5. THE user SHALL be able to archive a repository (soft delete).

### Requirement 2: Repository Configuration

**User Story:** As a user, I want to configure repository settings including default profiles and review policy, so that jobs use the correct defaults.

#### Acceptance Criteria

1. THE repository detail page SHALL allow setting the default feature profile and default review profile.
2. THE repository detail page SHALL allow enabling/disabling auto-review for the repository.
3. THE repository detail page SHALL allow configuring MCP servers at the repository level.
4. CHANGES to repository settings SHALL be persisted immediately via the backend API.

### Requirement 3: Execution Profile CRUD

**User Story:** As a user, I want to create and manage execution profiles, so that I can define different Kiro behaviors for different use cases.

#### Acceptance Criteria

1. THE portal SHALL display a list of all execution profiles with name, description, and bundle version.
2. THE user SHALL be able to create a new profile with name, description, and system prompt.
3. THE user SHALL be able to upload a config bundle (`.kiro/` directory contents) to a profile.
4. EACH bundle upload SHALL increment the profile's bundle version number.
5. THE backend SHALL store the bundle in S3 under a versioned key path.
6. THE user SHALL be able to edit a profile's name, description, and system prompt.

### Requirement 4: Profile Selection in Job Creation

**User Story:** As a user, I want to select an execution profile when creating a job, so that the job uses the right Kiro configuration.

#### Acceptance Criteria

1. THE job creation form SHALL default to the repository's default feature profile.
2. THE user SHALL be able to override the profile selection.
3. THE agent SHALL download and apply the selected profile's config bundle to the workspace before running Kiro.

### Requirement 5: Git Credentials Management

**User Story:** As a user, I want the system to securely manage Git credentials for repository access, so that the agent can clone and push to repositories.

#### Acceptance Criteria

1. THE backend SHALL support multiple credential types: HTTPS basic auth, SSH keys, and CodeCommit IAM.
2. THE agent SHALL fetch credentials from the backend API before performing Git operations.
3. CREDENTIALS SHALL be stored encrypted and never exposed in logs or API responses.
