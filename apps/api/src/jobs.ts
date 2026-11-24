import { DEFAULT_RULES, RULE_CHANGES } from "@sequoia-leaf/core";
import { Cause, Clock, type Duration, Effect, Layer, Match, Option, Ref, Schedule } from "effect";

import { runAchievementSync } from "./achievements/run.ts";
import { Visits } from "./activity/visits.ts";
import { announce } from "./announce/publish.ts";
import { rateCard } from "./announce/rate-card.ts";
import { copiedLast, type CopyFailed, copyNewest, Offsite, RETRY } from "./backup/offsite.ts";
import { snapshotIfDue, snapshotsIn } from "./backup/snapshot.ts";
import { AppConfig } from "./config.ts";
import { runCreditSync } from "./earning/run.ts";
import { payMissedLevels } from "./levels/pay.ts";
import { type JobRun, jobRun, jobSucceededAt } from "./metrics.ts";
import { GAMES } from "./play/games.ts";
import { Play } from "./play/service.ts";
import type { SyncMode, SyncResult } from "./sync/windowed.ts";

/** The minute of each hour whose run re-reads the last week instead of the last few minutes. */
const DEEP_SYNC_MINUTE = 17;

/**
 * Runs one of the scheduled jobs, `job` in the metrics, and counts the run (`jobRun`); logs a failure
 * and carries on, so one job failing never stops the others or its own next run.
 */
const step = <R>(job: string, what: string, effect: Effect.Effect<JobRun, unknown, R>) =>
  effect.pipe(
    Effect.flatMap((run) => jobRun(job, run)),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.logError(`${what} failed`, cause).pipe(Effect.andThen(jobRun(job, "failed"))),
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
      `${feed}_sync`,
      `The scheduled ${mode} ${feed} sync`,
      run(mode).pipe(
        Effect.flatMap((result) =>
          result === undefined
            ? Effect.succeed<JobRun>("idle")
            : Effect.as(Effect.logInfo(`${feed}_sync`).pipe(Effect.annotateLogs({ mode, ...result })), "done" as const),
        ),
      ),
    );
  });

/** Snapshots the database every six hours. A run is one that took one; it last succeeded when the newest was taken. */
const snapshots = Effect.gen(function* () {
  const { backupDirectory } = yield* AppConfig;
  // Unreadable, the directory is said so by the first run.
  const newest = (yield* Effect.orElseSucceed(snapshotsIn(backupDirectory), () => [])).at(-1);
  if (newest !== undefined) yield* jobSucceededAt("snapshot", newest.takenAt);
  return step(
    "snapshot",
    "Taking a snapshot of the database",
    Effect.gen(function* () {
      const path = yield* snapshotIfDue(backupDirectory, yield* Clock.currentTimeMillis);
      if (path === undefined) return "idle";
      yield* Effect.logInfo("snapshot").pipe(Effect.annotateLogs({ path }));
      return "done";
    }),
  );
});

/**
 * Copies the newest snapshot off the server (`Offsite`), each minute, on one fiber. A failed attempt
 * (the snapshots unreadable, the bucket not taking one, or the record of it not kept) is logged
 * with why and when a copy last succeeded, and counted; the whole attempt is made again after
 * `RETRY`, and the minutes wait meanwhile, so no two copies ever run at once. As Leaf starts, the
 * copy last succeeded when the snapshot copied last was taken.
 */
export const OffsiteCopies = Layer.effectDiscard(
  Effect.gen(function* () {
    const { backupDirectory } = yield* AppConfig;
    // Unreadable, the record is said so by the first attempt.
    const copied = yield* Effect.orElseSucceed(copiedLast(backupDirectory), () => Option.none());
    if (Option.isSome(copied)) yield* jobSucceededAt("snapshot_offsite", copied.value.takenAt);
    const lastSuccess = yield* Ref.make(Option.map(copied, (snapshot) => snapshot.takenAt));
    // The snapshot the bucket last took, so that one whose record failed is only recorded next time.
    const taken = yield* Ref.make(Option.none<string>());
    const failed = (error: CopyFailed) =>
      Effect.gen(function* () {
        const last = yield* Ref.get(lastSuccess);
        yield* Effect.logError(
          "Copying a snapshot off the server failed (it is tried again in ten minutes)",
          error,
        ).pipe(
          Effect.annotateLogs({
            reason: Match.valueTags(error, {
              SnapshotsUnreadable: () => "snapshots_unreadable",
              UploadFailed: () => "upload_failed",
              MarkerFailed: ({ doing }) => (doing === "reading" ? "record_not_read" : "record_not_written"),
            }),
            last_copied_at: Option.getOrNull(Option.map(last, (at) => new Date(at).toISOString())),
          }),
        );
        yield* jobRun("snapshot_offsite", "failed");
      });
    yield* everyMinute(
      step(
        "snapshot_offsite",
        "Copying a snapshot off the server",
        copyNewest(backupDirectory, taken).pipe(
          Effect.tapError(failed),
          Effect.retry(RETRY),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed<JobRun>("idle"),
              onSome: ({ snapshot, now }) =>
                Effect.gen(function* () {
                  if (now) {
                    yield* Ref.set(lastSuccess, Option.some(yield* Clock.currentTimeMillis));
                    yield* Effect.logInfo("snapshot_copied_offsite").pipe(Effect.annotateLogs({ name: snapshot.name }));
                    return "done" as const;
                  }
                  // Copied before: Leaf that could not read its record as it started says now when.
                  if (Option.isNone(yield* Ref.get(lastSuccess))) {
                    yield* jobSucceededAt("snapshot_offsite", snapshot.takenAt);
                    yield* Ref.set(lastSuccess, Option.some(snapshot.takenAt));
                  }
                  return "idle" as const;
                }),
            }),
          ),
        ),
      ),
    );
  }),
);

