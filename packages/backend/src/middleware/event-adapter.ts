import type { APIGatewayProxyEvent } from "aws-lambda";

/**
 * Normalize an HTTP API v2 event to look like a REST API v1 event.
 * SAM HttpApi sends payload format 2.0 by default, but our handlers
 * expect the v1 shape (event.httpMethod, event.path, etc.).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeEvent(event: any): APIGatewayProxyEvent {
  // Already v1 format
  if (event.httpMethod) return event as APIGatewayProxyEvent;

  // Adapt v2 → v1
  const http = event.requestContext?.http;
  if (http) {
    event.httpMethod = http.method ?? "GET";
    event.path = event.rawPath ?? http.path ?? "";
  }

  return event as APIGatewayProxyEvent;
}
