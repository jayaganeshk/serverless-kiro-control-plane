import {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Profile } from "@remote-kiro/common";
import { docClient, TABLE } from "./client.js";

function toItem(profile: Profile) {
  return {
    PK: `PROFILE#${profile.profileId}`,
    SK: "PROFILE",
    GSI2PK: "PROFILES",
    GSI2SK: profile.createdAt,
    ...profile,
  };
}

export async function createProfile(profile: Profile): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: toItem(profile),
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
}

export async function getProfileById(
  profileId: string,
): Promise<Profile | undefined> {
  const { Item } = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `PROFILE#${profileId}`, SK: "PROFILE" } }),
  );
  return Item as Profile | undefined;
}

export async function listAllProfiles(): Promise<Profile[]> {
  const { Items } = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :pk",
      ExpressionAttributeValues: { ":pk": "PROFILES" },
      ScanIndexForward: false,
    }),
  );
  return (Items ?? []) as Profile[];
}

export async function updateProfile(
  profileId: string,
  fields: Partial<Pick<Profile, "name" | "bundleVersion" | "bundleS3Key" | "description" | "manifest" | "active">>,
): Promise<Profile> {
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
      Key: { PK: `PROFILE#${profileId}`, SK: "PROFILE" },
      UpdateExpression: `SET ${parts.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(PK)",
      ReturnValues: "ALL_NEW",
    }),
  );

  return Attributes as Profile;
}
