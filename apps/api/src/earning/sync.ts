import { type Activity, draftEntry, type EarningRules, leaf, leafForActivity, type PlayerId } from "@sequoia-leaf/core";

import { entryInsert } from "../ledger/store.ts";

/** Returns what players did during [from, to), in milliseconds since the Unix epoch. */
export type CreditSource = (from: number, to: number) => Promise<readonly Activity[]>;

/**
 * - `recent` reads from a little before where the last run stopped. It runs every minute.
 * - `deep` re-reads the last week, to pick up credits that appeared late: a
 *   name that resolved to a player afterwards, or a war scored afterwards.
 */
export type SyncMode = "recent" | "deep";

export type SyncResult =
  /** Another run holds the lease. */
  | { readonly status: "busy" }
  /** First run ever: recorded the starting moment. Nothing before it is credited. */
  | { readonly status: "started" }
  | {
      readonly status: "synced";
      /** Activities recorded by this run. */
      readonly recorded: number;
      readonly leafPaid: number;
      /** False when the run stopped at the per-run player limit; the next run continues. */
      readonly complete: boolean;
    };

/** Events younger than this are left for the next run: the backend merges duplicate raid reports within seconds. */
export const SETTLE_MS = 30_000;
/** How far before the cursor a recent run starts, to catch events recorded slightly out of order. */
export const RECENT_OVERLAP_MS = 20 * 60_000;
export const DEEP_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
/** A run that dies holds the lease for at most this long. */
const LEASE_MS = 60_000;
/**
 * Each player costs one database round trip, and a Worker invocation on the
 * free plan may make 50. A run handles this many players and leaves the rest
 * to the next.
 */
export const MAX_PLAYERS_PER_RUN = 20;

export interface SyncOptions {
  readonly mode: SyncMode;
  readonly maxPlayers?: number;
}

/**
 * Records new activities from the source and pays the Leaf they earn. Each
 * player's activities and Leaf are written in one batch, so an activity is
 * never recorded without its Leaf or paid twice. Running it again over the
 * same window changes nothing.
 */
export async function syncCredits(
  db: D1Database,
  source: CreditSource,
  rules: EarningRules,
  now: number,
  options: SyncOptions,
): Promise<SyncResult> {
  const lease = await db
    .prepare("UPDATE sync_state SET locked_until = ? WHERE name = 'credits' AND locked_until <= ?")
    .bind(now + LEASE_MS, now)
    .run();
  if (lease.meta.changes === 0) {
    return { status: "busy" };
  }
  try {
    return await runSync(db, source, rules, now, options);
  } catch (error) {
    await db.prepare("UPDATE sync_state SET locked_until = 0 WHERE name = 'credits'").run();
    throw error;
  }
}

async function runSync(
  db: D1Database,
  source: CreditSource,
  rules: EarningRules,
  now: number,
  options: SyncOptions,
): Promise<SyncResult> {
  const state = await db
    .prepare("SELECT started_at, cursor FROM sync_state WHERE name = 'credits'")
    .first<{ started_at: number | null; cursor: number | null }>();
  if (state === null || state.started_at === null || state.cursor === null) {
    await db
      .prepare("UPDATE sync_state SET started_at = ?, cursor = ?, locked_until = 0 WHERE name = 'credits'")
      .bind(now, now)
      .run();
    return { status: "started" };
  }
  const to = now - SETTLE_MS;

  const reach = options.mode === "recent" ? state.cursor - RECENT_OVERLAP_MS : to - DEEP_LOOKBACK_MS;
  const from = Math.max(state.started_at, reach);
  const activities = from < to ? await newActivities(db, await source(from, to), from, to) : [];

  const byPlayer = new Map<PlayerId, Activity[]>();
  for (const activity of activities) {
    const mine = byPlayer.get(activity.playerId);
    if (mine === undefined) {
      byPlayer.set(activity.playerId, [activity]);
    } else {
      mine.push(activity);
    }
  }
  const players = [...byPlayer.values()];
  const handled = players.slice(0, options.maxPlayers ?? MAX_PLAYERS_PER_RUN);
  const deferred = players.slice(handled.length).flat();

  let leafPaid = 0;
  const batches = handled.map((mine) => {
    const statements: D1PreparedStatement[] = [];
    for (const activity of mine) {
      statements.push(activityInsert(db, activity, now));
      const amount = leafForActivity(activity, rules);
      if (amount > 0) {
        const draft = draftEntry({
          kind: "earn",
          playerId: activity.playerId,
          amount: leaf(amount),
          source: activity.kind,
          idempotencyKey: activity.sourceKey,
        });
        statements.push(entryInsert(db, draft, now));
        leafPaid += amount;
      }
    }
    return db.batch(statements);
  });
  // One batch per player: a player's activities and Leaf commit together or not at all.
  await Promise.all(batches);
  const recorded = handled.reduce((count, mine) => count + mine.length, 0);

  // Everything before the first activity left for later has been processed.
  const processedThrough = deferred.reduce((earliest, activity) => Math.min(earliest, activity.occurredAt), to);
  await db
    .prepare("UPDATE sync_state SET cursor = MAX(cursor, ?), locked_until = 0 WHERE name = 'credits'")
    .bind(options.mode === "recent" ? processedThrough : state.cursor)
    .run();
  return { status: "synced", recorded, leafPaid, complete: deferred.length === 0 };
}

/**
 * The activities in [from, to) that are not recorded yet, oldest first, each
 * source key once. One query reads the keys already recorded for the window,
 * however many activities the feed lists.
 */
async function newActivities(
  db: D1Database,
  activities: readonly Activity[],
  from: number,
  to: number,
): Promise<Activity[]> {
  const { results } = await db
    .prepare("SELECT source_key FROM activities WHERE occurred_at >= ? AND occurred_at < ?")
    .bind(from, to)
    .all<{ source_key: string }>();
  const recorded = new Set(results.map((row) => row.source_key));
  const unique = new Map<string, Activity>();
  for (const activity of activities) {
    const inWindow = activity.occurredAt >= from && activity.occurredAt < to;
    if (inWindow && !recorded.has(activity.sourceKey)) {
      unique.set(activity.sourceKey, activity);
    }
  }
  return [...unique.values()].toSorted((a, b) => a.occurredAt - b.occurredAt || a.sourceKey.localeCompare(b.sourceKey));
}

function activityInsert(db: D1Database, activity: Activity, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO activities
         (source_key, player_id, kind, raid, detail, season_rating, war_points, occurred_at, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      activity.sourceKey,
      activity.playerId,
      activity.kind,
      activity.kind === "raid" ? (activity.raid ?? null) : null,
      activity.kind === "raid" ? activity.raidName : activity.territory,
      activity.seasonRating,
      activity.kind === "war" ? activity.warPoints : null,
      activity.occurredAt,
      now,
    );
}
