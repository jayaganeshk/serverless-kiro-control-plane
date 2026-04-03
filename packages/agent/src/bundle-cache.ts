import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

export class BundleCache {
  private readonly cacheDir: string;
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    this.s3 = new S3Client({});
    const bucket = process.env.BUNDLES_BUCKET;
    if (!bucket) {
      throw new Error("BUNDLES_BUCKET environment variable is not set");
    }
    this.bucket = bucket;
  }

  /**
   * Returns the local path to a cached bundle zip.
   * Downloads from S3 if not already cached.
   */
  async getBundle(
    profileId: string,
    version: number,
    s3Key: string,
  ): Promise<string> {
    const cachedPath = join(
      this.cacheDir,
      profileId,
      `v${version}`,
      "bundle.zip",
    );

    if (existsSync(cachedPath)) {
      return cachedPath;
    }

    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: s3Key }),
    );

    if (!response.Body) {
      throw new Error(`Empty response body for s3://${this.bucket}/${s3Key}`);
    }

    const bytes = await response.Body.transformToByteArray();

    await mkdir(dirname(cachedPath), { recursive: true });
    await writeFile(cachedPath, bytes);

    return cachedPath;
  }
}
