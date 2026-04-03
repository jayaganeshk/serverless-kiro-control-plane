import type { APIGatewayProxyEvent } from "aws-lambda";
import { ValidationError } from "./error-handler.js";

/**
 * Parse the JSON body from an API Gateway event.
 * Throws ValidationError if the body is missing or not valid JSON.
 */
export function parseJsonBody<T = Record<string, unknown>>(
  event: APIGatewayProxyEvent,
): T {
  if (!event.body) {
    throw new ValidationError("Request body is required");
  }
  try {
    return JSON.parse(event.body) as T;
  } catch {
    throw new ValidationError("Invalid JSON in request body");
  }
}

/**
 * Extract a required path parameter. Throws ValidationError if missing.
 */
export function requirePathParam(
  event: APIGatewayProxyEvent,
  name: string,
): string {
  const value = event.pathParameters?.[name];
  if (!value) {
    throw new ValidationError(`Missing required path parameter: ${name}`);
  }
  return value;
}

/**
 * Extract an optional query string parameter.
 */
export function getQueryParam(
  event: APIGatewayProxyEvent,
  name: string,
): string | undefined {
  return event.queryStringParameters?.[name] ?? undefined;
}

/**
 * Validate that all required fields are present in an object.
 * Returns the object cast to T if valid, throws ValidationError otherwise.
 */
export function requireFields<T extends Record<string, unknown>>(
  body: Record<string, unknown>,
  fields: string[],
): T {
  const missing = fields.filter(
    (f) => body[f] === undefined || body[f] === null,
  );
  if (missing.length > 0) {
    throw new ValidationError(
      `Missing required fields: ${missing.join(", ")}`,
    );
  }
  return body as T;
}
