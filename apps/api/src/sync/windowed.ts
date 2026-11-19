import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/**
 * - `recent` reads from a little before where the last run stopped. It runs every minute.
 * - `deep` re-reads the last week, to pick up what appeared late: a name that
 *   resolved to a player afterwards, or a war scored afterwards.
 */
export type SyncMode = "recent" | "deep";

export type SyncResult =
  /** Another run holds the lease. */
  | { readonly status: "busy" }
  /** First run ever: recorded the starting moment. Nothing before it is paid. */
  | { readonly status: "started" }
  | {
      readonly status: "synced";
      /** Things recorded by this run. */
      readonly recorded: number;
      readonly leafPaid: number;
    };

/** Events younger than this are left for the next run: the backend merges duplicate raid reports within seconds. */
export const SETTLE_MS = 30_000;
/** How far before the cursor a recent run starts, to catch events recorded slightly out of order. */
export const RECENT_OVERLAP_MS = 20 * 60_000;
export const DEEP_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
/**
 * The longest window one run reads. The backend's and Sierra's feeds refuse windows
 * over 31 days, so after a longer outage the recent sync catches up a window per
 * run instead of asking for one the feeds refuse, for good.
 */
export const MAX_WINDOW_MS = 30 * 24 * 60 * 60_000;
/** A run that dies holds the lease for at most this long. */
const LEASE_MS = 60_000;

const SyncState = Schema.Struct({ startedAt: Schema.NullOr(Schema.Int), cursor: Schema.NullOr(Schema.Int) });

/**
 * Runs one feed's sync: takes the feed's lease in `sync_state`, works out the
 * window the mode calls for, reads it, and hands what it read to `write`,
 * which runs in one transaction with the cursor's move. The first run ever
 * only records its moment, so nothing that happened before it is ever paid.
 *
 * `write` must record each thing once however often a window is read again:
 * windows overlap on purpose.
 */
export const windowedSync = <T, E, R, RW>(
  name: string,
  now: number,
  mode: SyncMode,
  read: (from: number, to: number) => Effect.Effect<readonly T[], E, R>,
  write: (
    items: readonly T[],
    from: number,
    to: number,
  ) => Effect.Effect<{ readonly recorded: number; readonly leafPaid: number }, never, RW>,
): Effect.Effect<SyncResult, E, R | RW | SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const state = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: SyncState,
      execute: (feed) => sql`SELECT started_at AS startedAt, cursor FROM sync_state WHERE name = ${feed}`,
    });
    // The scheduled run and a player's request can overlap while one of them
    // waits for the feed; the lease lets only one of them through.
    const lease = yield* sql`
      UPDATE sync_state SET locked_until = ${now + LEASE_MS}
      WHERE name = ${name} AND locked_until <= ${now}
      RETURNING name
    `.pipe(Effect.orDie);
    if (lease.length === 0) {
      return { status: "busy" } satisfies SyncResult;
    }
    const release = sql`UPDATE sync_state SET locked_until = 0 WHERE name = ${name}`.pipe(Effect.orDie);
    return yield* Effect.gen(function* () {
      const { startedAt, cursor } = Option.getOrElse(yield* state(name).pipe(Effect.orDie), () => ({
        startedAt: null,
        cursor: null,
      }));
      if (startedAt === null || cursor === null) {
        yield* sql`UPDATE sync_state SET started_at = ${now}, cursor = ${now} WHERE name = ${name}`.pipe(Effect.orDie);
        return { status: "started" } satisfies SyncResult;
      }
      const settled = now - SETTLE_MS;
      const reach = mode === "recent" ? cursor - RECENT_OVERLAP_MS : settled - DEEP_LOOKBACK_MS;
      const from = Math.max(startedAt, reach);
      const to = Math.min(settled, from + MAX_WINDOW_MS);
      const items = from < to ? yield* read(from, to) : [];
      // The client opens transactions with BEGIN IMMEDIATE, so the write lock is
      // held from the start. A deferred one reads first, and if another
      // connection, such as a script run by hand, commits before its first
      // write, that write fails with SQLITE_BUSY_SNAPSHOT instead of waiting.
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const { recorded, leafPaid } = yield* write(items, from, to);
            if (mode === "recent") {
              yield* sql`UPDATE sync_state SET cursor = MAX(cursor, ${to}) WHERE name = ${name}`;
            }
            return { status: "synced", recorded, leafPaid } satisfies SyncResult;
          }),
        )
        .pipe(Effect.orDie);
    }).pipe(Effect.ensuring(release));
  });
