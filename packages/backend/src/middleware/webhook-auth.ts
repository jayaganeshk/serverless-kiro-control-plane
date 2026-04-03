import { createHmac, timingSafeEqual } from "node:crypto";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { AuthError } from "./error-handler.js";

/**
 * Validate the GitHub webhook signature (X-Hub-Signature-256) using HMAC-SHA256.
 * Throws AuthError if the signature is missing, malformed, or invalid.
 */
export function validateWebhookSignature(event: APIGatewayProxyEvent): void {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    throw new AuthError("GITHUB_WEBHOOK_SECRET environment variable is not set");
  }

  const signatureHeader =
    event.headers?.["X-Hub-Signature-256"] ??
    event.headers?.["x-hub-signature-256"];

  if (!signatureHeader) {
    throw new AuthError("Missing X-Hub-Signature-256 header");
  }

  if (!signatureHeader.startsWith("sha256=")) {
    throw new AuthError("Invalid signature format — expected sha256= prefix");
  }

  const body = event.body ?? "";
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const expectedBuffer = Buffer.from(`sha256=${expected}`, "utf-8");
  const receivedBuffer = Buffer.from(signatureHeader, "utf-8");

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new AuthError("Invalid webhook signature");
  }
}
