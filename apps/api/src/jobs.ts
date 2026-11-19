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
      Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logError(`${name} failed`, cause),
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

/** Snapshots the database every six hours. */
const snapshots = Effect.gen(function* () {
  const { backupDirectory } = yield* AppConfig;
  const db = yield* Db;
  return step(
    "Taking a snapshot of the database",
    Effect.gen(function* () {
      const path = snapshotIfDue(db, backupDirectory, yield* Clock.currentTimeMillis);
      if (path !== undefined) {
        yield* Effect.logInfo("snapshot").pipe(Effect.annotateLogs({ path }));
      }
    }),
  );
});

/** Copies the newest snapshot off the server once, when a bucket is configured. */
const offsiteCopies = Effect.gen(function* () {
  const { offsite, backupDirectory } = yield* AppConfig;
  if (offsite === undefined) {
    return Effect.void;
  }
  const copyOffsite = offsiteCopier(bucketOffsite(offsite), backupDirectory);
  return step(
    "Copying a snapshot off the server (it is tried again in ten minutes)",
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const name = yield* Effect.tryPromise(() => copyOffsite(now));
      if (name !== undefined) {
        yield* Effect.logInfo("snapshot_copied_offsite").pipe(Effect.annotateLogs({ name }));
      }
    }),
  );
});

/** Runs a job at the start of every minute on its own fiber, so a slow run of one never holds up another. */
const everyMinute = <R>(job: Effect.Effect<void, never, R>) =>
  job.pipe(Effect.repeat(Schedule.cron("* * * * *")), Effect.forkScoped);

/**
 * What Leaf does every minute, for as long as it runs: the two feed syncs,
 * snapshots and offsite copies, each on its own. An offsite copy can take
 * minutes; the syncs, the deep sync at minute 17, and snapshots carry on meanwhile.
 */
export const EveryMinute = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* everyMinute(scheduledSync("credit", runCreditSync));
    yield* everyMinute(scheduledSync("achievement", runAchievementSync));
    yield* everyMinute(yield* snapshots);
    yield* everyMinute(yield* offsiteCopies);
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
