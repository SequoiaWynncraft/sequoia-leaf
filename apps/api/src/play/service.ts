import {
  type CoinChange,
  COMMAND_ID,
  type Ctx,
  isLeaf,
  type Leaf,
  type LeafSpend,
  LOGGED,
  type Logged,
  MOST_COMMANDS,
  type PlayerId,
} from "@sequoia-leaf/core";
import { Clock, Context, Deferred, Effect, Exit, Latch, Layer, Option, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { SqlClient } from "effect/sql";

import { Allowances } from "../allowance.ts";
import { AppConfig } from "../config.ts";
import { Ledger } from "../ledger/store.ts";
import { Coins } from "./coins.ts";
import type { Held, Played } from "./games.ts";
import { PlayStore } from "./store.ts";

/** How often a player may send a batch of commands: ten a second, bursts of twenty. */
export const BATCHES = { rate: 10, burst: 20 } as const;
/** How many commands a player may have done, across all games: ten a second, bursts of forty. */
export const COMMANDS = { rate: 10, burst: 40 } as const;
/** How many players' allowances are kept before those filled up again are let go. */
const ALLOWANCES_KEPT = 1000;
/**
 * How long a state of a game that tends its states (`Game.tend`) may go unwritten before Leaf tends
 * it itself: long enough that one whose player's page is open, sending a command now and then, is
 * left to the page.
 */
export const TEND_AFTER = 2 * 60_000;
/**
 * How long one slice of running states on lasts, in nanoseconds; a rest as long follows it. One
 * slice runs at a time for every state and every job together. Live's rooms answer every 16 ms,
 * and a slice can hold up each step of a move on its way: 2 ms keeps them as they are.
 */
const SLICE_NS = 2_000_000n;
/** How many slices for players' jobs a waiting tend lets go first; the next is its own. */
const TEND_WAITS = 3;

/** A player's state in a game as its lane holds it in memory. */
interface Copy {
  /**
   * The stored `rev` it came from (null for a new state, stored by the first write), the text
   * stored at it, and whether its player was a guest then.
   */
  rev: number | null;
  text: string;
  guest: boolean;
  /** The moment it has been brought to. */
  at: number;
  readonly held: Held;
  /** Whether it has been run on past what is stored. */
  unsaved: boolean;
}

/** One thing asked of a lane: an open, a visit, a batch of commands, or Leaf's own tend. */
interface Job {
  /** Leaf's own, not a player's. */
  readonly tend: boolean;
  /** Its place among the arrivals of every lane's jobs. */
  readonly seq: number;
  /** All but a batch: its caller has gone while it waited, and it is never done. */
  gone: boolean;
  /** Does it, saves the copy if it leaves the line empty, then answers it; false when anything went wrong. */
  readonly run: Effect.Effect<boolean>;
  /** Answers it as stopped, unless it has been answered. */
  readonly stop: () => void;
}

/** Everything Leaf is doing with one player's state in one game, from its first job until it has none and nothing unsaved. */
interface Lane {
  readonly key: string;
  readonly player: PlayerId;
  readonly played: Played;
  /** The line: the jobs in the order they came, the one being done first. */
  readonly jobs: Job[];
  copy: Copy | undefined;
}

/** A slice of running a state on, asked for by a lane's job. */
interface Ask {
  readonly job: Job;
  readonly work: (more: () => boolean) => boolean;
  readonly done: Deferred.Deferred<boolean>;
}

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

/**
 * Somebody's state opened for a visitor; or nothing to visit (no state, or a game that cannot be
 * visited); or none, the one stored does not read; or the visitor asked faster than they may.
 */
export type Visiting = Opening | { readonly status: "nothing" } | { readonly status: "slow" };

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
/** Which state of which player's a lane is of. */
const keyOf = (player: PlayerId, played: Played) => `${played.id}:${player}`;

/** What Leaf tells a game about a call. */
const ctxOf = (playing: Playing, now: number, seed: number, room: number, awards: readonly string[]): Ctx => ({
  now,
  player: { id: playing.playerId, guest: playing.guest },
  seed,
  room,
  awards,
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

/** A spend of a command's as the ledger takes it: its amount checked, and keyed for the player and the game. */
interface Taken {
  readonly amount: Leaf;
  readonly reason: string;
  readonly key: string;
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
 * (`open`), and sends commands (`send`); Leaf does them in order with the game's rules, and keeps a
 * batch in one transaction: the state, and for a game with a board where it stands, the Coins each
 * command paid or took, what it logged, each command's answer, and what the state shows the player
 * has won for good (`Game.awards`), which every game is told on every call. A command whose id
 * was seen before answers as it did then and changes nothing; one whose Coins changes, added to the
 * balance in order, would take it below nothing at any point is refused with `not_enough_coins`;
 * one that pays is done whatever the player has earned, and paid only as far as they may still earn
 * (`Coins.room`, which each game is told, so that it says what was really paid), but for a change
 * that is `free`, which is paid whole and uses none of it. A command may take Leaf (`Done.leaf`), never
 * pay it in: it is refused `leaf_closed` while `GAME_LEAF_SPENDING` is off or the player is a guest,
 * and `not_enough_leaf` when its spends come to more than the ledger's balance; otherwise each is
 * posted to the ledger as a spend on the `shop` sink, keyed `play:<game>:<player>:<key>`, and logged
 * (`leaf_spent`). A key the ledger has seen is not taken again, and the command stands. Leaf earns no
 * XP and uses none of the Coins' room. A player with no state yet gets a new one,
 * and their Coins open with the welcome. A stored state that will not read is left as it is: the
 * player and the game are logged, and nothing is done. Leaf's dice for each call come from
 * `SecureRandom`. A visitor (`visit`) is shown somebody's state, and is given nothing of theirs.
 *
 * Everything asked of one player's state in one game (an open, a visit, a batch, Leaf's own tend)
 * is a job in that state's lane (`Lane`), which holds at most one copy of it in memory (`Copy`).
 * A job takes its place in the lane's line as it arrives, with the moment it arrived, before
 * anything is waited for; the lane does them one at a time in that order. Doing one: the copy is
 * read from what is stored if there is none or the stored `rev` is no longer its own, brought to the
 * job's moment (for a game that tends its states, a slice at a time), and then shown, or commanded
 * and kept. The copy is written by a batch, and whenever a job leaves the line empty with the copy
 * run on past what is stored, as a batch of no commands from its owner; nothing else writes it.
 * Anything going wrong in a job drops the copy. A batch is done whatever becomes of its request;
 * any other job whose caller has gone while it waited is never done. A lane with an empty line and
 * nothing unsaved is let go.
 *
 * One slice of running states on (`SLICE_NS`) runs at a time, then a rest as long. The next goes to
 * the job that arrived first among players' jobs, but to Leaf's own once one has waited through
 * `TEND_WAITS` of those. Leaf tends every state stored longer ago than `TEND_AFTER` of a game that
 * tends its states (`tend`), one after another, but for those found standing still.
 *
 * Each call taken (an opening, a batch that is not refused whole, a visit) counts for the caller the
 * time since their last call to that game (`PlayStore.heard`), once, at the moment it arrived, as it
 * takes its place. Leaf's own tending is no call, and counts nothing.
 */
export class Play extends Context.Service<
  Play,
  {
    /** The player's state in a game, made for them if they have none. */
    readonly open: (playing: Playing, played: Played) => Effect.Effect<Opening>;
    /** Does a batch of commands, as they came off the wire. */
    readonly send: (playing: Playing, played: Played, commands: readonly unknown[]) => Effect.Effect<Batch>;
    /** Another player's state in a game, as a visitor (`caller`) is given it. Takes one of the caller's batches. */
    readonly visit: (player: PlayerId, played: Played, caller: Playing) => Effect.Effect<Visiting>;
    /** Tends every stored state of these games last written longer ago than `TEND_AFTER` and not standing still. */
    readonly tend: (games: readonly Played[]) => Effect.Effect<void>;
  }
>()("leaf/Play") {
  static readonly layer = Layer.effect(
    Play,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* PlayStore;
      const coins = yield* Coins;
      const ledger = yield* Ledger;
      const { gameLeafSpending } = yield* AppConfig;
      const random = yield* SecureRandom.SecureRandom;
      const clock = yield* Clock.Clock;
      const scope = yield* Effect.scope;
      const dice = random.intBetween(0, 0xffffffff);
      // Each player's batches and commands, across all games.
      const pace = new Allowances([BATCHES, COMMANDS], ALLOWANCES_KEPT);
      // Every lane, by `keyOf`; and how many jobs have arrived, in all of them.
      const lanes = new Map<string, Lane>();
      let arrivals = 0;
      // The stored states found standing still, by `keyOf`, with the `rev` each was found at.
      const stills = new Map<string, number>();

      // The one budget: the slices asked for, and how many players' slices a waiting tend has let go.
      const asks: Ask[] = [];
      const asked = yield* Latch.make(false);
      const nanos = () => clock.monotonicTimeNanosUnsafe();
      let waited = 0;
      /** The slice to run next, taken from those asked for. */
      const nextAsk = () => {
        const first = (tend: boolean) =>
          asks.reduce<Ask | undefined>(
            (o, a) => (a.job.tend === tend && (o === undefined || a.job.seq < o.job.seq) ? a : o),
            undefined,
          );
        const player = first(false);
        const tend = first(true);
        const ask = tend !== undefined && (player === undefined || waited >= TEND_WAITS) ? tend : player;
        waited = ask === player && tend !== undefined ? waited + 1 : 0;
        if (ask !== undefined) asks.splice(asks.indexOf(ask), 1);
        return ask;
      };
      yield* Effect.forkIn(
        Effect.gen(function* () {
          for (;;) {
            yield* asked.await;
            const ask = nextAsk();
            if (ask === undefined) {
              asked.closeUnsafe();
              continue;
            }
            const began = nanos();
            const ran = yield* Effect.exit(Effect.sync(() => ask.work(() => nanos() - began < SLICE_NS)));
            const rested = 2n * nanos() - began;
            Deferred.doneUnsafe(ask.done, ran);
            // The rest, on the monotonic clock. Timers wake a little early: whole milliseconds until it is over.
            do yield* Effect.sleep(Math.max(1, Math.ceil(Number(rested - nanos()) / 1e6)));
            while (rested > nanos());
          }
        }),
        scope,
      );
      /** Runs `work` for a job when its slice comes, and says what it said: whether there is further to go. */
      const slice = (job: Job, work: (more: () => boolean) => boolean) =>
        Effect.suspend(() => {
          const done = Deferred.makeUnsafe<boolean>();
          asks.push({ job, work, done });
          asked.openUnsafe();
          return Deferred.await(done);
        });

      /**
       * The lane's copy for a job at `at`: the one it holds while the stored `rev` is its own, or
       * else the stored state read; for its owner's open or batch (`maker`) where none is stored, a
       * new one, unsaved. Undefined for no state; null for one that does not read, which is logged.
       */
      const copyOf = (lane: Lane, at: number, maker: Playing | null) =>
        Effect.gen(function* () {
          const { key, player, played } = lane;
          const found = yield* store.read(player, played.id);
          if (Option.isSome(found) && lane.copy?.rev === found.value.rev) return lane.copy;
          if (Option.isNone(found)) {
            // Nothing stored: only a new copy, not yet stored, still stands.
            if (lane.copy?.rev !== null) lane.copy = undefined;
            if (maker === null) return undefined;
            if (lane.copy !== undefined) return lane.copy;
            const text = played.create(ctxOf(maker, at, yield* dice, 0, yield* store.awards(player)));
            const held = played.read(text);
            return held && (lane.copy = { rev: null, text, guest: maker.guest, at, held, unsaved: true });
          }
          lane.copy = undefined;
          const { rev, state, guest } = found.value;
          const held = played.read(state);
          if (held === null) {
            yield* Effect.logError(
              `The ${played.id} state stored for ${player} does not read; it is kept as it is`,
            ).pipe(Effect.annotateLogs({ player, game: played.id, rev }));
          }
          // Whether the state as stored stands still: would never go on by itself, however long.
          if (
            played.tends &&
            (held === null || !held.run(ctxOf({ playerId: player, guest }, Infinity, 0, 0, []), () => false))
          ) {
            stills.set(key, rev);
          } else stills.delete(key);
          return held && (lane.copy = { rev, text: state, guest, at, held, unsaved: false });
        });

      /**
       * The lane's copy (`copyOf`) brought to the job's moment, a slice at a time (`slice`) for as
       * long as the game says there is further to go, with what its owner has won; or none.
       */
      const brought = (lane: Lane, job: Job, at: number, maker: Playing | null) =>
        Effect.gen(function* () {
          const copy = yield* copyOf(lane, at, maker);
          if (!copy) return copy;
          const awards = yield* store.awards(lane.player);
          // Tending is no call: it gets no dice.
          const ctx = ctxOf({ playerId: lane.player, guest: copy.guest }, at, 0, 0, awards);
          copy.at = at;
          if (copy.held.run(ctx, () => false)) {
            copy.unsaved = true;
            for (let more = true; more;) more = yield* slice(job, (time) => copy.held.run(ctx, time));
          }
          return { copy, awards };
        });

      /**
       * What of a command's Leaf the ledger is to take (the spends whose keys it has not seen), or
       * why none may be: `leaf_closed` or `not_enough_leaf`. A spend that is not a whole number of
       * Leaf above 0 is the game's defect.
       */
      const leafOf = (playing: Playing, played: Played, spends: readonly LeafSpend[]) =>
        Effect.gen(function* () {
          if (spends.length === 0) return [];
          if (!gameLeafSpending || playing.guest) return "leaf_closed";
          const unseen: Taken[] = [];
          for (const { amount, reason, key } of spends) {
            if (!isLeaf(amount)) {
              return yield* Effect.die(new Error(`A ${played.id} command took ${amount} Leaf`));
            }
            const taken = { amount, reason, key: `play:${played.id}:${playing.playerId}:${key}` };
            if (!(yield* ledger.isRecorded(taken.key))) unseen.push(taken);
          }
          const { balance } = yield* ledger.account(playing.playerId);
          return unseen.reduce((sum, spend) => sum + spend.amount, 0) > balance ? "not_enough_leaf" : unseen;
        });

      /**
       * Does a batch of commands to the lane's copy at `at`, opened with the dice `seed`, and keeps it
       * in one transaction: the copy, if it changed, written over the `rev` it came from (a new one
       * stored first), and whatever else changed with it.
       */
      const batch = (
        lane: Lane,
        copy: Copy,
        playing: Playing,
        sent: readonly Sent[],
        at: number,
        awards: readonly string[],
        seed: number,
      ) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const { played } = lane;
              if (copy.rev === null) {
                // A new state, stored first, and the player's Coins opened with the welcome.
                if (!(yield* store.create(playing.playerId, played.id, copy.text, playing.guest, at))) {
                  return yield* Effect.die(
                    new Error(`A ${played.id} state for ${playing.playerId} was made meanwhile`),
                  );
                }
                yield* coins.open(playing.playerId, at);
                copy.rev = 0;
              }
              const over = copy.rev;
              let room = yield* coins.room(playing.playerId, at);
              const ctx = (roll: number, left: number): Ctx => ctxOf(playing, at, roll, left, awards);
              const game = copy.held.open(ctx(seed, room));
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
                const attempt = game.attempt(command, ctx(yield* dice, room));
                const leaf = "refused" in attempt ? [] : yield* leafOf(playing, played, attempt.leaf);
                const amounts = "refused" in attempt ? null : payable(attempt.coins, balance, room);
                let result: Result;
                if ("refused" in attempt) {
                  result = { id, refused: attempt.refused };
                } else if (typeof leaf === "string") {
                  // Leaf that may not be taken: the command is not done at all.
                  result = { id, refused: leaf };
                } else if (amounts === null) {
                  // A command that takes Coins the player does not have is not done at all.
                  result = { id, refused: "not_enough_coins" };
                } else {
                  attempt.keep();
                  for (const { amount, reason, key } of leaf) {
                    const posted = yield* ledger.post(
                      {
                        kind: "spend",
                        playerId: playing.playerId,
                        amount,
                        sink: "shop",
                        idempotencyKey: key,
                        memo: reason,
                      },
                      at,
                    );
                    if (posted.status === "rejected") {
                      // Weighed in this transaction: the batch is undone whole.
                      return yield* Effect.die(new Error(`The ledger refused ${key}: ${posted.reason}`));
                    }
                    logs.push({ kind: LOGGED.leafSpent, data: { leaf: amount, reason } });
                  }
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
                      at,
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
              if (after !== copy.text) {
                if (!(yield* store.write(playing.playerId, played.id, over, after, playing.guest, at))) {
                  return yield* Effect.die(
                    new Error(`The ${played.id} state of ${playing.playerId} changed underfoot`),
                  );
                }
                copy.rev = over + 1;
                copy.text = after;
                copy.guest = playing.guest;
                const standing = game.standing();
                if (standing !== null) {
                  yield* store.stand(playing.playerId, played.id, standing, playing.guest, at);
                }
                const won = game.awards().filter((id) => !awards.includes(id));
                yield* store.award(playing.playerId, won, at);
              }
              copy.unsaved = false;
              yield* store.log(playing.playerId, played.id, logs, at);
              for (const { id, result } of answers) {
                yield* store.answer(playing.playerId, played.id, id, copy.rev, keptOf(result));
              }
              if (answers.length > 0) {
                yield* store.keepNewest(playing.playerId, played.id);
              }
              // Counted for the staff's report: each command done or refused now, not those answered from before.
              const refused = answers.filter((a) => "refused" in a.result).length;
              yield* store.count(playing.playerId, answers.length - refused, refused, at);
              return { now: at, rev: copy.rev, results, view: game.view(ctx(0, room)) };
            }),
          )
          .pipe(Effect.orDie);

      /** Writes the lane's copy if the job leaves its line empty with the copy unsaved, as a batch of no commands from its owner keeps it. */
      const settle = (lane: Lane) =>
        Effect.gen(function* () {
          const { copy } = lane;
          if (lane.jobs.length > 1 || copy?.unsaved !== true) return;
          const owner = { playerId: lane.player, guest: copy.guest };
          // Leaf keeping a copy is no call: it gets no dice.
          yield* batch(lane, copy, owner, [], copy.at, yield* store.awards(lane.player), 0);
        });

      /** Does a lane's jobs one at a time, in the order they came, and lets it go when its line is empty. */
      const drain = (lane: Lane) =>
        Effect.gen(function* () {
          for (let job = lane.jobs[0]; job !== undefined; job = lane.jobs[0]) {
            // Anything gone wrong drops the copy: the next job reads what is stored.
            if (!(yield* job.run)) lane.copy = undefined;
            lane.jobs.shift();
          }
          lanes.delete(lane.key);
        }).pipe(
          // Stopped (Leaf is stopping): every job still in the line is answered so.
          Effect.onExit(() => Effect.sync(() => lane.jobs.forEach((job) => job.stop()))),
        );

      /** Counts the caller's time in a game up to a moment (`PlayStore.heard`). */
      const heard = (playing: Playing, played: Played, at: number) => store.heard(playing.playerId, played.id, at);

      /**
       * Puts a job in the line of `player`'s state in a game, at once and with the moment it
       * arrived, starting the lane if it had none; counts the caller's time for a call; and waits for
       * the answer, which `work` gives once the copy is saved. All but a batch are never done once
       * their caller has gone.
       */
      const ask = <A>(
        kind: "open" | "visit" | "batch" | "tend",
        player: PlayerId,
        played: Played,
        caller: Playing | null,
        work: (lane: Lane, job: Job, at: number) => Effect.Effect<() => A>,
      ) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const key = keyOf(player, played);
            const idle = lanes.get(key);
            const lane = idle ?? { key, player, played, jobs: [], copy: undefined };
            const at = clock.currentTimeMillisUnsafe();
            const done = Deferred.makeUnsafe<A>();
            const job: Job = {
              tend: kind === "tend",
              seq: ++arrivals,
              gone: false,
              run: Effect.gen(function* () {
                if (job.gone) return Exit.isSuccess(yield* Effect.exit(settle(lane)));
                const exit = yield* Effect.exit(
                  Effect.flatMap(work(lane, job, at), (answer) => Effect.map(settle(lane), answer)),
                );
                Deferred.doneUnsafe(done, exit);
                return Exit.isSuccess(exit);
              }),
              stop: () => void Deferred.doneUnsafe(done, Exit.interrupt()),
            };
            lane.jobs.push(job);
            if (idle === undefined) {
              lanes.set(key, lane);
              yield* Effect.forkIn(drain(lane), scope);
            }
            return yield* restore(
              Effect.andThen(caller === null ? Effect.void : heard(caller, played, at), Deferred.await(done)),
            ).pipe(Effect.onError(() => Effect.sync(() => void (job.gone = kind !== "batch"))));
          }),
        );

      return Play.of({
        open: (playing, played) =>
          ask("open", playing.playerId, played, playing, (lane, job, at) =>
            Effect.gen(function* () {
              const got = yield* brought(lane, job, at, playing);
              if (!got) return (): Opening => ({ status: "unreadable" });
              const room = yield* coins.room(playing.playerId, at);
              const ctx = (seed: number): Ctx => ctxOf(playing, at, seed, room, got.awards);
              const seed = yield* dice;
              return (): Opening => {
                const view = got.copy.held.open(ctx(seed)).view(ctx(0));
                // A new state not yet stored, a batch behind it in the line, is one nothing has been done to.
                return { status: "open", rev: got.copy.rev ?? 0, now: at, view };
              };
            }),
          ),
        send: (playing, played, commands) =>
          Effect.gen(function* () {
            const sent = sentOf(played, commands);
            if (typeof sent === "string") {
              return { status: "invalid", why: sent } satisfies Batch;
            }
            // A batch that would take the player past either allowance is refused whole.
            if (!pace.take(playing.playerId, yield* Clock.currentTimeMillis, [1, sent.length])) {
              return { status: "slow" } satisfies Batch;
            }
            return yield* ask("batch", playing.playerId, played, playing, (lane, job, at) =>
              Effect.gen(function* () {
                const got = yield* brought(lane, job, at, playing);
                if (!got) return (): Batch => ({ status: "unreadable" });
                const done = yield* batch(lane, got.copy, playing, sent, at, got.awards, yield* dice);
                return (): Batch => ({ status: "done", ...done });
              }),
            );
          }),
        visit: (player, played, caller) =>
          Effect.gen(function* () {
            if (!pace.take(caller.playerId, yield* Clock.currentTimeMillis, [1, 0])) {
              return { status: "slow" } satisfies Visiting;
            }
            return yield* ask("visit", player, played, caller, (lane, job, at) =>
              Effect.gen(function* () {
                const got = yield* brought(lane, job, at, null);
                if (!got) return (): Visiting => ({ status: got === null ? "unreadable" : "nothing" });
                // Nothing is earned by a visit: the call may pay none.
                const ctx = (seed: number): Ctx => ctxOf(caller, at, seed, 0, got.awards);
                const seed = yield* dice;
                return (): Visiting => {
                  const { visit } = got.copy.held.open(ctx(seed));
                  const rev = got.copy.rev ?? 0;
                  return visit === null ? { status: "nothing" } : { status: "open", rev, now: at, view: visit(ctx(0)) };
                };
              }),
            );
          }),
        tend: (games) =>
          Effect.gen(function* () {
            const began = yield* Clock.currentTimeMillis;
            let tended = 0;
            for (const played of games) {
              if (!played.tends) continue;
              for (const { playerId, rev } of yield* store.unwritten(played.id, began - TEND_AFTER)) {
                if (stills.get(keyOf(playerId, played)) === rev) continue;
                // One state that fails is logged, and the others are tended all the same.
                yield* ask("tend", playerId, played, null, (lane, job, at) =>
                  Effect.as(brought(lane, job, at, null), () => undefined),
                ).pipe(
                  Effect.catchDefect((defect) =>
                    Effect.logError(`Tending the ${played.id} state of ${playerId} failed`, defect).pipe(
                      Effect.annotateLogs({ player: playerId, game: played.id }),
                    ),
                  ),
                );
                tended++;
              }
            }
            if (tended > 0) {
              const took = (yield* Clock.currentTimeMillis) - began;
              yield* Effect.logInfo("tended").pipe(Effect.annotateLogs({ states: tended, took_ms: took }));
            }
          }),
      });
    }),
  );
}
