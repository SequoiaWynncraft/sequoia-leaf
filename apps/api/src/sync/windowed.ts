import type { Database } from "bun:sqlite";

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

/**
 * Runs one feed's sync: takes the feed's lease in `sync_state`, works out the
 * window the mode calls for, reads it, and hands what it read to `write`,
 * which runs in one transaction with the cursor's move. The first run ever
 * only records its moment, so nothing that happened before it is ever paid.
 *
 * `write` must record each thing once however often a window is read again:
 * windows overlap on purpose.
 */
export async function windowedSync<T>(
  db: Database,
  name: string,
  now: number,
  mode: SyncMode,
  read: (from: number, to: number) => Promise<readonly T[]>,
  write: (items: readonly T[], from: number, to: number) => { recorded: number; leafPaid: number },
): Promise<SyncResult> {
  // The scheduled run and a player's request can overlap while one of them
  // waits for the feed; the lease lets only one of them through.
  const lease = db
    .query("UPDATE sync_state SET locked_until = ? WHERE name = ? AND locked_until <= ?")
    .run(now + LEASE_MS, name, now);
  if (lease.changes === 0) {
    return { status: "busy" };
  }
  try {
    const state = db
      .query<{ started_at: number | null; cursor: number | null }, [string]>(
        "SELECT started_at, cursor FROM sync_state WHERE name = ?",
      )
      .get(name);
    if (state === null || state.started_at === null || state.cursor === null) {
      db.query("UPDATE sync_state SET started_at = ?, cursor = ? WHERE name = ?").run(now, now, name);
      return { status: "started" };
    }
    const settled = now - SETTLE_MS;
    const reach = mode === "recent" ? state.cursor - RECENT_OVERLAP_MS : settled - DEEP_LOOKBACK_MS;
    const from = Math.max(state.started_at, reach);
    const to = Math.min(settled, from + MAX_WINDOW_MS);
    const items = from < to ? await read(from, to) : [];
    // Immediate, so the transaction holds the write lock from its start. A
    // deferred one reads first, and if another connection, such as a script
    // run by hand, commits before its first write, that write fails with
    // SQLITE_BUSY_SNAPSHOT instead of waiting its turn.
    return db
      .transaction((): SyncResult => {
        const { recorded, leafPaid } = write(items, from, to);
        if (mode === "recent") {
          db.query("UPDATE sync_state SET cursor = MAX(cursor, ?) WHERE name = ?").run(to, name);
        }
        return { status: "synced", recorded, leafPaid };
      })
      .immediate();
  } finally {
    db.query("UPDATE sync_state SET locked_until = 0 WHERE name = ?").run(name);
  }
}
