import { dirname, join } from "node:path";

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
}

/** Reads the configuration from environment variables, falling back to what local development needs. */
export function readConfig(env: Record<string, string | undefined>): Config {
  const port = Number(env["PORT"] ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT is not a port number: ${env["PORT"]}`);
  }
  const databasePath = env["DATABASE_PATH"] || "data/leaf.db";
  return {
    port,
    databasePath,
    backupDirectory: env["BACKUP_DIR"] || join(dirname(databasePath), "backups"),
    backendUrl: env["BACKEND_URL"] || "https://api.seqwawa.com",
    backendToken: env["BACKEND_INTERNAL_TOKEN"] || undefined,
  };
}
