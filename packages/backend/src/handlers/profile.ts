import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import type { Profile } from "@remote-kiro/common";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import AdmZip from "adm-zip";
import { validateCognitoJwt } from "../middleware/auth.js";
import { createRequestLogger } from "../middleware/logger.js";
import { normalizeEvent } from "../middleware/event-adapter.js";
import {
  parseJsonBody,
  requirePathParam,
  requireFields,
} from "../middleware/request-parser.js";
import {
  buildSuccessResponse,
  buildErrorResponse,
  ValidationError,
  NotFoundError,
} from "../middleware/error-handler.js";
import {
  createProfile,
  getProfileById,
  listAllProfiles,
  updateProfile,
} from "../db/profiles.js";

const s3 = new S3Client({});
const BUNDLES_BUCKET = process.env.BUNDLES_BUCKET ?? "";

// ─── POST /profiles ───

async function handleCreate(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { name, profileType, description } = requireFields<{
    name: string;
    profileType: string;
    description: string;
  }>(body, ["name", "profileType", "description"]);

  if (profileType !== "feature" && profileType !== "reviewer") {
    throw new ValidationError(
      'profileType must be "feature" or "reviewer"',
    );
  }

  const manifest = (body.manifest as Record<string, unknown>) ?? null;
  const now = new Date().toISOString();
  const profile: Profile = {
    profileId: crypto.randomUUID(),
    name,
    profileType: profileType as "feature" | "reviewer",
    bundleVersion: 0,
    bundleS3Key: "",
    description,
    manifest,
    active: !!manifest || false,
    createdAt: now,
    updatedAt: now,
  };

  await createProfile(profile);
  return buildSuccessResponse(201, profile);
}


// ─── GET /profiles ───

async function handleList(): Promise<APIGatewayProxyResult> {
  const profiles = await listAllProfiles();
  return buildSuccessResponse(200, profiles);
}

// ─── POST /profiles/{profileId}/publish-bundle ───

/**
 * Check if a manifest.json contains MCP server definitions with external network endpoints.
 * External endpoints are URLs that are not localhost / 127.0.0.1 / ::1.
 */
function hasExternalMcpEndpoints(manifestContent: string): boolean {
  try {
    const manifest = JSON.parse(manifestContent);
    const mcpServers =
      manifest.mcpServers ?? manifest.mcp_servers ?? manifest.mcpServer;
    if (!mcpServers || typeof mcpServers !== "object") {
      return false;
    }

    const entries = Array.isArray(mcpServers)
      ? mcpServers
      : Object.values(mcpServers);

    for (const server of entries) {
      if (!server || typeof server !== "object") continue;
      const s = server as Record<string, unknown>;
      // Check url, endpoint, host fields for external references
      for (const field of ["url", "endpoint", "host", "uri"]) {
        const value = s[field];
        if (typeof value !== "string") continue;
        // Allow localhost variants
        if (
          value.includes("localhost") ||
          value.includes("127.0.0.1") ||
          value.includes("::1") ||
          value.includes("0.0.0.0")
        ) {
          continue;
        }
        // If it looks like a network URL, reject
        if (
          value.startsWith("http://") ||
          value.startsWith("https://") ||
          value.startsWith("ws://") ||
          value.startsWith("wss://")
        ) {
          return true;
        }
      }
    }
    return false;
  } catch {
    // If manifest isn't valid JSON, let other validation handle it
    return false;
  }
}

