import {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Repository } from "@remote-kiro/common";
import { docClient, TABLE } from "./client.js";

export interface PaginatedResult<T> {
  items: T[];
  nextToken: string | null;
}

function toItem(repo: Repository) {
  return {
    PK: `REPO#${repo.repoId}`,
    SK: "REPO",
    GSI1PK: `USER#${repo.createdBy}`,
    GSI1SK: `REPO#${repo.createdAt}`,
    ...repo,
  };
}

export async function createRepository(repo: Repository): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: toItem(repo),
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
}

export async function getRepositoryById(
  repoId: string,
): Promise<Repository | undefined> {
  const { Item } = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `REPO#${repoId}`, SK: "REPO" } }),
  );
  return Item as Repository | undefined;
}

export async function listRepositoriesByUser(
  createdBy: string,
  nextToken?: string,
  limit = 25,
): Promise<PaginatedResult<Repository>> {
  const exclusiveStartKey = nextToken
    ? JSON.parse(Buffer.from(nextToken, "base64url").toString("utf-8"))
    : undefined;

  const { Items, LastEvaluatedKey } = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `USER#${createdBy}`, ":prefix": "REPO#" },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );

  return {
    items: (Items ?? []) as Repository[],
    nextToken: LastEvaluatedKey
      ? Buffer.from(JSON.stringify(LastEvaluatedKey)).toString("base64url")
      : null,
  };
}

export async function updateRepository(
  repoId: string,
  fields: Partial<Pick<Repository, "defaultBranch" | "defaultFeatureProfileId" | "defaultReviewProfileId" | "autoReviewEnabled" | "status">>,
): Promise<Repository> {
  const now = new Date().toISOString();
  const names: Record<string, string> = { "#updatedAt": "updatedAt" };
  const values: Record<string, unknown> = { ":updatedAt": now };
  const parts: string[] = ["#updatedAt = :updatedAt"];

  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) {
      names[`#${key}`] = key;
      values[`:${key}`] = val;
      parts.push(`#${key} = :${key}`);
    }
  }

  const { Attributes } = await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `REPO#${repoId}`, SK: "REPO" },
      UpdateExpression: `SET ${parts.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(PK)",
      ReturnValues: "ALL_NEW",
    }),
  );

  return Attributes as Repository;
}
