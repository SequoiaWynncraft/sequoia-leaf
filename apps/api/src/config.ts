import { dirname, join } from "node:path";

import { Config, Context, Layer, Option, type Redacted } from "effect";

import type { BucketConfig } from "./backup/offsite.ts";

export interface Settings {
  readonly port: number;
  /** The SQLite file. In production it is on a volume that survives deploys. */
  readonly databasePath: string;
  /** Where snapshots of the database are written. */
  readonly backupDirectory: string;
  /** Origin of sequoia-backend, which reports raids and wars and checks sessions. */
  readonly backendUrl: string;
  /** sequoia-backend's `APP_INTERNAL_API_TOKEN`. Without it the credit feed is not read. */
  readonly backendToken: Redacted.Redacted | undefined;
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

/** A variable that may be left out. One set to the empty string counts as left out. */
const optional = <A>(config: Config.Config<A>) => config.pipe(Config.option, Config.map(Option.getOrUndefined));

/**
 * Leaf's settings, from environment variables, falling back to what local
 * development needs. A variable that is set but invalid, such as a `PORT` that
 * is not a port, stops the app at start.
 */
export const settings: Config.Config<Settings> = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(3000)),
  databasePath: Config.String("DATABASE_PATH").pipe(Config.withDefault("data/leaf.db")),
  backupDirectory: optional(Config.String("BACKUP_DIR")),
  backendUrl: Config.String("BACKEND_URL").pipe(Config.withDefault("https://api.seqwawa.com")),
  backendToken: optional(Config.Redacted("BACKEND_INTERNAL_TOKEN")),
  sierraUrl: optional(Config.String("SIERRA_URL")),
  endpoint: optional(Config.String("BACKUP_S3_ENDPOINT")),
  bucket: optional(Config.String("BACKUP_S3_BUCKET")),
  accessKeyId: optional(Config.String("BACKUP_S3_ACCESS_KEY_ID")),
  secretAccessKey: optional(Config.Redacted("BACKUP_S3_SECRET_ACCESS_KEY")),
}).pipe(
  Config.map((read): Settings => {
    const { databasePath, endpoint, bucket, accessKeyId, secretAccessKey } = read;
    const offsite =
      endpoint !== undefined && bucket !== undefined && accessKeyId !== undefined && secretAccessKey !== undefined
        ? { endpoint, bucket, accessKeyId, secretAccessKey }
        : undefined;
    const set = Object.entries({
      BACKUP_S3_ENDPOINT: endpoint,
      BACKUP_S3_BUCKET: bucket,
      BACKUP_S3_ACCESS_KEY_ID: accessKeyId,
      BACKUP_S3_SECRET_ACCESS_KEY: secretAccessKey,
    }).flatMap(([name, value]) => (value === undefined ? [] : [name]));
    return {
      port: read.port,
      databasePath,
      backupDirectory: read.backupDirectory ?? join(dirname(databasePath), "backups"),
      backendUrl: read.backendUrl,
      backendToken: read.backendToken,
      sierraUrl: read.sierraUrl,
      offsite,
      offsitePartlySet: offsite === undefined ? set : [],
    };
  }),
);

/** The settings the app runs with. */
export class AppConfig extends Context.Service<AppConfig, Settings>()("leaf/AppConfig") {
  /** Read from the environment as the app starts. */
  static readonly layer = Layer.effect(AppConfig, settings);
}
