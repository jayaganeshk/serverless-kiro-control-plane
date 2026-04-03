import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE } from "./client.js";

export interface PhaseMessage {
  jobId: string;
  phase: string;
  messageId: string;
  message: string;
  sender: string;
  createdAt: string;
}

export async function addPhaseMessage(msg: PhaseMessage): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `JOB#${msg.jobId}`,
        SK: `PHASE_MSG#${msg.phase}#${msg.createdAt}#${msg.messageId}`,
        ...msg,
      },
    }),
  );
}

export async function getPhaseMessages(
  jobId: string,
  phase: string,
): Promise<PhaseMessage[]> {
  const { Items } = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `JOB#${jobId}`,
        ":sk": `PHASE_MSG#${phase}#`,
      },
      ScanIndexForward: true,
    }),
  );
  return (Items ?? []) as PhaseMessage[];
}
