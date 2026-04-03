import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { JobEvent } from "@remote-kiro/common";
import { docClient, TABLE } from "./client.js";

export async function createJobEvent(event: JobEvent): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `JOB#${event.jobId}`,
        SK: `EVENT#${event.eventTs}`,
        ...event,
      },
    }),
  );
}

export async function listJobEvents(jobId: string): Promise<JobEvent[]> {
  const { Items } = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `JOB#${jobId}`, ":prefix": "EVENT#" },
      ScanIndexForward: true,
    }),
  );
  return (Items ?? []) as JobEvent[];
}
