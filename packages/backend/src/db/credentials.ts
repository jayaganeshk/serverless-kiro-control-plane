import {
  PutCommand,
  GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { GitCredential } from "@remote-kiro/common";
import { docClient, TABLE } from "./client.js";

function toItem(cred: GitCredential) {
  return {
    PK: `REPO#${cred.repoId}`,
    SK: "CREDENTIAL",
    ...cred,
  };
}

export async function putCredential(cred: GitCredential): Promise<void> {
  await docClient.send(new PutCommand({ TableName: TABLE, Item: toItem(cred) }));
}

export async function getCredentialByRepoId(
  repoId: string,
): Promise<GitCredential | undefined> {
  const { Item } = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `REPO#${repoId}`, SK: "CREDENTIAL" } }),
  );
  return Item as GitCredential | undefined;
}

export async function deleteCredential(repoId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({ TableName: TABLE, Key: { PK: `REPO#${repoId}`, SK: "CREDENTIAL" } }),
  );
}
