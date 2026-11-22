import type { PlayerId } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/** What a new player's Coins open at. */
export const WELCOME_COINS = 300;

/** A change to a balance: what it is, why, which game's command made it (if any), and the fact it records. */
export interface CoinEntry {
  readonly amount: number;
  readonly reason: string;
  readonly game: string | null;
  readonly key: string;
}

/** What posting an entry did. */
export type CoinPost =
  | { readonly status: "posted" }
  /** An entry with the same key was posted before: nothing was changed. */
  | { readonly status: "duplicate" };

const Balance = Schema.Struct({ balance: Schema.Int });

/**
 * Coins, kept as Leaf keeps Leaf: one balance per player, changed only by an entry, each entry keyed
 * by the fact it records so that it is never made twice. A trigger applies each entry to its
 * balance, and the balance can never go below zero; entries are never changed or removed. A new
 * player's account opens with `WELCOME_COINS`, as one entry keyed `welcome:<player>`. A database
 * failure is a defect.
 */
export class Coins extends Context.Service<
  Coins,
  {
    /** The player's balance; 0 for a player with no account yet. */
    readonly balance: (playerId: PlayerId) => Effect.Effect<number>;
    /**
     * Opens the player's account with the welcome, unless they have one already (opened before, or
     * with Coins brought over). Says whether it opened one now.
     */
    readonly open: (playerId: PlayerId, now: number) => Effect.Effect<boolean>;
    /** Posts one entry, unless its key was posted before. The caller makes sure a balance covers what it takes. */
    readonly post: (playerId: PlayerId, entry: CoinEntry, now: number) => Effect.Effect<CoinPost>;
  }
>()("leaf/Coins") {
  static readonly layer = Layer.effect(
    Coins,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const balance = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Balance,
        execute: (playerId) => sql`SELECT balance FROM coins WHERE player_id = ${playerId}`,
      });
      const insert = (playerId: PlayerId, entry: CoinEntry, now: number) => sql`
        INSERT INTO coin_entries (player_id, amount, reason, game, key, at)
        VALUES (${playerId}, ${entry.amount}, ${entry.reason}, ${entry.game}, ${entry.key}, ${now})
        ON CONFLICT (key) DO NOTHING
        RETURNING id
      `;
      return Coins.of({
        balance: (playerId) =>
          balance(playerId).pipe(
            Effect.map(Option.match({ onNone: () => 0, onSome: (row) => row.balance })),
            Effect.orDie,
          ),
        open: (playerId, now) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const opened =
                  yield* sql`INSERT OR IGNORE INTO coins (player_id, balance) VALUES (${playerId}, 0) RETURNING player_id`;
                if (opened.length === 0) {
                  return false;
                }
                yield* insert(
                  playerId,
                  { amount: WELCOME_COINS, reason: "Welcome to Guild Town", game: null, key: `welcome:${playerId}` },
                  now,
                );
                return true;
              }),
            )
            .pipe(Effect.orDie),
        post: (playerId, entry, now) =>
          insert(playerId, entry, now).pipe(
            Effect.map((rows): CoinPost => (rows.length > 0 ? { status: "posted" } : { status: "duplicate" })),
            Effect.orDie,
          ),
      });
    }),
  );
}
