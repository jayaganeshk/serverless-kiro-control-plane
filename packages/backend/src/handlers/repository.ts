import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import type { Repository, GitCredential, GitCredentialType } from "@remote-kiro/common";
import { validateCognitoJwt } from "../middleware/auth.js";
import { createRequestLogger } from "../middleware/logger.js";
import { normalizeEvent } from "../middleware/event-adapter.js";
import {
  parseJsonBody,
  requirePathParam,
  getQueryParam,
  requireFields,
} from "../middleware/request-parser.js";
import {
  buildSuccessResponse,
  buildErrorResponse,
  ValidationError,
  NotFoundError,
} from "../middleware/error-handler.js";
import { ConflictError } from "../db/errors.js";
import {
  createRepository,
  getRepositoryById,
  listRepositoriesByUser,
  updateRepository,
} from "../db/repositories.js";
import { putCredential, getCredentialByRepoId, deleteCredential } from "../db/credentials.js";
import { createOrUpdateSecret, deleteSecret } from "../secrets.js";

const VALID_CRED_TYPES: GitCredentialType[] = ["https_basic", "ssh_key", "codecommit_iam"];

// ─── POST /repositories ───

async function handleCreate(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { url, name, defaultBranch, defaultFeatureProfileId } = requireFields<{
    url: string;
    name: string;
    defaultBranch: string;
    defaultFeatureProfileId: string;
  }>(body, ["url", "name", "defaultBranch", "defaultFeatureProfileId"]);

  const defaultReviewProfileId =
    (body.defaultReviewProfileId as string) ?? null;
  const autoReviewEnabled = body.autoReviewEnabled === true;

  // Check for duplicate URL for same user
  const existing = await listRepositoriesByUser(userId);
  const duplicate = existing.items.find((r) => r.url === url);
  if (duplicate) {
    throw new ConflictError(
      `Repository with URL "${url}" is already registered for this user`,
      "DUPLICATE_REPOSITORY_URL",
    );
  }

  const now = new Date().toISOString();
  const mcpServers = Array.isArray(body.mcpServers) ? body.mcpServers as Repository["mcpServers"] : [];

  const repo: Repository = {
    repoId: crypto.randomUUID(),
    name,
    url,
    provider: "github",
    defaultBranch,
    defaultFeatureProfileId,
    defaultReviewProfileId,
    autoReviewEnabled,
    mcpServers,
    status: "active",
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  await createRepository(repo);
  return buildSuccessResponse(201, repo);
}


// ─── GET /repositories ───

async function handleList(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const nextToken = getQueryParam(event, "nextToken");
  const result = await listRepositoriesByUser(userId, nextToken);
  return buildSuccessResponse(200, result.items, {
    nextToken: result.nextToken,
  });
}

// ─── GET /repositories/{repoId} ───

async function handleGetOne(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const repoId = requirePathParam(event, "repoId");
  const repo = await getRepositoryById(repoId);
  if (!repo) {
    throw new NotFoundError(`Repository ${repoId} not found`);
  }
  return buildSuccessResponse(200, repo);
}

// ─── PATCH /repositories/{repoId} ───

async function handleUpdate(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const repoId = requirePathParam(event, "repoId");
  const body = parseJsonBody<Record<string, unknown>>(event);

  const fields: Partial<
    Pick<
      Repository,
      | "defaultBranch"
      | "defaultFeatureProfileId"
      | "defaultReviewProfileId"
      | "autoReviewEnabled"
      | "mcpServers"
      | "status"
    >
  > = {};

  if (body.defaultBranch !== undefined)
    fields.defaultBranch = body.defaultBranch as string;
  if (body.defaultFeatureProfileId !== undefined)
    fields.defaultFeatureProfileId = body.defaultFeatureProfileId as string;
  if (body.defaultReviewProfileId !== undefined)
    fields.defaultReviewProfileId = body.defaultReviewProfileId as string;
  if (body.autoReviewEnabled !== undefined)
    fields.autoReviewEnabled = body.autoReviewEnabled as boolean;
  if (body.mcpServers !== undefined)
    fields.mcpServers = body.mcpServers as Repository["mcpServers"];
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "archived") {
      throw new ValidationError('status must be "active" or "archived"');
    }
    fields.status = body.status as "active" | "archived";
  }

  if (Object.keys(fields).length === 0) {
    throw new ValidationError("At least one field must be provided for update");
  }

  const updated = await updateRepository(repoId, fields);
  return buildSuccessResponse(200, updated);
}

