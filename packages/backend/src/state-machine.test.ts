import { describe, it, expect } from "vitest";
import { JobStatus, VALID_TRANSITIONS, TERMINAL_STATUSES } from "@remote-kiro/common";
import { ConflictError } from "./db/errors.js";
import { validateTransition, isTerminalStatus } from "./state-machine.js";

// ─── Unit Tests ───

describe("validateTransition", () => {
  it("allows QUEUED → CLAIMED", () => {
    expect(() => validateTransition(JobStatus.QUEUED, JobStatus.CLAIMED)).not.toThrow();
  });

  it("allows CLAIMED → RUNNING", () => {
    expect(() => validateTransition(JobStatus.CLAIMED, JobStatus.RUNNING)).not.toThrow();
  });

  it("allows RUNNING → COMPLETED", () => {
    expect(() => validateTransition(JobStatus.RUNNING, JobStatus.COMPLETED)).not.toThrow();
  });

  it("allows RUNNING → FAILED", () => {
    expect(() => validateTransition(JobStatus.RUNNING, JobStatus.FAILED)).not.toThrow();
  });

  it("allows cancellation from QUEUED, CLAIMED, RUNNING", () => {
    expect(() => validateTransition(JobStatus.QUEUED, JobStatus.CANCELLED)).not.toThrow();
    expect(() => validateTransition(JobStatus.CLAIMED, JobStatus.CANCELLED)).not.toThrow();
    expect(() => validateTransition(JobStatus.RUNNING, JobStatus.CANCELLED)).not.toThrow();
  });

  it("allows timeout from QUEUED, CLAIMED, RUNNING", () => {
    expect(() => validateTransition(JobStatus.QUEUED, JobStatus.TIMED_OUT)).not.toThrow();
    expect(() => validateTransition(JobStatus.CLAIMED, JobStatus.TIMED_OUT)).not.toThrow();
    expect(() => validateTransition(JobStatus.RUNNING, JobStatus.TIMED_OUT)).not.toThrow();
  });

  it("rejects QUEUED → COMPLETED (skipping intermediate states)", () => {
    expect(() => validateTransition(JobStatus.QUEUED, JobStatus.COMPLETED)).toThrow(ConflictError);
  });

  it("rejects transitions from terminal statuses", () => {
    for (const terminal of [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED, JobStatus.TIMED_OUT]) {
      expect(() => validateTransition(terminal, JobStatus.RUNNING)).toThrow(ConflictError);
    }
  });

  it("throws ConflictError with INVALID_STATUS_TRANSITION code", () => {
    try {
      validateTransition(JobStatus.COMPLETED, JobStatus.RUNNING);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).code).toBe("INVALID_STATUS_TRANSITION");
      expect((err as ConflictError).message).toContain("COMPLETED");
      expect((err as ConflictError).message).toContain("RUNNING");
    }
  });
});

describe("isTerminalStatus", () => {
  it("returns true for terminal statuses", () => {
    expect(isTerminalStatus(JobStatus.COMPLETED)).toBe(true);
    expect(isTerminalStatus(JobStatus.FAILED)).toBe(true);
    expect(isTerminalStatus(JobStatus.CANCELLED)).toBe(true);
    expect(isTerminalStatus(JobStatus.TIMED_OUT)).toBe(true);
  });

  it("returns false for non-terminal statuses", () => {
    expect(isTerminalStatus(JobStatus.QUEUED)).toBe(false);
    expect(isTerminalStatus(JobStatus.CLAIMED)).toBe(false);
    expect(isTerminalStatus(JobStatus.RUNNING)).toBe(false);
  });
});
