import type { Database } from "bun:sqlite";

import {
  type Activity,
  applyActivityToQuests,
  draftEntry,
  leaf,
  leafForActivity,
  levelForXp,
  openQuestBook,
  type PlayerId,
  type Quest,
  type Rules,
} from "@sequoia-leaf/core";

import { insertEvent } from "../events/store.ts";
import { getAccount, insertEntry } from "../ledger/store.ts";
import { payLevels } from "../levels/pay.ts";
import { questJson } from "../quests/json.ts";
import { loadQuestBook, saveQuestStep } from "../quests/store.ts";
import { type SyncMode, type SyncResult, windowedSync } from "../sync/windowed.ts";

/** Returns what players did during [from, to), in milliseconds since the Unix epoch. */
export type CreditSource = (from: number, to: number) => Promise<readonly Activity[]>;

export { DEEP_LOOKBACK_MS, RECENT_OVERLAP_MS, SETTLE_MS, type SyncMode, type SyncResult } from "../sync/windowed.ts";

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
  return windowedSync(db, "credits", now, mode, source, (reported, from, to) => {
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
    return { recorded, leafPaid };
  });
}

/**
 * Records one player's new activities, oldest first, with what they earn, and
 * an event for each thing a client would want to show. Returns the Leaf paid.
 */
function recordPlayer(
  db: Database,
  playerId: PlayerId,
  activities: readonly Activity[],
  rules: Rules,
  now: number,
): number {
  let leafPaid = 0;
  const levelBefore = levelForXp(getAccount(db, playerId).xp, rules.levels).level;
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
      const entry = insertEntry(db, draft, now);
      leafPaid += amount;
      insertEvent(
        db,
        playerId,
        {
          type: "leaf_earned",
          data: {
            source: activity.kind,
            leaf: entry.balanceDelta,
            xp: entry.xpDelta,
            detail: activity.kind === "raid" ? activity.raidName : activity.territory,
            occurred_at: new Date(activity.occurredAt).toISOString(),
            ...(activity.kind === "war" && activity.inClaim !== undefined ? { in_claim: activity.inClaim } : {}),
          },
        },
        now,
      );
    }
    const step = applyActivityToQuests(book, activity, rules.quests);
    book = step.book;
    for (const quest of step.written) {
      written.set(`${quest.slot}:${quest.sequence}`, quest);
    }
    completed.push(...step.completed);
    for (const quest of step.completed) {
      leafPaid += quest.reward.leaf;
      insertEvent(db, playerId, { type: "quest_completed", data: { quest: questJson(quest) } }, now);
    }
  }
  saveQuestStep(db, playerId, { book, written: [...written.values()], completed }, now);
  const levelAfter = levelForXp(getAccount(db, playerId).xp, rules.levels).level;
  if (levelAfter > levelBefore) {
    const levelLeaf = payLevels(db, playerId, rules.levels, now);
    leafPaid += levelLeaf;
    insertEvent(db, playerId, { type: "level_up", data: { level: levelAfter, leaf: levelLeaf } }, now);
  }
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
       (source_key, player_id, kind, raid, detail, season_rating, war_points, in_claim, occurred_at, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    activity.sourceKey,
    activity.playerId,
    activity.kind,
    activity.kind === "raid" ? (activity.raid ?? null) : null,
    activity.kind === "raid" ? activity.raidName : activity.territory,
    activity.seasonRating,
    activity.kind === "war" ? activity.warPoints : null,
    activity.kind === "war" && activity.inClaim !== undefined ? Number(activity.inClaim) : null,
    activity.occurredAt,
    now,
  );
}
