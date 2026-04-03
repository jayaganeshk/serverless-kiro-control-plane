import { JobStatus, VALID_TRANSITIONS, TERMINAL_STATUSES } from "@remote-kiro/common";
import { ConflictError } from "./db/errors.js";

/**
 * Validates that a job status transition is allowed by the state machine.
 * Throws ConflictError if the transition is invalid.
 */
export function validateTransition(currentStatus: JobStatus, newStatus: JobStatus): void {
  const allowedTargets = VALID_TRANSITIONS.get(currentStatus);

  if (!allowedTargets || !allowedTargets.has(newStatus)) {
    throw new ConflictError(
      `Invalid status transition from ${currentStatus} to ${newStatus}`,
      "INVALID_STATUS_TRANSITION",
    );
  }
}

/**
 * Returns true if the given status is terminal (no further transitions allowed).
 */
export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
