import { dirname, join } from "node:path";

import type { BucketConfig } from "./backup/offsite.ts";

export interface Config {
  readonly port: number;
  /** The SQLite file. In production it is on a volume that survives deploys. */
  readonly databasePath: string;
  /** Where snapshots of the database are written. */
  readonly backupDirectory: string;
  /** Origin of sequoia-backend, which reports raids and wars and checks sessions. */
  readonly backendUrl: string;
  /** sequoia-backend's `APP_INTERNAL_API_TOKEN`. Without it the credit feed is not read. */
  readonly backendToken: string | undefined;
  /**
   * Origin of Sierra's internal API, which reports achievement milestones.
   * It takes the same internal token as the backend. Without it the awards
   * feed is not read and milestones pay nothing.
   */
  readonly sierraUrl: string | undefined;
  /** The bucket snapshots are copied to. Without it they stay on this machine only. */
  readonly offsite: BucketConfig | undefined;
  /** The `BACKUP_S3_*` variables that are set, when some but not all of them are. */
  readonly offsitePartlySet: readonly string[];
}

const OFFSITE_VARIABLES = [
  "BACKUP_S3_ENDPOINT",
  "BACKUP_S3_BUCKET",
  "BACKUP_S3_ACCESS_KEY_ID",
  "BACKUP_S3_SECRET_ACCESS_KEY",
] as const;

/** Reads the configuration from environment variables, falling back to what local development needs. */
export function readConfig(env: Record<string, string | undefined>): Config {
  const port = Number(env["PORT"] ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT is not a port number: ${env["PORT"]}`);
  }
  const databasePath = env["DATABASE_PATH"] || "data/leaf.db";
  const [endpoint, bucket, accessKeyId, secretAccessKey] = OFFSITE_VARIABLES.map((name) => env[name] || undefined);
  const offsite =
    endpoint !== undefined && bucket !== undefined && accessKeyId !== undefined && secretAccessKey !== undefined
      ? { endpoint, bucket, accessKeyId, secretAccessKey }
      : undefined;
  const set = OFFSITE_VARIABLES.filter((name) => Boolean(env[name]));
  return {
    port,
    databasePath,
    backupDirectory: env["BACKUP_DIR"] || join(dirname(databasePath), "backups"),
    backendUrl: env["BACKEND_URL"] || "https://api.seqwawa.com",
    backendToken: env["BACKEND_INTERNAL_TOKEN"] || undefined,
    sierraUrl: env["SIERRA_URL"] || undefined,
    offsite,
    offsitePartlySet: offsite === undefined ? set : [],
  };
}
