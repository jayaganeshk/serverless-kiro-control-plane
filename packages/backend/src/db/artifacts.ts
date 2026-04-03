import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { Artifact } from "@remote-kiro/common";
import { docClient, TABLE } from "./client.js";

export async function createArtifact(artifact: Artifact): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `JOB#${artifact.jobId}`,
        SK: `ARTIFACT#${artifact.artifactId}`,
        ...artifact,
      },
    }),
  );
}

export async function listArtifactsByJob(jobId: string): Promise<Artifact[]> {
  const { Items } = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `JOB#${jobId}`, ":prefix": "ARTIFACT#" },
      ScanIndexForward: true,
    }),
  );
  return (Items ?? []) as Artifact[];
}
