import {
  PutCommand,
  GetCommand,
  UpdateCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Agent } from "@remote-kiro/common";
import { docClient, TABLE } from "./client.js";

function toItem(agent: Agent) {
  return {
    PK: `AGENT#${agent.agentId}`,
    SK: "AGENT",
    ...agent,
  };
}

export async function createOrUpdateAgent(agent: Agent): Promise<void> {
  await docClient.send(new PutCommand({ TableName: TABLE, Item: toItem(agent) }));
}

export async function getAgentById(
  agentId: string,
): Promise<Agent | undefined> {
  const { Item } = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `AGENT#${agentId}`, SK: "AGENT" } }),
  );
  return Item as Agent | undefined;
}

export async function listAgents(): Promise<Agent[]> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: "SK = :sk",
      ExpressionAttributeValues: { ":sk": "AGENT" },
    }),
  );
  return (result.Items ?? []) as Agent[];
}

export async function updateHeartbeat(agentId: string): Promise<void> {
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `AGENT#${agentId}`, SK: "AGENT" },
      UpdateExpression: "SET #lh = :now, #st = :online, #ua = :now",
      ExpressionAttributeNames: {
        "#lh": "lastHeartbeatAt",
        "#st": "status",
        "#ua": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":now": now,
        ":online": "online",
      },
      ConditionExpression: "attribute_exists(PK)",
    }),
  );
}