/**
 * Closes the visits gone silent, so that what is kept of sessions and players is as of the minute,
 * and removes some of what has been kept 180 days (`Visits.removeOld`).
 */
const silentVisits = step(
  "silent_visits",
  "Closing silent visits",
  Effect.gen(function* () {
    const visits = yield* Visits;
    const now = yield* Clock.currentTimeMillis;
    yield* visits.closeSilent(now);
    yield* visits.removeOld(now);
    return "done" as const;
  }),
);

/**
 * Puts a tend in the line of the games' states that go on by themselves, where no page has kept them
 * up for a while (a yard whose owner is away), and waits for none of them.
 */
const tending = step(
  "tend_sweep",
  "Tending the games' states",
  Play.use((play) => Effect.as(play.tend(Object.values(GAMES)), "done" as const)),
);

/**
 * Runs a job at the start of every minute on its own fiber, so a slow run of one never holds up
 * another: the first at once, or once `after` has passed.
 */
const everyMinute = <R>(job: Effect.Effect<void, never, R>, after: Duration.Input = 0) =>
  Effect.sleep(after).pipe(Effect.andThen(job.pipe(Effect.repeat(Schedule.cron("* * * * *")))), Effect.forkScoped);

/**
 * What Leaf does every minute, for as long as it runs: the two feed syncs,
 * snapshots and offsite copies, closing silent visits, and from its second minute tending the
 * games' states, each on its own. An offsite copy can take minutes; the syncs, the deep sync at minute 17, and snapshots carry
 * on meanwhile.
 */
export const EveryMinute = Layer.merge(
  Layer.effectDiscard(
    Effect.gen(function* () {
      yield* everyMinute(scheduledSync("credit", runCreditSync));
      yield* everyMinute(scheduledSync("achievement", runAchievementSync));
      yield* everyMinute(yield* snapshots);
      yield* everyMinute(silentVisits);
      // A minute after Leaf starts: one starting beside one stopping, as in a deploy, does not tend against it.
      yield* everyMinute(tending, "1 minute");
    }),
  ),
  // Offsite copies while a bucket is set.
  Layer.unwrap(
    AppConfig.useSync(({ offsite }) =>
      offsite === undefined ? Layer.empty : OffsiteCopies.pipe(Layer.provide(Offsite.bucket(offsite))),
    ),
  ),
);

/**
 * Brings the rate card in Discord up to the rules this Leaf runs with. Rules
 * change only with a deploy, so once at start is enough.
 */
const rateCardUpdate = Effect.gen(function* () {
  const { ratesWebhook } = yield* AppConfig;
  if (ratesWebhook === undefined) {
    return "idle";
  }
  const card = rateCard(DEFAULT_RULES, RULE_CHANGES);
  const result = yield* announce("rates", ratesWebhook, card, yield* Clock.currentTimeMillis);
  yield* Effect.logInfo("rate_card").pipe(Effect.annotateLogs({ result }));
  return "done";
});

/**
 * Pays at start the levels reached and not paid for (`payMissedLevels`: those reached before levels
 * paid Leaf, or with new level rules, or by an entry that did not pay them), and says what runs.
 */
export const Startup = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    yield* step(
      "missed_levels",
      "Paying for levels already reached (it is tried again at the next start)",
      Effect.gen(function* () {
        const missed = yield* payMissedLevels(DEFAULT_RULES.levels, yield* Clock.currentTimeMillis);
        if (missed.leaf > 0) {
          yield* Effect.logInfo("missed_levels_paid").pipe(Effect.annotateLogs(missed));
        }
        return "done" as const;
      }),
    );
    yield* step("rate_card", "Updating the rate card in Discord (it is tried again at the next start)", rateCardUpdate);
    yield* Effect.logInfo("started").pipe(
      Effect.annotateLogs({
        port: config.port,
        metrics: `${config.metrics.hostname}:${config.metrics.port}`,
        database: config.databasePath,
        offsite_bucket: config.offsite?.bucket ?? null,
        awards_feed: config.sierraUrl ?? null,
        rate_card: config.ratesWebhook !== undefined,
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
