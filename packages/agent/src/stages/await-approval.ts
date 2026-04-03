import type { StageRunner } from "../pipeline";
import type { BackendApiClient } from "../api-client";
import type { EventBuffer } from "../event-buffer";
import type { SQSJobMessage } from "@remote-kiro/common";
import { JobStatus, SpecPhase } from "@remote-kiro/common";

export interface AwaitApprovalDeps {
  phase: SpecPhase;
  apiClient: BackendApiClient;
  eventBuffer: EventBuffer;
}

const STAGE_NAMES: Record<SpecPhase, string> = {
  [SpecPhase.REQUIREMENTS]: "AWAITING_REQUIREMENTS_APPROVAL",
  [SpecPhase.DESIGN]: "AWAITING_DESIGN_APPROVAL",
  [SpecPhase.TASKS]: "AWAITING_TASKS_APPROVAL",
};

export class AwaitingApprovalError extends Error {
  public readonly phase: SpecPhase;

  constructor(phase: SpecPhase) {
    super(`Awaiting approval for ${phase}`);
    this.name = "AwaitingApprovalError";
    this.phase = phase;
  }
}

export function createAwaitApprovalStage(deps: AwaitApprovalDeps): StageRunner {
  const stageName = STAGE_NAMES[deps.phase];

  return {
    name: stageName,
    run: async (jobId: string, _message: SQSJobMessage): Promise<void> => {
      await deps.eventBuffer.bufferEvent(jobId, {
        eventType: "log",
        message: `Waiting for ${deps.phase} approval...`,
        stage: stageName,
        metadata: { phase: deps.phase },
      });

      // Transition job to AWAITING_APPROVAL
      await deps.apiClient.updateJobStatus(jobId, {
        status: JobStatus.AWAITING_APPROVAL,
      });

      // Throw a special error that the pipeline recognizes as "pause"
      throw new AwaitingApprovalError(deps.phase);
    },
  };
}
