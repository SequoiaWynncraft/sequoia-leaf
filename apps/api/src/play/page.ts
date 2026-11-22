import {
  COIN_REASONS,
  DAILY_CHEST,
  dailyChestKey,
  type PageCoinsCall,
  pageCoinsKey,
  type PlayerId,
  utcDay,
} from "@sequoia-leaf/core";
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";

import { Allowances } from "../allowance.ts";
import { Coins } from "./coins.ts";
import { PlayStore } from "./store.ts";

/** How often a player's pages may call: four times a second, bursts of twenty. */
export const PAGE_CALLS = { rate: 4, burst: 20 } as const;
/** How many players' allowances are kept before those filled up again are let go. */
const ALLOWANCES_KEPT = 1000;

/** What a page's call came to. */
export type PageCoinsDone =
  /** Done now, or done before under the same id: the balance after it. */
  | { readonly status: "done"; readonly coins: number }
  /** A spend the balance does not cover. Nothing changed. */
  | { readonly status: "not_enough_coins" }
  /** More than the player may still earn this hour or this UTC day. Nothing changed. */
  | { readonly status: "too_much" }
  /** Calls faster than a player's pages may make them. Nothing was done, nor counted. */
  | { readonly status: "slow" };

/**
 * Coins changed by the pages of the games not on the play service yet (the town and the Works),
 * which still work out what they earn and spend. Each call is one entry in the Coins ledger, keyed
 * `page:<player>:<id>` so that a call sent twice is done once, and named for the game its reason
 * belongs to. The daily chest is Leaf's to pay: `DAILY_CHEST`, keyed by the player and the UTC day,
 * whatever the page sent. Refused, changing nothing: a spend the balance does not cover; an earning
 * past what the player may still earn (`Coins.room`, the one cap on all play), which Coins given
 * back for something taken away in the Works are too. A player's pages may call `PAGE_CALLS` a second; past that a call is
 * refused before anything is read or written. A player with no account yet has it opened with the
 * welcome first. Each call done or refused is counted for the staff's report, one answered from
 * before is not. It all goes when those games move to the play service.
 */
export class PageCoins extends Context.Service<
  PageCoins,
  { readonly change: (playerId: PlayerId, call: PageCoinsCall, now: number) => Effect.Effect<PageCoinsDone> }
>()("leaf/PageCoins") {
  static readonly layer = Layer.effect(
    PageCoins,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const coins = yield* Coins;
      const store = yield* PlayStore;
      const pace = new Allowances([PAGE_CALLS], ALLOWANCES_KEPT);

      /** Why a call that has not been done may not be, or null when it may. */
      const refusalOf = (playerId: PlayerId, call: PageCoinsCall, balance: number, now: number) =>
        Effect.gen(function* () {
          if (balance + call.amount < 0) {
            return { status: "not_enough_coins" } satisfies PageCoinsDone;
          }
          if (call.amount > 0 && call.amount > (yield* coins.room(playerId, now))) {
            return { status: "too_much" } satisfies PageCoinsDone;
          }
          return null;
        });

      return PageCoins.of({
        change: (playerId, call, now) =>
          !pace.take(playerId, now, [1])
            ? Effect.succeed({ status: "slow" } satisfies PageCoinsDone)
            : sql
                .withTransaction(
                  Effect.gen(function* () {
                    yield* coins.open(playerId, now);
                    const chest = call.reason === "daily_chest";
                    const key = chest ? dailyChestKey(playerId, utcDay(now)) : pageCoinsKey(playerId, call.id);
                    const amount = chest ? DAILY_CHEST : call.amount;
                    if (yield* coins.posted(key)) {
                      return { status: "done", coins: yield* coins.balance(playerId) } satisfies PageCoinsDone;
                    }
                    const balance = yield* coins.balance(playerId);
                    const refusal = yield* refusalOf(playerId, { ...call, amount }, balance, now);
                    if (refusal !== null) {
                      yield* store.count(playerId, 0, 1, now);
                      return refusal;
                    }
                    yield* coins.post(
                      playerId,
                      { amount, reason: call.reason, game: COIN_REASONS[call.reason].game, key },
                      now,
                    );
                    yield* store.count(playerId, 1, 0, now);
                    return { status: "done", coins: balance + amount } satisfies PageCoinsDone;
                  }),
                )
                .pipe(Effect.orDie),
      });
    }),
  );
}
