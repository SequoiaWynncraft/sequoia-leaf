import { type CoinChange, COMMAND_ID, type Ctx, type Logged, MOST_COMMANDS, type PlayerId } from "@sequoia-leaf/core";
import { Clock, Context, Effect, Layer, Option, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { SqlClient } from "effect/sql";

import { Allowances } from "../allowance.ts";
import { Coins } from "./coins.ts";
import type { Opened, Played } from "./games.ts";
import { PlayStore } from "./store.ts";

/** How often a player may send a batch of commands: ten a second, bursts of twenty. */
export const BATCHES = { rate: 10, burst: 20 } as const;
/** How many commands a player may have done, across all games: ten a second, bursts of forty. */
export const COMMANDS = { rate: 10, burst: 40 } as const;
/** How many players' allowances are kept before those filled up again are let go. */
const ALLOWANCES_KEPT = 1000;

/** Who is playing, as the play service needs to know them. */
export interface Playing {
  readonly playerId: PlayerId;
  readonly guest: boolean;
}

/** What one command answered: what it did, or the code it was refused with. */
export type Result =
  { readonly id: string; readonly notes: readonly unknown[] } | { readonly id: string; readonly refused: string };
/** A command's answer as it is kept: its notes or its refusal, without its id or any state. */
const Kept = Schema.Union([
  Schema.Struct({ notes: Schema.Array(Schema.Unknown) }),
  Schema.Struct({ refused: Schema.String }),
]);
const readKept = Schema.decodeUnknownSync(Schema.fromJsonString(Kept));
const keptOf = (result: Result): string =>
  JSON.stringify("refused" in result ? { refused: result.refused } : { notes: result.notes });

/** A player's state in a game as their page is given it: how many batches changed it, Leaf's clock, and the view. */
export interface Shown {
  readonly rev: number;
  readonly now: number;
  readonly view: unknown;
}

/** A player's state opened for their page, or none: the one stored does not read. */
export type Opening = ({ readonly status: "open" } & Shown) | { readonly status: "unreadable" };

export type Batch =
  | ({ readonly status: "done"; readonly results: readonly Result[] } & Shown)
  /** The state stored does not read. Nothing was done, and it is kept as it is. */
  | { readonly status: "unreadable" }
  /** A command that is not one of the game's, or a batch that is not a list of them. Nothing was done. */
  | { readonly status: "invalid"; readonly why: string }
  /** The player sent batches, or commands, faster than they may. Nothing was done. */
  | { readonly status: "slow" };

/** A command as it came, with its id. */
interface Sent {
  readonly id: string;
  readonly command: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** What Leaf tells a game about a call. */
const ctxOf = (playing: Playing, now: number, seed: number, room: number): Ctx => ({
  now,
  player: { id: playing.playerId, guest: playing.guest },
  seed,
  room,
});

/**
 * What each of a command's Coins changes comes to, worked out in order from the balance: one that
 * pays in is cut to what the player may still earn (`room`) unless it is `free`. Null when the
 * balance would go below nothing at any point: the command cannot be paid for.
 */
function payable(changes: readonly CoinChange[], balance: number, room: number): number[] | null {
  let after = balance;
  let left = room;
  const amounts: number[] = [];
  for (const change of changes) {
    const amount = change.free === true ? change.amount : Math.min(change.amount, left);
    if (change.free !== true) left -= Math.max(0, amount);
    after += amount;
    if (after < 0) return null;
    amounts.push(amount);
  }
  return amounts;
}

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
 * transaction: it reads the state, brings it to now, does each command, and writes the state (and,
 * for a game with a board, where it stands), the Coins each command paid or took, what it logged,
 * and each command's answer. A command whose id
 * was seen before answers as it did then and changes nothing; one whose Coins changes, added to the
 * balance in order, would take it below nothing at any point is refused with `not_enough_coins`;
 * one that pays is done whatever the player has earned, and paid only as far as they may still earn
 * (`Coins.room`, which each game is told, so that it says what was really paid), but for a change
 * that is `free`, which is paid whole and uses none of it. A player with no state yet gets a new one,
 * and their Coins open with the welcome. A stored state that will not read is left as it is: the
 * player and the game are logged, and nothing is done. Leaf's dice for each call come from
 * `SecureRandom`.
 */
export class Play extends Context.Service<
  Play,
  {
    /** The player's state in a game, made for them if they have none. */
    readonly open: (playing: Playing, played: Played) => Effect.Effect<Opening>;
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
      // Each player's batches and commands, across all games.
      const pace = new Allowances([BATCHES, COMMANDS], ALLOWANCES_KEPT);

      /**
       * The player's stored state in a game, or a new one made and stored for them, opened at now.
       * Null for a stored state that does not read, which is logged and left as it is.
       */
      const opened = (playing: Playing, played: Played, now: number, room: number) =>
        Effect.gen(function* () {
          const found = yield* store.read(playing.playerId, played.id);
          let rev = 0;
          let text: string;
          if (Option.isSome(found)) {
            ({ rev } = found.value);
            text = found.value.state;
          } else {
            text = played.create(ctxOf(playing, now, yield* dice, room));
            yield* store.create(playing.playerId, played.id, text, now);
            yield* coins.open(playing.playerId, now);
          }
          const game: Opened | null = played.open(text, ctxOf(playing, now, yield* dice, room));
          if (game === null) {
            yield* Effect.logError(
              `The ${played.id} state stored for ${playing.playerId} does not read; it is kept as it is`,
            ).pipe(Effect.annotateLogs({ player: playing.playerId, game: played.id, rev }));
            return null;
          }
          return { rev, text, game };
        });

      return Play.of({
        open: (playing, played) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const room = yield* coins.room(playing.playerId, now);
            const open = yield* sql.withTransaction(opened(playing, played, now, room)).pipe(Effect.orDie);
            if (open === null) {
              return { status: "unreadable" } satisfies Opening;
            }
            return {
              status: "open",
              rev: open.rev,
              now,
              view: open.game.view(ctxOf(playing, now, 0, room)),
            } satisfies Opening;
          }),
        send: (playing, played, commands) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const sent = sentOf(played, commands);
            if (typeof sent === "string") {
              return { status: "invalid", why: sent } satisfies Batch;
            }
            // A batch that would take the player past either allowance is refused whole.
            if (!pace.take(playing.playerId, now, [1, sent.length])) {
              return { status: "slow" } satisfies Batch;
            }
            const done = yield* sql
              .withTransaction(
                Effect.gen(function* () {
                  let room = yield* coins.room(playing.playerId, now);
                  const open = yield* opened(playing, played, now, room);
                  if (open === null) {
                    return null;
                  }
                  const { rev, text, game } = open;
                  let balance = yield* coins.balance(playing.playerId);
                  const results: Result[] = [];
                  const answers: { readonly id: string; readonly result: Result }[] = [];
                  const logs: Logged[] = [];
                  for (const { id, command } of sent) {
                    const before = yield* store.answered(playing.playerId, played.id, id);
                    if (Option.isSome(before)) {
                      results.push({ id, ...readKept(before.value) });
                      continue;
                    }
                    const attempt = game.attempt(command, ctxOf(playing, now, yield* dice, room));
                    const amounts = "refused" in attempt ? null : payable(attempt.coins, balance, room);
                    let result: Result;
                    if ("refused" in attempt) {
                      result = { id, refused: attempt.refused };
                    } else if (amounts === null) {
                      // A command that takes Coins the player does not have is not done at all.
                      result = { id, refused: "not_enough_coins" };
                    } else {
                      attempt.keep();
                      for (const [n, change] of attempt.coins.entries()) {
                        // Past what the player may still earn, the command is done all the same and pays what is left.
                        const amount = amounts[n] ?? 0;
                        if (amount === 0) {
                          continue;
                        }
                        const free = change.free === true;
                        const posted = yield* coins.post(
                          playing.playerId,
                          {
                            amount,
                            reason: change.reason,
                            game: played.id,
                            key: `${played.id}:${playing.playerId}:${change.key}`,
                            free,
                          },
                          now,
                        );
                        if (posted.status === "posted") {
                          balance += amount;
                          room -= free ? 0 : Math.max(0, amount);
                        }
                      }
                      logs.push(...attempt.log);
                      result = { id, notes: attempt.notes };
                    }
                    results.push(result);
                    answers.push({ id, result });
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
                    const standing = game.standing();
                    if (standing !== null) {
                      yield* store.stand(playing.playerId, played.id, standing, playing.guest, now);
                    }
                  }
                  yield* store.log(playing.playerId, played.id, logs, now);
                  for (const { id, result } of answers) {
                    yield* store.answer(playing.playerId, played.id, id, next, keptOf(result));
                  }
                  if (answers.length > 0) {
                    yield* store.keepNewest(playing.playerId, played.id);
                  }
                  // Counted for the staff's report: each command done or refused now, not those answered from before.
                  const refused = answers.filter((a) => "refused" in a.result).length;
                  yield* store.count(playing.playerId, answers.length - refused, refused, now);
                  return { rev: next, results, view: game.view(ctxOf(playing, now, 0, room)) };
                }),
              )
              .pipe(Effect.orDie);
            if (done === null) {
              return { status: "unreadable" } satisfies Batch;
            }
            return { status: "done", now, ...done } satisfies Batch;
          }),
      });
    }),
  );
}
