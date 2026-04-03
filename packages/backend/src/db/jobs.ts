import {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { Job, JobStatus, SpecPhase } from "@remote-kiro/common";
import { docClient, TABLE } from "./client.js";
import { ConflictError } from "./errors.js";
import type { PaginatedResult } from "./repositories.js";

function toItem(job: Job) {
  return {
    PK: `JOB#${job.jobId}`,
    SK: "JOB",
    GSI1PK: `USER#${job.requestedBy}`,
    GSI1SK: `JOB#${job.createdAt}`,
    GSI2PK: `JOBSTATUS#${job.status}`,
    GSI2SK: job.createdAt,
    ...job,
  };
}

// ─── Create ───

export async function createJob(job: Job): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: toItem(job),
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
}

// ─── Get by ID ───

export async function getJobById(jobId: string): Promise<Job | undefined> {
  const { Item } = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `JOB#${jobId}`, SK: "JOB" } }),
  );
  return Item as Job | undefined;
}

// ─── Conditional status transition ───

export interface StatusTransitionFields {
  status: JobStatus;
  assignedAgentId?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
  commitSha?: string | null;
  reviewOutcome?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  specPhase?: SpecPhase | null;
}

/**
 * Atomically transition a job from `expectedStatus` to the fields in `updates`.
 * Uses a ConditionExpression on the status field to prevent race conditions.
 * Also updates GSI2PK to reflect the new status.
 * Throws ConflictError if the current status doesn't match expectedStatus.
 */
export async function transitionJobStatus(
  jobId: string,
  expectedStatus: JobStatus,
  updates: StatusTransitionFields,
): Promise<{ previousStatus: JobStatus }> {
  const now = new Date().toISOString();
  const names: Record<string, string> = {
    "#status": "status",
    "#updatedAt": "updatedAt",
    "#GSI2PK": "GSI2PK",
  };
  const values: Record<string, unknown> = {
    ":expectedStatus": expectedStatus,
    ":newStatus": updates.status,
    ":updatedAt": now,
    ":newGSI2PK": `JOBSTATUS#${updates.status}`,
  };
  const parts: string[] = [
    "#status = :newStatus",
    "#updatedAt = :updatedAt",
    "#GSI2PK = :newGSI2PK",
  ];

  const optionalFields: Array<[keyof StatusTransitionFields, string]> = [
    ["assignedAgentId", "assignedAgentId"],
    ["prNumber", "prNumber"],
    ["prUrl", "prUrl"],
    ["commitSha", "commitSha"],
    ["reviewOutcome", "reviewOutcome"],
    ["errorCode", "errorCode"],
    ["errorMessage", "errorMessage"],
    ["startedAt", "startedAt"],
    ["completedAt", "completedAt"],
    ["specPhase", "specPhase"],
  ];

  for (const [field, attr] of optionalFields) {
    if (updates[field] !== undefined) {
      names[`#${attr}`] = attr;
      values[`:${attr}`] = updates[field];
      parts.push(`#${attr} = :${attr}`);
    }
  }

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `JOB#${jobId}`, SK: "JOB" },
        UpdateExpression: `SET ${parts.join(", ")}`,
        ConditionExpression: "#status = :expectedStatus",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  } catch (err: unknown) {
    if (err instanceof ConditionalCheckFailedException) {
      throw new ConflictError(
        `Job ${jobId} is not in expected status ${expectedStatus}`,
        "INVALID_TRANSITION",
      );
    }
    throw err;
  }

  return { previousStatus: expectedStatus };
}

// ─── Store review report on a job (no status transition needed) ───

export async function updateJobReviewData(
  jobId: string,
  data: { reviewReport: string; reviewOutcome: string; reviewJobId: string },
): Promise<void> {
  const now = new Date().toISOString();
  const historyEntry = {
    reviewJobId: data.reviewJobId,
    reviewReport: data.reviewReport,
    reviewOutcome: data.reviewOutcome,
    reviewedAt: now,
  };
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `JOB#${jobId}`, SK: "JOB" },
      UpdateExpression: "SET #rr = :rr, #ro = :ro, #rj = :rj, #ua = :ua, #rh = list_append(if_not_exists(#rh, :empty), :entry)",
      ExpressionAttributeNames: {
        "#rr": "reviewReport",
        "#ro": "reviewOutcome",
        "#rj": "reviewJobId",
        "#ua": "updatedAt",
        "#rh": "reviewHistory",
      },
      ExpressionAttributeValues: {
        ":rr": data.reviewReport,
        ":ro": data.reviewOutcome,
        ":rj": data.reviewJobId,
        ":ua": now,
        ":entry": [historyEntry],
        ":empty": [],
      },
    }),
  );
}

// ─── GSI1: jobs by user ───

export async function listJobsByUser(
  requestedBy: string,
  options?: { status?: JobStatus; nextToken?: string; limit?: number },
): Promise<PaginatedResult<Job>> {
  const limit = options?.limit ?? 25;
  const exclusiveStartKey = options?.nextToken
    ? JSON.parse(Buffer.from(options.nextToken, "base64url").toString("utf-8"))
    : undefined;

  const exprValues: Record<string, unknown> = {
    ":pk": `USER#${requestedBy}`,
    ":prefix": "JOB#",
  };
  let filterExpression: string | undefined;
  const exprNames: Record<string, string> = {};

  if (options?.status) {
    filterExpression = "#status = :filterStatus";
    exprNames["#status"] = "status";
    exprValues[":filterStatus"] = options.status;
  }

  const { Items, LastEvaluatedKey } = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :prefix)",
      FilterExpression: filterExpression,
      ExpressionAttributeNames: Object.keys(exprNames).length ? exprNames : undefined,
      ExpressionAttributeValues: exprValues,
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );

  return {
    items: (Items ?? []) as Job[],
    nextToken: LastEvaluatedKey
      ? Buffer.from(JSON.stringify(LastEvaluatedKey)).toString("base64url")
      : null,
  };
}

// ─── GSI2: jobs by status ───

export async function listJobsByStatus(
  status: JobStatus,
  options?: { nextToken?: string; limit?: number },
): Promise<PaginatedResult<Job>> {
  const limit = options?.limit ?? 25;
  const exclusiveStartKey = options?.nextToken
    ? JSON.parse(Buffer.from(options.nextToken, "base64url").toString("utf-8"))
    : undefined;

  const { Items, LastEvaluatedKey } = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :pk",
      ExpressionAttributeValues: { ":pk": `JOBSTATUS#${status}` },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );

  return {
    items: (Items ?? []) as Job[],
    nextToken: LastEvaluatedKey
      ? Buffer.from(JSON.stringify(LastEvaluatedKey)).toString("base64url")
      : null,
  };
}
