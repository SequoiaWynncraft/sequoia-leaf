import { COMMAND_ID, type Ctx, MOST_COMMANDS, type PlayerId } from "@sequoia-leaf/core";
import { Clock, Context, Effect, Layer, Option, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { SqlClient } from "effect/sql";

import { Allowance } from "../allowance.ts";
import { Coins } from "./coins.ts";
import type { Opened, Played } from "./games.ts";
import { PlayStore } from "./store.ts";

/** How often a player may send a batch of commands: ten a second, bursts of twenty. */
export const BATCHES = { rate: 10, burst: 20 } as const;
/** How many players' allowances are kept before those filled up again are let go. */
const ALLOWANCES_KEPT = 1000;

/** Who is playing, as the play service needs to know them. */
export interface Playing {
  readonly playerId: PlayerId;
  readonly guest: boolean;
}

/** What one command answered: what it did, or the code it was refused with. */
const Result = Schema.Union([
  Schema.Struct({ id: Schema.String, notes: Schema.Array(Schema.Unknown) }),
  Schema.Struct({ id: Schema.String, refused: Schema.String }),
]);
export type Result = typeof Result.Type;
const readResult = Schema.decodeUnknownSync(Schema.fromJsonString(Result));

/** A player's state in a game as their page is given it: how many batches changed it, Leaf's clock, and the view. */
export interface Shown {
  readonly rev: number;
  readonly now: number;
  readonly view: unknown;
}

export type Batch =
  | ({ readonly status: "done"; readonly results: readonly Result[] } & Shown)
  /** A command that is not one of the game's, or a batch that is not a list of them. Nothing was done. */
  | { readonly status: "invalid"; readonly why: string }
  /** The player sent batches faster than they may. Nothing was done. */
  | { readonly status: "slow" };

/** A command as it came, with its id. */
interface Sent {
  readonly id: string;
  readonly command: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** What Leaf tells a game about a call. */
const ctxOf = (playing: Playing, now: number, seed: number): Ctx => ({
  now,
  player: { id: playing.playerId, guest: playing.guest },
  seed,
});

/** The commands of a batch with their ids, or why the batch is not one. */
function sentOf(played: Played, commands: readonly unknown[]): readonly Sent[] | string {
  if (commands.length > MOST_COMMANDS) {
    return `A batch holds at most ${MOST_COMMANDS} commands`;
  }
  const sent: Sent[] = [];
  for (const command of commands) {
    if (!isRecord(command) || typeof command.id !== "string" || !COMMAND_ID.test(command.id)) {
      return "Every command needs an id of its own: up to 64 letters, digits and _ . : -";
    }
    const { id } = command;
    if (sent.some((other) => other.id === id)) {
      return "Two commands in the batch have the same id";
    }
    if (!played.reads(command)) {
      return `Command ${id} is not one of the game's`;
    }
    sent.push({ id, command });
  }
  return sent;
}

/**
 * Leaf's play service: it owns each player's state in each game. A player's page opens a game
 * (`open`), and sends commands (`send`); Leaf does them in order with the game's rules, in one
 * transaction: it reads the state, brings it to now, does each command, and writes the state, the
 * Coins each command paid or took, what it logged, and each command's answer. A command whose id
 * was seen before answers as it did then and changes nothing; one that would take more Coins than
 * the player has is refused with `not_enough_coins`. A player with no state yet gets a new one,
 * and their Coins open with the welcome. Leaf's dice for each call come from `SecureRandom`.
 */
export class Play extends Context.Service<
  Play,
  {
    /** The player's state in a game, made for them if they have none. */
    readonly open: (playing: Playing, played: Played) => Effect.Effect<Shown>;
    /** Does a batch of commands, as they came off the wire. */
    readonly send: (playing: Playing, played: Played, commands: readonly unknown[]) => Effect.Effect<Batch>;
  }
>()("leaf/Play") {
  static readonly layer = Layer.effect(
    Play,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* PlayStore;
      const coins = yield* Coins;
      const random = yield* SecureRandom.SecureRandom;
      const dice = random.intBetween(0, 0xffffffff);
      const allowances = new Map<string, Allowance>();

      /** Whether the player may send a batch now, and if so, counts it. */
      function allowed(playerId: PlayerId, now: number): boolean {
        if (allowances.size > ALLOWANCES_KEPT) {
          for (const [id, allowance] of allowances) if (allowance.full(now)) allowances.delete(id);
        }
        const allowance = allowances.get(playerId) ?? new Allowance(BATCHES, now);
        allowances.set(playerId, allowance);
        return allowance.take(now);
      }

      /** The player's stored state in a game, or a new one made and stored for them, opened at now. */
      const opened = (playing: Playing, played: Played, now: number) =>
        Effect.gen(function* () {
          const found = yield* store.read(playing.playerId, played.id);
          let rev = 0;
          let text: string;
          if (Option.isSome(found)) {
            ({ rev } = found.value);
            text = found.value.state;
          } else {
            text = played.create(ctxOf(playing, now, yield* dice));
            yield* store.create(playing.playerId, played.id, text, now);
            yield* coins.open(playing.playerId, now);
          }
          const game: Opened | null = played.open(text, ctxOf(playing, now, yield* dice));
          if (game === null) {
            return yield* Effect.die(new Error(`The ${played.id} state stored for ${playing.playerId} does not read`));
          }
          return { rev, text, game };
        });

      return Play.of({
        open: (playing, played) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const { rev, game } = yield* sql.withTransaction(opened(playing, played, now)).pipe(Effect.orDie);
            return { rev, now, view: game.view(ctxOf(playing, now, 0)) };
          }),
        send: (playing, played, commands) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            if (!allowed(playing.playerId, now)) {
              return { status: "slow" } satisfies Batch;
            }
            const sent = sentOf(played, commands);
            if (typeof sent === "string") {
              return { status: "invalid", why: sent } satisfies Batch;
            }
            const done = yield* sql
              .withTransaction(
                Effect.gen(function* () {
                  const { rev, text, game } = yield* opened(playing, played, now);
                  let balance = yield* coins.balance(playing.playerId);
                  const results: Result[] = [];
                  const answers: { readonly id: string; readonly result: string; readonly refused: boolean }[] = [];
                  for (const { id, command } of sent) {
                    const before = yield* store.answered(playing.playerId, played.id, id);
                    if (Option.isSome(before)) {
                      results.push(readResult(before.value));
                      continue;
                    }
                    const attempt = game.attempt(command, ctxOf(playing, now, yield* dice));
                    let result: Result;
                    if ("refused" in attempt) {
                      result = { id, refused: attempt.refused };
                    } else if (balance + attempt.coins.reduce((sum, c) => sum + Math.min(0, c.amount), 0) < 0) {
                      // A command that takes Coins the player does not have is not done at all.
                      result = { id, refused: "not_enough_coins" };
                    } else {
                      attempt.keep();
                      for (const change of attempt.coins) {
                        const posted = yield* coins.post(
                          playing.playerId,
                          {
                            amount: change.amount,
                            reason: change.reason,
                            game: played.id,
                            key: `${played.id}:${playing.playerId}:${change.key}`,
                          },
                          now,
                        );
                        if (posted.status === "posted") {
                          balance += change.amount;
                        }
                      }
                      for (const logged of attempt.log) {
                        yield* store.log(playing.playerId, played.id, logged, now);
                      }
                      result = { id, notes: attempt.notes };
                    }
                    results.push(result);
                    answers.push({ id, result: JSON.stringify(result), refused: "refused" in result });
                  }
                  const after = game.text();
                  let next = rev;
                  if (after !== text) {
                    if (!(yield* store.write(playing.playerId, played.id, rev, after, now))) {
                      return yield* Effect.die(
                        new Error(`The ${played.id} state of ${playing.playerId} changed underfoot`),
                      );
                    }
                    next = rev + 1;
                  }
                  for (const { id, result } of answers) {
                    yield* store.answer(playing.playerId, played.id, id, next, result, now);
                  }
                  // Counted for the staff's report: each command done or refused now, not those answered from before.
                  const refused = answers.filter((a) => a.refused).length;
                  yield* store.count(playing.playerId, answers.length - refused, refused, now);
                  return { rev: next, results, view: game.view(ctxOf(playing, now, 0)) };
                }),
              )
              .pipe(Effect.orDie);
            return { status: "done", now, ...done } satisfies Batch;
          }),
      });
    }),
  );
}
