import {
  PutCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { JobSpec, SpecPhase, SpecPhaseData, SpecPhaseStatus } from "@remote-kiro/common";
import { docClient, TABLE } from "./client.js";

function toItem(spec: JobSpec) {
  return {
    PK: `JOB#${spec.jobId}`,
    SK: "SPEC",
    ...spec,
  };
}

export async function createSpec(spec: JobSpec): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: toItem(spec),
    }),
  );
}

export async function getSpecByJobId(jobId: string): Promise<JobSpec | undefined> {
  const { Item } = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `JOB#${jobId}`, SK: "SPEC" } }),
  );
  return Item as JobSpec | undefined;
}

export async function updateSpecPhase(
  jobId: string,
  phase: SpecPhase,
  updates: Partial<SpecPhaseData>,
): Promise<JobSpec> {
  const now = new Date().toISOString();
  const names: Record<string, string> = {
    "#phases": "phases",
    "#phase": phase,
    "#updatedAt": "updatedAt",
  };
  const values: Record<string, unknown> = {
    ":updatedAt": now,
  };
  const parts: string[] = ["#updatedAt = :updatedAt"];

  const fieldMap: Array<[keyof SpecPhaseData, string]> = [
    ["status", "status"],
    ["items", "items"],
    ["generatedAt", "generatedAt"],
    ["approvedAt", "approvedAt"],
    ["rejectionReason", "rejectionReason"],
    ["revision", "revision"],
  ];

  for (const [field, attr] of fieldMap) {
    if (updates[field] !== undefined) {
      names[`#${attr}`] = attr;
      values[`:${attr}`] = updates[field];
      parts.push(`#phases.#phase.#${attr} = :${attr}`);
    }
  }

  const { Attributes } = await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `JOB#${jobId}`, SK: "SPEC" },
      UpdateExpression: `SET ${parts.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(PK)",
      ReturnValues: "ALL_NEW",
    }),
  );

  return Attributes as JobSpec;
}

export async function updateSpecCurrentPhase(
  jobId: string,
  currentPhase: SpecPhase,
): Promise<void> {
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `JOB#${jobId}`, SK: "SPEC" },
      UpdateExpression: "SET #currentPhase = :currentPhase, #updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#currentPhase": "currentPhase",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":currentPhase": currentPhase,
        ":updatedAt": now,
      },
      ConditionExpression: "attribute_exists(PK)",
    }),
  );
}
