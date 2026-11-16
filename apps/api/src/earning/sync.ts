import type { Database } from "bun:sqlite";

import {
  type Activity,
  applyActivityToQuests,
  draftEntry,
  leaf,
  leafForActivity,
  openQuestBook,
  type PlayerId,
  type Quest,
  type Rules,
} from "@sequoia-leaf/core";

import { insertEntry } from "../ledger/store.ts";
import { loadQuestBook, saveQuestStep } from "../quests/store.ts";

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
    };

/** Events younger than this are left for the next run: the backend merges duplicate raid reports within seconds. */
export const SETTLE_MS = 30_000;
/** How far before the cursor a recent run starts, to catch events recorded slightly out of order. */
export const RECENT_OVERLAP_MS = 20 * 60_000;
export const DEEP_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
/** A run that dies holds the lease for at most this long. */
const LEASE_MS = 60_000;

/**
 * Records new activities from the source, pays the Leaf they earn, and moves
 * the players' quests forward. A run writes everything in one transaction, so
 * an activity is never recorded without its Leaf and quest progress, and
 * nothing is paid twice. Running it again over the same window changes
 * nothing.
 */
export async function syncCredits(
  db: Database,
  source: CreditSource,
  rules: Rules,
  now: number,
  mode: SyncMode,
): Promise<SyncResult> {
  // The scheduled run and a player's request can overlap while one of them
  // waits for the backend; the lease lets only one of them through.
  const lease = db
    .query("UPDATE sync_state SET locked_until = ? WHERE name = 'credits' AND locked_until <= ?")
    .run(now + LEASE_MS, now);
  if (lease.changes === 0) {
    return { status: "busy" };
  }
  try {
    return await runSync(db, source, rules, now, mode);
  } finally {
    db.run("UPDATE sync_state SET locked_until = 0 WHERE name = 'credits'");
  }
}

async function runSync(
  db: Database,
  source: CreditSource,
  rules: Rules,
  now: number,
  mode: SyncMode,
): Promise<SyncResult> {
  const state = db
    .query<{ started_at: number | null; cursor: number | null }, []>(
      "SELECT started_at, cursor FROM sync_state WHERE name = 'credits'",
    )
    .get();
  if (state === null || state.started_at === null || state.cursor === null) {
    db.query("UPDATE sync_state SET started_at = ?, cursor = ? WHERE name = 'credits'").run(now, now);
    return { status: "started" };
  }
  const to = now - SETTLE_MS;
  const reach = mode === "recent" ? state.cursor - RECENT_OVERLAP_MS : to - DEEP_LOOKBACK_MS;
  const from = Math.max(state.started_at, reach);
  const reported = from < to ? await source(from, to) : [];

  return db.transaction((): SyncResult => {
    const byPlayer = new Map<PlayerId, Activity[]>();
    for (const activity of newActivities(db, reported, from, to)) {
      const mine = byPlayer.get(activity.playerId);
      if (mine === undefined) {
        byPlayer.set(activity.playerId, [activity]);
      } else {
        mine.push(activity);
      }
    }
    let recorded = 0;
    let leafPaid = 0;
    for (const [playerId, mine] of byPlayer) {
      leafPaid += recordPlayer(db, playerId, mine, rules, now);
      recorded += mine.length;
    }
    if (mode === "recent") {
      db.query("UPDATE sync_state SET cursor = MAX(cursor, ?) WHERE name = 'credits'").run(to);
    }
    return { status: "synced", recorded, leafPaid };
  })();
}

/** Records one player's new activities, oldest first, with what they earn. Returns the Leaf paid. */
function recordPlayer(
  db: Database,
  playerId: PlayerId,
  activities: readonly Activity[],
  rules: Rules,
  now: number,
): number {
  let leafPaid = 0;
  let book = loadQuestBook(db, playerId) ?? openQuestBook(activities[0]?.occurredAt ?? now);
  const written = new Map<string, Quest>();
  const completed: Quest[] = [];
  for (const activity of activities) {
    insertActivity(db, activity, now);
    const amount = leafForActivity(activity, rules.earning);
    if (amount > 0) {
      const draft = draftEntry({
        kind: "earn",
        playerId,
        amount: leaf(amount),
        source: activity.kind,
        idempotencyKey: activity.sourceKey,
      });
      insertEntry(db, draft, now);
      leafPaid += amount;
    }
    const step = applyActivityToQuests(book, activity, rules.quests);
    book = step.book;
    for (const quest of step.written) {
      written.set(`${quest.slot}:${quest.sequence}`, quest);
    }
    completed.push(...step.completed);
  }
  for (const quest of completed) {
    leafPaid += quest.reward.leaf;
  }
  saveQuestStep(db, playerId, { book, written: [...written.values()], completed }, now);
  return leafPaid;
}

/** The activities in [from, to) that are not recorded yet, oldest first, each source key once. */
function newActivities(db: Database, activities: readonly Activity[], from: number, to: number): Activity[] {
  const recorded = new Set(
    db
      .query<{ source_key: string }, [number, number]>(
        "SELECT source_key FROM activities WHERE occurred_at >= ? AND occurred_at < ?",
      )
      .all(from, to)
      .map((row) => row.source_key),
  );
  const unique = new Map<string, Activity>();
  for (const activity of activities) {
    const inWindow = activity.occurredAt >= from && activity.occurredAt < to;
    if (inWindow && !recorded.has(activity.sourceKey)) {
      unique.set(activity.sourceKey, activity);
    }
  }
  return [...unique.values()].toSorted((a, b) => a.occurredAt - b.occurredAt || a.sourceKey.localeCompare(b.sourceKey));
}

function insertActivity(db: Database, activity: Activity, now: number): void {
  db.query(
    `INSERT INTO activities
       (source_key, player_id, kind, raid, detail, season_rating, war_points, occurred_at, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
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
