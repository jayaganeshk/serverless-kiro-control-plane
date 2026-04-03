import type { APIGatewayProxyEvent } from "aws-lambda";
import { AuthError } from "./error-handler.js";

/**
 * Extract the Bearer token from the Authorization header.
 */
export function extractBearerToken(event: APIGatewayProxyEvent): string {
  const header = event.headers?.Authorization ?? event.headers?.authorization;
  if (!header) {
    throw new AuthError("Missing Authorization header");
  }
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    throw new AuthError("Invalid Authorization header format — expected Bearer token");
  }
  return parts[1];
}

/**
 * Decode a JWT payload without verification.
 * API Gateway's Cognito authorizer already validates the token,
 * so the Lambda only needs to extract claims.
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthError("Invalid JWT token format");
  }
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    throw new AuthError("Failed to decode JWT payload");
  }
}

/**
 * Extract the user sub claim from a Cognito JWT.
 * The token is already validated by API Gateway's Cognito authorizer.
 */
export async function validateCognitoJwt(event: APIGatewayProxyEvent): Promise<string> {
  const token = extractBearerToken(event);
  const payload = decodeJwtPayload(token);

  const sub = payload.sub;
  if (typeof sub !== "string" || !sub) {
    throw new AuthError("JWT missing sub claim");
  }
  return sub;
}

/**
 * Reset the cached JWKS client (no-op, kept for test compatibility).
 */
export function resetJwksClient(): void {
  // No-op — JWKS client no longer used
}
