import type { APIGatewayProxyEvent } from "aws-lambda";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  lambdaName: string;
  requestId: string;
  jobId: string | null;
  message: string;
  metadata?: Record<string, unknown>;
}

const lambdaName = process.env.AWS_LAMBDA_FUNCTION_NAME ?? "unknown";

/**
 * Extract jobId from API Gateway path parameters when available.
 */
export function extractJobId(event: APIGatewayProxyEvent): string | null {
  return event.pathParameters?.jobId ?? null;
}

/**
 * Create a structured JSON log entry and write it to stdout (CloudWatch).
 */
export function log(
  level: LogLevel,
  message: string,
  opts: {
    requestId?: string;
    jobId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    lambdaName,
    requestId: opts.requestId ?? "unknown",
    jobId: opts.jobId ?? null,
    message,
    metadata: opts.metadata,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

/**
 * Convenience helpers scoped to a specific request context.
 */
export function createRequestLogger(event: APIGatewayProxyEvent) {
  const requestId =
    event.requestContext?.requestId ?? "unknown";
  const jobId = extractJobId(event);

  return {
    debug: (message: string, metadata?: Record<string, unknown>) =>
      log("debug", message, { requestId, jobId, metadata }),
    info: (message: string, metadata?: Record<string, unknown>) =>
      log("info", message, { requestId, jobId, metadata }),
    warn: (message: string, metadata?: Record<string, unknown>) =>
      log("warn", message, { requestId, jobId, metadata }),
    error: (message: string, metadata?: Record<string, unknown>) =>
      log("error", message, { requestId, jobId, metadata }),
  };
}
