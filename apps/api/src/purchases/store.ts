import { type Leaf, type PlayerId, type RequestKind, REQUESTS } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";

import { Ledger } from "../ledger/store.ts";

export type Bought =
  /** Paid, now or by an earlier call with the same key: `balance` is the player's after it. */
  | { readonly status: "paid"; readonly balance: number }
  | {
      readonly status: "refused";
      readonly reason:
        /** The player's balance does not cover it. */
        | "insufficient_leaf"
        /** The key was used for another purchase: another player, kind or price. */
        | "key_in_use"
        /** The key was cancelled, before or after it was paid. */
        | "purchase_cancelled";
    };

/** What a cancel did: gave a paid purchase's Leaf back, or kept the key from ever being paid. */
export type Cancelled = { readonly status: "refunded" | "cancelled" };

/** The ledger's key for a purchase's spend, and for its refund. */
const spendKey = (key: string) => `purchase:${key}`;
const refundKey = (key: string) => `purchase:${key}:refund`;

/**
 * Guild requests sequoia-backend buys for members with their Leaf (a tome or an aspect request), each
 * by a key the backend makes for it. Buying the same key again answers as the first time did, and
 * changes nothing. A cancel refunds a paid purchase, and keeps a key not paid yet from ever being
 * paid, so the backend can give up on a purchase whose answer it never heard and know it was not
 * charged. Both are one transaction each. The spend is the ledger's, as `request`.
 */
export class Purchases extends Context.Service<
  Purchases,
  {
    readonly buy: (
      key: string,
      playerId: PlayerId,
      kind: RequestKind,
      price: Leaf,
      now: number,
    ) => Effect.Effect<Bought>;
    readonly cancel: (key: string, now: number) => Effect.Effect<Cancelled>;
  }
>()("leaf/Purchases") {
  static readonly layer = Layer.effect(
    Purchases,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const ledger = yield* Ledger;

      const isCancelled = (key: string) =>
        sql`SELECT 1 FROM cancelled_purchases WHERE key = ${key}`.pipe(Effect.map((rows) => rows.length > 0));

      return Purchases.of({
        buy: (key, playerId, kind, price, now) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                if (yield* isCancelled(key)) {
                  return { status: "refused", reason: "purchase_cancelled" } satisfies Bought;
                }
                const posted = yield* ledger.post(
                  {
                    kind: "spend",
                    playerId,
                    amount: price,
                    sink: "request",
                    idempotencyKey: spendKey(key),
                    memo: REQUESTS[kind],
                  },
                  now,
                );
                if (posted.status === "rejected") {
                  return {
                    status: "refused",
                    reason: posted.reason === "insufficient_leaf" ? "insufficient_leaf" : "key_in_use",
                  } satisfies Bought;
                }
                // The ledger takes a repeat by who, how much and on what; which request it bought is its memo.
                if (posted.status === "duplicate" && posted.entry.memo !== REQUESTS[kind]) {
                  return { status: "refused", reason: "key_in_use" } satisfies Bought;
                }
                return { status: "paid", balance: (yield* ledger.account(playerId)).balance } satisfies Bought;
              }),
            )
            .pipe(Effect.orDie),

        cancel: (key, now) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const spend = yield* ledger.entry(spendKey(key));
                if (Option.isSome(spend)) {
                  // Posting the refund again, or after it was posted, changes nothing.
                  yield* ledger.post(
                    {
                      kind: "reversal",
                      playerId: spend.value.playerId,
                      reverses: spend.value,
                      idempotencyKey: refundKey(key),
                    },
                    now,
                  );
                }
                yield* sql`INSERT INTO cancelled_purchases (key, cancelled_at) VALUES (${key}, ${now}) ON CONFLICT (key) DO NOTHING`;
                return { status: Option.isSome(spend) ? "refunded" : "cancelled" } satisfies Cancelled;
              }),
            )
            .pipe(Effect.orDie),
      });
    }),
  );
}
