import type { APIGatewayProxyResult } from "aws-lambda";
import type { ApiResponse } from "@remote-kiro/common";
import { ConflictError } from "../db/errors.js";

// ─── Custom Error Classes ───

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// ─── Error → HTTP Status Mapping ───

function statusCodeForError(err: Error): number {
  if (err instanceof AuthError) return 401;
  if (err instanceof ValidationError) return 400;
  if (err instanceof NotFoundError) return 404;
  if (err instanceof ConflictError) return 409;
  return 500;
}

function errorCodeForError(err: Error): string {
  if (err instanceof AuthError) return "UNAUTHORIZED";
  if (err instanceof ValidationError) return "VALIDATION_ERROR";
  if (err instanceof NotFoundError) return "NOT_FOUND";
  if (err instanceof ConflictError) return (err as ConflictError).code;
  return "INTERNAL_ERROR";
}

// ─── Response Builders ───

export function buildSuccessResponse<T>(
  statusCode: number,
  data: T,
  pagination?: { nextToken: string | null },
): APIGatewayProxyResult {
  const body: ApiResponse<T> = { data };
  if (pagination) {
    body.pagination = pagination;
  }
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function buildErrorResponse(err: Error): APIGatewayProxyResult {
  const statusCode = statusCodeForError(err);
  const body: ApiResponse = {
    error: {
      code: errorCodeForError(err),
      message: statusCode === 500 ? "Internal server error" : err.message,
    },
  };
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
