import { DEFAULT_RULES, type GreatTotals, leaf } from "@sequoia-leaf/core";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

import type { Refused, Visitor } from "../grove/actions.ts";
import { Grove } from "../grove/store.ts";
import { Ledger } from "../ledger/store.ts";
import { announceGoalsMet } from "./goals.ts";
import { Great } from "./store.ts";

/**
 * Offers Leaf to the Great Sequoia toward the week's goal, through the ledger
 * with sink `offering`, keyed by the member's request: a request sent again
 * offers nothing more. Answers the balance after it and how the member has
 * helped in the offering's week. The amount must be one `offeringAllowed` takes.
 * An offering that meets the week's goal tells the guild feed.
 */
export const offerToGreat = Effect.fn("offerToGreat")(function* (
  visitor: Visitor,
  amount: number,
  requestId: string,
  now: number,
) {
  const sql = yield* SqlClient.SqlClient;
  const grove = yield* Grove;
  const ledger = yield* Ledger;
  const great = yield* Great;
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        yield* grove.visit(visitor.playerId, visitor.username, now);
        const posted = yield* ledger.post(
          {
            kind: "spend",
            playerId: visitor.playerId,
            amount: leaf(amount),
            sink: "offering",
            idempotencyKey: `offering:${visitor.playerId}:${requestId}`,
          },
          now,
        );
        if (posted.status === "rejected") {
          const refused: Refused = {
            status: "refused",
            reason: posted.reason === "insufficient_leaf" ? "insufficient_leaf" : "request_conflict",
          };
          return refused;
        }
        if (posted.status === "posted") {
          yield* announceGoalsMet(now, now, DEFAULT_RULES.great);
        }
        // A retry answers for the week the offering was made in.
        const helped: GreatTotals = (yield* great.helper(visitor.playerId, posted.entry.createdAt)) ?? {
          raids: 0,
          wars: 0,
          offeredLeaf: 0,
        };
        return { status: "offered" as const, balance: (yield* ledger.account(visitor.playerId)).balance, helped };
      }),
    )
    .pipe(Effect.orDie);
});
