import {
  SecretsManagerClient,
  CreateSecretCommand,
  UpdateSecretCommand,
  GetSecretValueCommand,
  DeleteSecretCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({});
const STAGE = process.env.STAGE ?? "dev";

function secretName(repoId: string): string {
  return `remote-kiro/${STAGE}/${repoId}/git-credential`;
}

export interface SecretPayload {
  credentialType: string;
  username?: string;
  password?: string;
  token?: string;
  sshPrivateKey?: string;
}

export async function createOrUpdateSecret(
  repoId: string,
  payload: SecretPayload,
): Promise<string> {
  const name = secretName(repoId);
  const secretString = JSON.stringify(payload);

  try {
    const result = await client.send(
      new CreateSecretCommand({
        Name: name,
        SecretString: secretString,
        Description: `Git credential for repo ${repoId}`,
      }),
    );
    return result.ARN!;
  } catch (err: unknown) {
    if ((err as Error).name === "ResourceExistsException") {
      const result = await client.send(
        new UpdateSecretCommand({
          SecretId: name,
          SecretString: secretString,
        }),
      );
      return result.ARN!;
    }
    throw err;
  }
}

export async function getSecret(
  repoId: string,
): Promise<SecretPayload | null> {
  const name = secretName(repoId);
  try {
    const result = await client.send(
      new GetSecretValueCommand({ SecretId: name }),
    );
    return JSON.parse(result.SecretString!) as SecretPayload;
  } catch (err: unknown) {
    if (err instanceof ResourceNotFoundException) {
      return null;
    }
    throw err;
  }
}

export async function deleteSecret(repoId: string): Promise<void> {
  const name = secretName(repoId);
  try {
    await client.send(
      new DeleteSecretCommand({
        SecretId: name,
        ForceDeleteWithoutRecovery: true,
      }),
    );
  } catch (err: unknown) {
    if (err instanceof ResourceNotFoundException) {
      return;
    }
    throw err;
  }
}
