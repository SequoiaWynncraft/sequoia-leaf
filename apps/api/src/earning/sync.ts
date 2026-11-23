import {
  type Activity,
  applyActivityToQuests,
  draftEntry,
  leaf,
  leafForActivity,
  openQuestBook,
  type PlayerId,
  type Quest,
  type QuestSlot,
  type Rules,
} from "@sequoia-leaf/core";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { Events } from "../events/store.ts";
import { Ledger } from "../ledger/store.ts";
import { levelOf, levelUp } from "../levels/pay.ts";
import { questJson } from "../quests/json.ts";
import { Quests } from "../quests/store.ts";
import { type SyncMode, windowedSync } from "../sync/windowed.ts";

/** Reads what players did during [from, to), in milliseconds since the Unix epoch. */
export type CreditSource<E = never, R = never> = (from: number, to: number) => Effect.Effect<readonly Activity[], E, R>;

export { DEEP_LOOKBACK_MS, RECENT_OVERLAP_MS, SETTLE_MS, type SyncMode, type SyncResult } from "../sync/windowed.ts";

/**
 * Records new activities from the source, pays the Leaf they earn, and moves
 * the players' quests forward. A run writes everything in one transaction, so
 * an activity is never recorded without its Leaf and quest progress, and
 * nothing is paid twice. Running it again over the same window changes
 * nothing.
 */
export const syncCredits = <E, R>(source: CreditSource<E, R>, rules: Rules, now: number, mode: SyncMode) =>
  windowedSync("credits", now, mode, source, (reported, from, to) =>
    Effect.gen(function* () {
      const byPlayer = new Map<PlayerId, Activity[]>();
      for (const activity of yield* newActivities(reported, from, to)) {
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
        leafPaid += yield* recordPlayer(playerId, mine, rules, now);
        recorded += mine.length;
      }
      return { recorded, leafPaid };
    }),
  );

/**
 * Records one player's new activities, oldest first, with what they earn, and
 * an event for each thing a client would want to show. Returns the Leaf paid.
 */
const recordPlayer = Effect.fnUntraced(function* (
  playerId: PlayerId,
  activities: readonly Activity[],
  rules: Rules,
  now: number,
) {
  const ledger = yield* Ledger;
  const quests = yield* Quests;
  const events = yield* Events;
  let leafPaid = 0;
  const levelBefore = yield* levelOf(playerId, rules.levels);
  const stored = (yield* quests.book(playerId)) ?? openQuestBook(activities[0]?.occurredAt ?? now);
  // The quests rerolls replaced lately take activities from their own time reported late.
  const held = rules.quests.reroll?.heldMs;
  let book = held === undefined ? stored : { ...stored, replaced: yield* quests.replaced(playerId, now - held) };
  const written = new Map<string, Quest>();
  const completed: Quest[] = [];
  const undone: { readonly slot: QuestSlot; readonly from: number }[] = [];
  for (const activity of activities) {
    yield* insertActivity(activity, now);
    const amount = leafForActivity(activity, rules.earning);
    if (amount > 0) {
      const entry = yield* ledger.insert(
        draftEntry({
          kind: "earn",
          playerId,
          amount: leaf(amount),
          source: activity.kind,
          idempotencyKey: activity.sourceKey,
        }),
        now,
      );
      leafPaid += amount;
      yield* events.insert(
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
    undone.push(...(step.undone ?? []));
    for (const quest of step.completed) {
      leafPaid += quest.reward.leaf;
      yield* events.insert(playerId, { type: "quest_completed", data: { quest: questJson(quest) } }, now);
    }
  }
  yield* quests.saveStep(playerId, { book, written: [...written.values()], completed, undone }, now);
  return leafPaid + (yield* levelUp(playerId, levelBefore, rules.levels, now));
});

/** The activities in [from, to) that are not recorded yet, oldest first, each source key once. */
const newActivities = Effect.fnUntraced(function* (activities: readonly Activity[], from: number, to: number) {
  const sql = yield* SqlClient.SqlClient;
  const recordedKeys = SqlSchema.findAll({
    Request: Schema.Struct({ from: Schema.Int, to: Schema.Int }),
    Result: Schema.Struct({ sourceKey: Schema.String }),
    execute: (window) =>
      sql`SELECT source_key AS sourceKey FROM activities WHERE occurred_at >= ${window.from} AND occurred_at < ${window.to}`,
  });
  const recorded = new Set((yield* recordedKeys({ from, to }).pipe(Effect.orDie)).map((row) => row.sourceKey));
  const unique = new Map<string, Activity>();
  for (const activity of activities) {
    const inWindow = activity.occurredAt >= from && activity.occurredAt < to;
    if (inWindow && !recorded.has(activity.sourceKey)) {
      unique.set(activity.sourceKey, activity);
    }
  }
  return [...unique.values()].toSorted((a, b) => a.occurredAt - b.occurredAt || a.sourceKey.localeCompare(b.sourceKey));
});

const insertActivity = Effect.fnUntraced(function* (activity: Activity, now: number) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO activities ${sql.insert({
      sourceKey: activity.sourceKey,
      playerId: activity.playerId,
      kind: activity.kind,
      raid: activity.kind === "raid" ? (activity.raid ?? null) : null,
      detail: activity.kind === "raid" ? activity.raidName : activity.territory,
      seasonRating: activity.seasonRating,
      warPoints: activity.kind === "war" ? activity.warPoints : null,
      inClaim: activity.kind === "war" && activity.inClaim !== undefined ? Number(activity.inClaim) : null,
      occurredAt: activity.occurredAt,
      recordedAt: now,
    })}
  `.pipe(Effect.orDie);
});
