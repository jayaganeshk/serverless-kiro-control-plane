---
inclusion: fileMatch
fileMatchPattern: ['packages/backend/**/*.ts', 'packages/common/**/*.ts']
---

# Backend API Conventions

## Local Development

Run the backend API locally with:

```bash
npm run dev --workspace=packages/backend
```

This starts a Node.js HTTP server on `http://localhost:3000` that wraps Lambda handlers. It reads environment variables from `packages/backend/.env` and connects to real AWS resources (DynamoDB, SQS, S3).

Required environment variables: `TABLE_NAME`, `JOB_QUEUE_URL`, `ARTIFACTS_BUCKET`, `BUNDLES_BUCKET`, `COGNITO_USER_POOL_ID`, `AWS_REGION`.

## Type Checking

This is a TypeScript monorepo using project references. Always verify types after changes:

```bash
npm run build --workspaces
```

Shared types live in `packages/common/src/types.ts`. The backend references common via `@remote-kiro/common`. All packages use ESM (`"type": "module"`) and require `.js` extensions in import paths.

## API Handler Pattern

Each handler in `packages/backend/src/handlers/` is an AWS Lambda function receiving `APIGatewayProxyEvent` and returning `APIGatewayProxyResult`. Handlers follow this structure:

1. Authenticate via `validateCognitoJwt(event)` (portal routes) or skip auth (agent/webhook routes).
2. Parse input with `parseJsonBody`, `requirePathParam`, `getQueryParam`, `requireFields`.
3. Perform business logic using DB functions from `packages/backend/src/db/`.
4. Return responses via `buildSuccessResponse(statusCode, data, pagination?)` or `buildErrorResponse(err)`.
5. All responses use the `ApiResponse<T>` envelope from `@remote-kiro/common`.

Use the custom error classes for control flow: `ValidationError` (400), `AuthError` (401), `NotFoundError` (404), `ConflictError` (409).

## DynamoDB Data Access

All DB operations go through `packages/backend/src/db/` modules. Each entity module provides a `toItem()` helper that maps domain objects to DynamoDB items with synthetic `PK`, `SK`, and GSI keys. Follow these rules:

- Always reference the table via the `TABLE` constant from `db/client.ts` (sourced from `TABLE_NAME` env var).
- Use `DynamoDBDocumentClient` with `removeUndefinedValues: true` (already configured in `db/client.ts`).
- Use `ConditionExpression: "attribute_not_exists(PK)"` on creates to prevent overwrites.
- Use `ConditionExpression: "attribute_exists(PK)"` on updates to ensure the item exists.
- Job status transitions must atomically update `GSI2PK` (`JOBSTATUS#<status>`) alongside the `status` field.
- Use `begins_with(SK, :prefix)` to query sub-entities (events, artifacts) under a job's partition.

## Job State Machine

Job status transitions are validated by `packages/backend/src/state-machine.ts` using the `VALID_TRANSITIONS` map from `@remote-kiro/common`. Always call `validateTransition(currentStatus, newStatus)` before writing. Terminal statuses (`COMPLETED`, `FAILED`, `CANCELLED`, `TIMED_OUT`) reject further transitions.

## Testing

Tests use Vitest and live alongside source files as `*.test.ts`. Run with:

```bash
npm run test --workspace=packages/backend
```

Property-based tests use `fast-check`. Test files should import from `vitest` and `fast-check` directly.
