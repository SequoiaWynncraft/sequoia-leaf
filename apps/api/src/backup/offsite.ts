import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { S3Client } from "bun";
import { Redacted } from "effect";

import { listSnapshots } from "./snapshot.ts";

/** Somewhere off the server that snapshots are copied to. */
export interface Offsite {
  /** Copies a local file there under this name, replacing anything already under it. */
  upload(name: string, path: string): Promise<void>;
}

/** An S3-compatible bucket, such as Cloudflare R2. */
export interface BucketConfig {
  /** For R2, `https://<account id>.r2.cloudflarestorage.com`. */
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: Redacted.Redacted;
}

export function bucketOffsite(config: BucketConfig): Offsite {
  const client = new S3Client({ ...config, secretAccessKey: Redacted.value(config.secretAccessKey), region: "auto" });
  return {
    async upload(name, path) {
      await client.write(name, Bun.file(path), { type: "application/vnd.sqlite3" });
    },
  };
}

/** After a failed copy, the next attempt waits this long. */
export const RETRY_MS = 10 * 60_000;

/** Holds the name of the newest snapshot copied off the server. It does not look like a snapshot, so it is never pruned. */
const COPIED = "offsite-copied";

/**
 * Returns a task that copies the newest snapshot off the server once. Run it
 * every minute: it does nothing until a new snapshot appears, and after a
 * failure it waits `RETRY_MS` before trying again. It returns the name of the
 * snapshot it copied, or undefined when it copied none, and throws when a
 * copy fails.
 *
 * Only the newest snapshot is copied. One that was replaced by a newer one
 * before it could be copied is skipped, since the newer one holds everything
 * it held. The bucket deletes old copies by itself.
 */
export function offsiteCopier(offsite: Offsite, directory: string): (now: number) => Promise<string | undefined> {
  let failedAt = Number.NEGATIVE_INFINITY;
  let copying = false;
  return async (now) => {
    const newest = listSnapshots(directory).at(-1);
    if (newest === undefined || copying || now - failedAt < RETRY_MS) {
      return undefined;
    }
    // Set before the first wait, so a run that starts meanwhile sees it.
    copying = true;
    try {
      const marker = join(directory, COPIED);
      const copied = Bun.file(marker);
      if ((await copied.exists()) && (await copied.text()) === newest.name) {
        return undefined;
      }
      try {
        await offsite.upload(newest.name, join(directory, newest.name));
      } catch (error) {
        failedAt = now;
        throw error;
      }
      // Written under another name and renamed, so the marker is never half written.
      const unfinished = `${marker}.${crypto.randomUUID()}.partial`;
      writeFileSync(unfinished, newest.name);
      renameSync(unfinished, marker);
      return newest.name;
    } finally {
      copying = false;
    }
  };
}
