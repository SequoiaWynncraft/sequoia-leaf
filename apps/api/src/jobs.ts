import { DEFAULT_RULES } from "@sequoia-leaf/core";
import { Cause, Clock, Effect, Layer, Schedule } from "effect";

import { runAchievementSync } from "./achievements/run.ts";
import { bucketOffsite, offsiteCopier } from "./backup/offsite.ts";
import { snapshotIfDue } from "./backup/snapshot.ts";
import { AppConfig } from "./config.ts";
import { Db } from "./db.ts";
import { runCreditSync } from "./earning/run.ts";
import { payMissedLevels } from "./levels/pay.ts";
import type { SyncMode, SyncResult } from "./sync/windowed.ts";

/** The minute of each hour whose run re-reads the last week instead of the last few minutes. */
const DEEP_SYNC_MINUTE = 17;

/** Logs a failed step and carries on, so one step failing never stops the others or the next run. */
const step = <R>(name: string, effect: Effect.Effect<void, unknown, R>) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.logError(`${name} failed`, cause),
    ),
  );

/** A deep sync at minute 17 of each hour, a recent one every other minute. */
export function scheduledMode(now: number): SyncMode {
  return new Date(now).getUTCMinutes() === DEEP_SYNC_MINUTE ? "deep" : "recent";
}

/** One scheduled run of a feed's sync, in the mode the minute calls for. Logs what it did, or why it failed. */
export const scheduledSync = <E, R>(
  feed: "credit" | "achievement",
  run: (mode: SyncMode) => Effect.Effect<SyncResult | undefined, E, R>,
) =>
  Effect.gen(function* () {
    const mode = scheduledMode(yield* Clock.currentTimeMillis);
    yield* step(
      `The scheduled ${mode} ${feed} sync`,
      run(mode).pipe(
        Effect.flatMap((result) =>
          result === undefined
            ? Effect.void
            : Effect.logInfo(`${feed}_sync`).pipe(Effect.annotateLogs({ mode, ...result })),
        ),
      ),
    );
  });

/** Snapshots the database every six hours and copies the newest snapshot off the server, once each. */
const backups = Effect.gen(function* () {
  const config = yield* AppConfig;
  const db = yield* Db;
  const copyOffsite =
    config.offsite === undefined ? undefined : offsiteCopier(bucketOffsite(config.offsite), config.backupDirectory);
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    yield* step(
      "Taking a snapshot of the database",
      Effect.try(() => snapshotIfDue(db, config.backupDirectory, now)).pipe(
        Effect.flatMap((path) =>
          path === undefined ? Effect.void : Effect.logInfo("snapshot").pipe(Effect.annotateLogs({ path })),
        ),
      ),
    );
    if (copyOffsite !== undefined) {
      yield* step(
        "Copying a snapshot off the server (it is tried again in ten minutes)",
        Effect.tryPromise(() => copyOffsite(now)).pipe(
          Effect.flatMap((name) =>
            name === undefined
              ? Effect.void
              : Effect.logInfo("snapshot_copied_offsite").pipe(Effect.annotateLogs({ name })),
          ),
        ),
      );
    }
  });
});

/** Everything Leaf does at the start of each minute, one after the other, for as long as it runs. */
export const EveryMinute = Layer.effectDiscard(
  Effect.gen(function* () {
    const backup = yield* backups;
    yield* Effect.all(
      [scheduledSync("credit", runCreditSync), scheduledSync("achievement", runAchievementSync), backup],
      {
        discard: true,
      },
    ).pipe(Effect.repeat(Schedule.cron("* * * * *")), Effect.forkScoped);
  }),
);

/** Pays once at start the levels reached before levels paid Leaf, or left unpaid by a failed run, and says what runs. */
export const Startup = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const db = yield* Db;
    yield* step(
      "Paying for levels already reached (it is tried again at the next start)",
      Effect.gen(function* () {
        const missed = payMissedLevels(db, DEFAULT_RULES.levels, yield* Clock.currentTimeMillis);
        if (missed.leaf > 0) {
          yield* Effect.logInfo("missed_levels_paid").pipe(Effect.annotateLogs(missed));
        }
      }),
    );
    yield* Effect.logInfo("started").pipe(
      Effect.annotateLogs({
        port: config.port,
        database: config.databasePath,
        offsite_bucket: config.offsite?.bucket ?? null,
        awards_feed: config.sierraUrl ?? null,
      }),
    );
    if (config.backendToken === undefined) {
      yield* Effect.logWarning("BACKEND_INTERNAL_TOKEN is not set: serving requests, but not reading the credit feed");
    }
    if (config.offsitePartlySet.length > 0) {
      yield* Effect.logWarning(
        `Only ${config.offsitePartlySet.join(", ")} of the BACKUP_S3_* variables are set: snapshots stay on this machine`,
      );
    }
  }),
);