async function handlePublishBundle(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const profileId = requirePathParam(event, "profileId");
  const body = parseJsonBody<Record<string, unknown>>(event);

  if (!body.bundle || typeof body.bundle !== "string") {
    throw new ValidationError("bundle field is required as a base64-encoded string");
  }

  // Decode the base64 bundle
  const bundleBuffer = Buffer.from(body.bundle as string, "base64");

  // Inspect zip contents
  const zip = new AdmZip(bundleBuffer);
  const entries = zip.getEntries();
  const entryNames = entries.map((e) => e.entryName);

  // Validate manifest.json presence
  const hasManifest = entryNames.some(
    (name) => name === "manifest.json" || name.endsWith("/manifest.json"),
  );
  if (!hasManifest) {
    throw new ValidationError(
      "Config bundle must contain a manifest.json file",
    );
  }

  // Check for external network MCP endpoints in manifest
  const manifestEntry = entries.find(
    (e) => e.entryName === "manifest.json" || e.entryName.endsWith("/manifest.json"),
  );
  if (manifestEntry) {
    const manifestContent = manifestEntry.getData().toString("utf-8");
    if (hasExternalMcpEndpoints(manifestContent)) {
      throw new ValidationError(
        "Config bundle contains MCP server definitions with external network endpoints",
      );
    }
  }

  // Look up the profile
  const profile = await getProfileById(profileId);
  if (!profile) {
    throw new ValidationError(`Profile ${profileId} not found`);
  }

  // Calculate new version
  const newVersion = profile.bundleVersion + 1;
  const s3Key = `bundles/${profileId}/v${newVersion}/bundle.zip`;

  // Upload to S3
  await s3.send(
    new PutObjectCommand({
      Bucket: BUNDLES_BUCKET,
      Key: s3Key,
      Body: bundleBuffer,
      ContentType: "application/zip",
    }),
  );

  // Update profile
  const updated = await updateProfile(profileId, {
    bundleVersion: newVersion,
    bundleS3Key: s3Key,
    active: true,
  });

  return buildSuccessResponse(200, updated);
}

// ─── GET /profiles/{profileId} ───

async function handleGetProfile(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const profileId = requirePathParam(event, "profileId");
  const profile = await getProfileById(profileId);
  if (!profile) {
    throw new NotFoundError(`Profile ${profileId} not found`);
  }
  return buildSuccessResponse(200, profile);
}

// ─── PATCH /profiles/{profileId} ───

async function handleUpdateManifest(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const profileId = requirePathParam(event, "profileId");
  const body = parseJsonBody<Record<string, unknown>>(event);

  const profile = await getProfileById(profileId);
  if (!profile) {
    throw new NotFoundError(`Profile ${profileId} not found`);
  }

  const updates: Partial<Pick<Profile, "name" | "description" | "manifest" | "active">> = {};
  if (body.name !== undefined) updates.name = body.name as string;
  if (body.description !== undefined) updates.description = body.description as string;
  if (body.manifest !== undefined) {
    updates.manifest = body.manifest as Record<string, unknown> | null;
    updates.active = true;
  }

  const updated = await updateProfile(profileId, updates);
  return buildSuccessResponse(200, updated);
}

// ─── Router ───

export async function handler(
  rawEvent: unknown,
): Promise<APIGatewayProxyResult> {
  const event = normalizeEvent(rawEvent as Record<string, unknown>);
  const logger = createRequestLogger(event);
  try {
    await validateCognitoJwt(event);
    const method = event.httpMethod;
    const hasProfileId = !!event.pathParameters?.profileId;
    const path = event.path ?? "";

    logger.info("Profile handler invoked", { method, hasProfileId, path });

    if (method === "POST" && !hasProfileId) {
      return await handleCreate(event);
    }
    if (method === "GET" && !hasProfileId) {
      return await handleList();
    }
    if (method === "GET" && hasProfileId && !path.endsWith("/publish-bundle")) {
      return await handleGetProfile(event);
    }
    if (method === "PATCH" && hasProfileId) {
      return await handleUpdateManifest(event);
    }
    if (method === "POST" && hasProfileId && path.endsWith("/publish-bundle")) {
      return await handlePublishBundle(event);
    }

    return buildSuccessResponse(404, {
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  } catch (err) {
    logger.error("Profile handler error", {
      error: (err as Error).message,
    });
    return buildErrorResponse(err as Error);
  }
}
