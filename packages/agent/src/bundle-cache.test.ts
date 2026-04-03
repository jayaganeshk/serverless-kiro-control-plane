import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Mock node:fs and node:fs/promises
vi.mock("node:fs", () => ({ existsSync: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock S3Client
const mockSend = vi.fn();
vi.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: class {
      send = mockSend;
    },
    GetObjectCommand: class {
      constructor(public input: unknown) {}
    },
  };
});

describe("BundleCache", () => {
  const CACHE_DIR = "/tmp/bundle-cache";
  const PROFILE_ID = "profile-123";
  const VERSION = 5;
  const S3_KEY = `bundles/${PROFILE_ID}/v${VERSION}/bundle.zip`;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.BUNDLES_BUCKET = "my-bundles-bucket";
  });

  afterEach(() => {
    delete process.env.BUNDLES_BUCKET;
  });

  async function createCache() {
    const { BundleCache } = await import("./bundle-cache.js");
    return new BundleCache(CACHE_DIR);
  }

  it("throws if BUNDLES_BUCKET env var is not set", async () => {
    delete process.env.BUNDLES_BUCKET;
    const { BundleCache } = await import("./bundle-cache.js");
    expect(() => new BundleCache(CACHE_DIR)).toThrow(
      "BUNDLES_BUCKET environment variable is not set",
    );
  });

  it("returns cached path without downloading when file exists", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const cache = await createCache();

    const result = await cache.getBundle(PROFILE_ID, VERSION, S3_KEY);

    const expected = join(CACHE_DIR, PROFILE_ID, `v${VERSION}`, "bundle.zip");
    expect(result).toBe(expected);
    expect(mockSend).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("downloads from S3 and caches when file does not exist", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const fakeBytes = new Uint8Array([1, 2, 3]);
    mockSend.mockResolvedValue({
      Body: { transformToByteArray: () => Promise.resolve(fakeBytes) },
    });

    const cache = await createCache();
    const result = await cache.getBundle(PROFILE_ID, VERSION, S3_KEY);

    const expected = join(CACHE_DIR, PROFILE_ID, `v${VERSION}`, "bundle.zip");
    expect(result).toBe(expected);
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mkdir).toHaveBeenCalledWith(
      join(CACHE_DIR, PROFILE_ID, `v${VERSION}`),
      { recursive: true },
    );
    expect(writeFile).toHaveBeenCalledWith(expected, fakeBytes);
  });

  it("throws when S3 response body is empty", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    mockSend.mockResolvedValue({ Body: undefined });

    const cache = await createCache();
    await expect(
      cache.getBundle(PROFILE_ID, VERSION, S3_KEY),
    ).rejects.toThrow("Empty response body");
  });
});
