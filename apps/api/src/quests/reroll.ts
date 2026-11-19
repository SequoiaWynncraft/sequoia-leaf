import {
  draftEntry,
  leaf,
  openQuestBook,
  type PlayerId,
  type Quest,
  type QuestRules,
  type QuestSlot,
  rerollQuest,
} from "@sequoia-leaf/core";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

import { Events } from "../events/store.ts";
import { Ledger } from "../ledger/store.ts";
import { questJson } from "./json.ts";
import { Quests } from "./store.ts";

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
  | {
      readonly status: "refused";
      readonly reason: "not_current" | "not_rerollable" | "cost_changed" | "insufficient_leaf";
    };

/**
 * Swaps a player's quest `slot:sequence` for another and charges what it costs,
 * all in one transaction: the quests, the spend, the count of the day's rerolls
 * and a `quest_rerolled` event. `agreedLeaf` is the cost the player was shown;
 * when the reroll costs anything else now, it is refused. Nothing is written
 * when it is refused.
 */
export const rerollQuestFor = Effect.fn("rerollQuestFor")(function* (
  playerId: PlayerId,
  slot: QuestSlot,
  sequence: number,
  agreedLeaf: number,
  now: number,
  rules: QuestRules,
): Effect.fn.Return<RerollResult, never, SqlClient.SqlClient | Quests | Ledger | Events> {
  const sql = yield* SqlClient.SqlClient;
  const quests = yield* Quests;
  const ledger = yield* Ledger;
  const events = yield* Events;
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        const book = (yield* quests.book(playerId)) ?? openQuestBook(now);
        const rerollsToday = (yield* quests.rerollsOnDay(playerId, now)).get(slot) ?? 0;
        const step = rerollQuest(book, playerId, slot, sequence, now, rerollsToday, rules);
        if (step.status === "refused") {
          return step;
        }
        if (step.cost !== agreedLeaf) {
          return { status: "refused", reason: "cost_changed" } satisfies RerollResult;
        }
        // A free reroll needs no Leaf, even from a member a correction left in debt.
        if (step.cost > 0 && (yield* ledger.account(playerId)).balance < step.cost) {
          return { status: "refused", reason: "insufficient_leaf" } satisfies RerollResult;
        }
        yield* quests.saveStep(playerId, step, now);
        if (step.cost > 0) {
          yield* ledger.insert(
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
        yield* quests.recordReroll(playerId, slot, sequence, step.cost, now);
        yield* events.insert(
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
          balance: (yield* ledger.account(playerId)).balance,
        } satisfies RerollResult;
      }),
    )
    .pipe(Effect.orDie);
});
