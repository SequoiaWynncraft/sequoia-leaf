import type { Database } from "bun:sqlite";

import {
  DAY_MS,
  draftEntry,
  leaf,
  openQuestBook,
  type PlayerId,
  type Quest,
  type QuestRules,
  type QuestSlot,
  rerollQuest,
  utcDay,
} from "@sequoia-leaf/core";

import { insertEvent } from "../events/store.ts";
import { getAccount, insertEntry } from "../ledger/store.ts";
import { questJson } from "./json.ts";
import { loadQuestBook, saveQuestStep } from "./store.ts";

export type RerollResult =
  | {
      readonly status: "rerolled";
      readonly replaced: Quest;
      readonly quest: Quest;
      /** The Leaf it cost. */
      readonly spent: number;
      /** The player's balance after it. */
      readonly balance: number;
    }
  | { readonly status: "refused"; readonly reason: "not_current" | "not_rerollable" | "insufficient_leaf" };

/** How many times a player rerolled each slot on the UTC day of `at`. Slots not rerolled that day are absent. */
export function rerollsOnDay(db: Database, playerId: PlayerId, at: number): Map<QuestSlot, number> {
  const dayStart = utcDay(at) * DAY_MS;
  const rows = db
    .query<{ slot: QuestSlot; rerolls: number }, [string, number, number]>(
      `SELECT slot, COUNT(*) AS rerolls FROM quest_rerolls
       WHERE player_id = ? AND rerolled_at >= ? AND rerolled_at < ?
       GROUP BY slot`,
    )
    .all(playerId, dayStart, dayStart + DAY_MS);
  return new Map(rows.map((row) => [row.slot, row.rerolls]));
}

/**
 * Swaps a player's quest `slot:sequence` for another and charges what it costs,
 * all in one transaction: the quests, the spend, the count of the day's rerolls
 * and a `quest_rerolled` event. Nothing is written when it is refused.
 */
export function rerollQuestFor(
  db: Database,
  playerId: PlayerId,
  slot: QuestSlot,
  sequence: number,
  now: number,
  rules: QuestRules,
): RerollResult {
  // Immediate, like the credit sync, so the book read here is the one written back.
  return db
    .transaction((): RerollResult => {
      const book = loadQuestBook(db, playerId) ?? openQuestBook(now);
      const rerollsToday = rerollsOnDay(db, playerId, now).get(slot) ?? 0;
      const step = rerollQuest(book, playerId, slot, sequence, now, rerollsToday, rules);
      if (step.status === "refused") {
        return step;
      }
      if (getAccount(db, playerId).balance < step.cost) {
        return { status: "refused", reason: "insufficient_leaf" };
      }
      saveQuestStep(db, playerId, step, now);
      if (step.cost > 0) {
        insertEntry(
          db,
          draftEntry({
            kind: "spend",
            playerId,
            amount: leaf(step.cost),
            sink: "reroll",
            idempotencyKey: `reroll:${playerId}:${slot}:${sequence}`,
          }),
          now,
        );
      }
      db.query("INSERT INTO quest_rerolls (player_id, slot, sequence, leaf, rerolled_at) VALUES (?, ?, ?, ?, ?)").run(
        playerId,
        slot,
        sequence,
        step.cost,
        now,
      );
      insertEvent(
        db,
        playerId,
        {
          type: "quest_rerolled",
          data: { replaced: questJson(step.replaced), quest: questJson(step.quest), leaf: step.cost },
        },
        now,
      );
      return {
        status: "rerolled",
        replaced: step.replaced,
        quest: step.quest,
        spent: step.cost,
        balance: getAccount(db, playerId).balance,
      };
    })
    .immediate();
}
