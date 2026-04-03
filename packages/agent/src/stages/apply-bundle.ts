import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, cp } from "node:fs/promises";
import { join } from "node:path";
import type { StageRunner } from "../pipeline";
import type { BundleCache } from "../bundle-cache";
import type { SQSJobMessage, ImplementFeatureMessage } from "@remote-kiro/common";

export interface ApplyBundleDeps {
  bundleCache: BundleCache;
  workspaceRoot: string;
}

// ─── Factory ───

export function createApplyBundleStage(deps: ApplyBundleDeps): StageRunner {
  return {
    name: "APPLYING_BUNDLE",
    run: async (_jobId: string, message: SQSJobMessage): Promise<void> => {
      const msg = message as ImplementFeatureMessage;
      const repoDir = join(deps.workspaceRoot, msg.repoId);
      const kiroDir = join(repoDir, ".kiro");

      if (!msg.bundleVersion || msg.bundleVersion === 0) {
        await mkdir(kiroDir, { recursive: true });
        return;
      }

      // Download bundle zip via cache
      const s3Key = `bundles/${msg.profileId}/v${msg.bundleVersion}/bundle.zip`;
      const zipPath = await deps.bundleCache.getBundle(
        msg.profileId,
        msg.bundleVersion,
        s3Key,
      );

      // Extract to a temp directory
      const extractDir = join(repoDir, ".kiro-bundle-tmp");
      await mkdir(extractDir, { recursive: true });
      await unzip(zipPath, extractDir);

      // Ensure .kiro/ exists
      await mkdir(kiroDir, { recursive: true });

      // Copy extracted contents into .kiro/, overwriting existing files
      // Layer 4 defaults with Layer 3 precedence: bundle files are defaults,
      // existing repo .kiro files take precedence where they exist
      const bundleEntries = await readdir(extractDir, { withFileTypes: true });
      for (const entry of bundleEntries) {
        const src = join(extractDir, entry.name);
        const dest = join(kiroDir, entry.name);

        if (entry.name === "manifest.json") {
          // Always overwrite manifest
          await cp(src, dest, { recursive: true, force: true });
        } else if (!existsSync(dest)) {
          // Layer 4 default: only copy if not already present (Layer 3 precedence)
          await cp(src, dest, { recursive: true });
        } else {
          // Overwrite bundle-managed files
          await cp(src, dest, { recursive: true, force: true });
        }
      }

      // Clean up temp directory
      await rm(extractDir);
    },
  };
}

// ─── Helpers ───


function unzip(zipPath: string, destDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile("unzip", ["-o", zipPath, "-d", destDir], (error) => {
      if (error) {
        reject(new Error(`Failed to extract bundle: ${error.message}`));
        return;
      }
      resolve();
    });
  });
}

async function rm(dir: string): Promise<void> {
  const { rm: fsRm } = await import("node:fs/promises");
  await fsRm(dir, { recursive: true, force: true });
}