// ─── GET /repositories/{repoId}/credential ───

async function handleGetCredential(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const repoId = requirePathParam(event, "repoId");
  const repo = await getRepositoryById(repoId);
  if (!repo) throw new NotFoundError(`Repository ${repoId} not found`);

  const cred = await getCredentialByRepoId(repoId);
  if (!cred) {
    return buildSuccessResponse(200, { repoId, configured: false });
  }
  return buildSuccessResponse(200, cred);
}

// ─── PUT /repositories/{repoId}/credential ───

async function handlePutCredential(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const repoId = requirePathParam(event, "repoId");
  const repo = await getRepositoryById(repoId);
  if (!repo) throw new NotFoundError(`Repository ${repoId} not found`);

  const body = parseJsonBody<Record<string, unknown>>(event);
  const { credentialType } = requireFields<{ credentialType: string }>(body, ["credentialType"]);

  if (!VALID_CRED_TYPES.includes(credentialType as GitCredentialType)) {
    throw new ValidationError(`credentialType must be one of: ${VALID_CRED_TYPES.join(", ")}`);
  }

  const now = new Date().toISOString();
  let secretArn: string | null = null;
  let username: string | null = null;

  if (credentialType === "https_basic") {
    const token = body.token as string | undefined;
    username = (body.username as string) ?? null;
    if (!token) throw new ValidationError("token is required for https_basic credentials");
    secretArn = await createOrUpdateSecret(repoId, {
      credentialType,
      username: username ?? undefined,
      token,
    });
  } else if (credentialType === "ssh_key") {
    const sshPrivateKey = body.sshPrivateKey as string | undefined;
    if (!sshPrivateKey) throw new ValidationError("sshPrivateKey is required for ssh_key credentials");
    secretArn = await createOrUpdateSecret(repoId, {
      credentialType,
      sshPrivateKey,
    });
  } else if (credentialType === "codecommit_iam") {
    // No secret needed — agent uses its IAM role
    secretArn = null;
  }

  const cred: GitCredential = {
    repoId,
    credentialType: credentialType as GitCredentialType,
    secretArn,
    username,
    configured: true,
    createdAt: now,
    updatedAt: now,
  };

  const existing = await getCredentialByRepoId(repoId);
  if (existing) {
    cred.createdAt = existing.createdAt;
  }

  await putCredential(cred);
  return buildSuccessResponse(200, cred);
}

// ─── DELETE /repositories/{repoId}/credential ───

async function handleDeleteCredential(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const repoId = requirePathParam(event, "repoId");
  const cred = await getCredentialByRepoId(repoId);
  if (!cred) throw new NotFoundError(`No credential configured for repository ${repoId}`);

  if (cred.secretArn) {
    await deleteSecret(repoId);
  }
  await deleteCredential(repoId);
  return buildSuccessResponse(200, { deleted: true });
}

// ─── Router ───

export async function handler(
  rawEvent: unknown,
): Promise<APIGatewayProxyResult> {
  const event = normalizeEvent(rawEvent as Record<string, unknown>);
  const logger = createRequestLogger(event);
  try {
    const userId = await validateCognitoJwt(event);
    const method = event.httpMethod;
    const hasRepoId = !!event.pathParameters?.repoId;

    logger.info("Repository handler invoked", { method, hasRepoId });

    if (method === "POST" && !hasRepoId) {
      return await handleCreate(event, userId);
    }
    if (method === "GET" && !hasRepoId) {
      return await handleList(event, userId);
    }
    if (method === "GET" && hasRepoId) {
      const path = event.path ?? "";
      if (path.endsWith("/credential")) {
        return await handleGetCredential(event);
      }
      return await handleGetOne(event);
    }
    if (method === "PUT" && hasRepoId) {
      const path = event.path ?? "";
      if (path.endsWith("/credential")) {
        return await handlePutCredential(event);
      }
    }
    if (method === "DELETE" && hasRepoId) {
      const path = event.path ?? "";
      if (path.endsWith("/credential")) {
        return await handleDeleteCredential(event);
      }
    }
    if (method === "PATCH" && hasRepoId) {
      return await handleUpdate(event);
    }

    return buildSuccessResponse(404, {
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  } catch (err) {
    logger.error("Repository handler error", {
      error: (err as Error).message,
    });
    return buildErrorResponse(err as Error);
  }
}
