import {
  type Balances,
  type CoinChange,
  COMMAND_ID,
  type Ctx,
  isLeaf,
  type Leaf,
  LOGGED,
  type Logged,
  mayBuy,
  MOST_FLUSHED,
  type PlayerId,
  type ToClient,
  visitRoom,
} from "@sequoia-leaf/core";
import {
  Cause,
  Clock,
  Context,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Latch,
  Layer,
  Metric,
  Option,
  Schema,
} from "effect";
import { SecureRandom } from "effect/crypto";
import { SqlClient } from "effect/sql";

import { Allowances } from "../allowance.ts";
import { AppConfig } from "../config.ts";
import { Ledger } from "../ledger/store.ts";
import { Watchers } from "../live/watchers.ts";
import { type CommandOutcome, type JobPhase, playCommands, playJobSeconds } from "../metrics.ts";
import { type CoinEntry, Coins } from "./coins.ts";
import { Copies } from "./copies.ts";
import type { Attempt, Held, Played } from "./games.ts";
import { nextSlice } from "./slices.ts";
import { PlayStore } from "./store.ts";

/** How often a player may send a batch of commands: ten a second, bursts of twenty. */
export const BATCHES = { rate: 10, burst: 20 } as const;
/** How many commands a player may have done, across all games: ten a second, bursts of forty. */
export const COMMANDS = { rate: 10, burst: 40 } as const;
/** How many players' allowances are kept before those filled up again are let go. */
const ALLOWANCES_KEPT = 1000;
/** How often a page saying its copy was not Leaf's state is logged, for a player and a game: once a minute. */
const DIFFERENCES = { rate: 1 / 60, burst: 1 } as const;
/**
 * How long a state of a game that tends its states (`Game.tend`) may go unwritten before Leaf tends
 * it itself: long enough that one whose player's page is open, sending a command now and then, is
 * left to the page.
 */
export const TEND_AFTER = 2 * 60_000;
/**
 * How long one slice of running states on lasts, in nanoseconds; between two, the thread takes one
 * turn, so that whatever waits for it (a request, a room's tick, a timer) goes first. One slice runs
 * at a time for every state and every job together. Live's rooms answer every 16 ms, and a slice
 * can hold up each step of a move on its way: 2 ms keeps them as they are.
 */
const SLICE_NS = 2_000_000n;
/**
 * How many slices for players' jobs (a yard somebody has open, or a visitor waits on) a waiting
 * tend lets go first; the next is its own: Leaf's own tending takes one slice in eight while a
 * player waits on one.
 */
const TEND_WAITS = 7;
/** How many times in all a job is done, each from what is stored, when what is stored moves on under it. */
const TRIES = 3;
/**
 * How much stored text the copies held past their lanes may come to in all before the one used
 * least lately is let go: 4 MiB, about a thousand of the largest yards, which held decoded come to
 * about 50 MiB (a large yard's 4 KiB of text is about 46 KiB in memory).
 */
export const HELD_TEXT_BYTES = 4 * 1024 * 1024;

/** What is stored moved on while a job worked from its copy: another Leaf wrote it, or a tool did. */
class Lost extends Data.TaggedError("Lost") {}

/** A player's state in a game as its lane holds it in memory. */
interface Copy {
  /**
   * The stored `rev` it came from (null for a new state, stored by the first write), the text
   * stored at it, whether its player was a guest then, and when the stored state was made (its
   * generation: null for a new one, made as its first write is).
   */
  rev: number | null;
  text: string;
  guest: boolean;
  born: number | null;
  /** The moment it has been brought to. */
  at: number;
  readonly held: Held;
  /** Whether it has been run on past what is stored. */
  unsaved: boolean;
}

/** One thing asked of a lane: an open, a visit, a batch of commands, or Leaf's own tend. */
interface Job {
  readonly kind: Kind;
  /** The lane whose line it is in. */
  readonly lane: Lane;
  /** Its place among the arrivals of every lane's jobs. */
  readonly seq: number;
  /** The moment it arrived, read once, as it took its place; and on the monotonic clock, in nanoseconds. */
  readonly at: number;
  readonly arrived: bigint;
  /**
   * Where its time has gone so far, in nanoseconds: waiting (for its turn, then for slices), running
   * the state on in its slices, reading and writing the state's text, and in SQLite.
   */
  waited: bigint;
  simulated: bigint;
  coded: bigint;
  sqlite: bigint;
  /** All but a batch: its caller has gone while it waited, and it is never done. */
  gone: boolean;
  /** Does it, saves the copy if it leaves the line empty, then answers it. */
  readonly run: Effect.Effect<void>;
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

/** Which job it is: a player's open, visit or batch, or Leaf's own tend. */
export type Kind = "open" | "visit" | "batch" | "tend";
/** Where a job's answer is shared, under its key, with the same job asked for again while it waits. */
interface Shared<A> {
  readonly answers: Map<string, Deferred.Deferred<A>>;
  readonly key: string;
}

/** What a job does, given the job: its answer, given once the copy is saved. */
type Work<A> = (job: Job) => Effect.Effect<() => A, Lost>;

/** A slice of running a state on, asked for by a lane's job, when it was asked for (monotonic, in nanoseconds). */
interface Ask {
  readonly job: Job;
  readonly asked: bigint;
  readonly work: (more: () => boolean) => boolean;
  readonly done: Deferred.Deferred<boolean>;
}

/**
 * Where one job's time went, in milliseconds, from its arrival to its answer: `waited` for its turn
 * in its line and for slices, `sqlite` reading the state and in the batch's transaction, and
 * `worked`, the rest (the rules, their text, the other reads, Leaf's own code).
 */
export interface JobTimes {
  readonly game: string;
  readonly kind: Kind;
  readonly waited: number;
  readonly sqlite: number;
  readonly worked: number;
}

/** Told where each job's time went (`JobTimes`), for the load test; nobody is, unless given. */
export const PlayMeter = Context.Reference<((times: JobTimes) => void) | null>("leaf/PlayMeter", {
  defaultValue: () => null,
});

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

/**
 * A player's state in a game as their page is given it: how many batches changed it, Leaf's clock,
 * the view, and the caller's balances as they stood when it was answered (for a batch, as its
 * transaction left them).
 */
export interface Shown {
  readonly rev: number;
  readonly now: number;
  readonly view: unknown;
  readonly purse: Balances;
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

/**
 * A key a command gives its Coins or Leaf, named for the state it came from: a game's key often
 * counts something kept in the state (`lantern:3`), which starts again in a state made again, so
 * the state's generation (`born`) goes before it; but for a state made before Leaf kept that (0),
 * whose keys stay as they were.
 */
const ofState = (born: number, key: string): string => (born === 0 ? key : `${born}:${key}`);

/** Nanoseconds in milliseconds. */
const msOf = (ns: bigint) => Number(ns) / 1e6;

/** What spends come to, in Leaf. */
const sum = (spends: readonly Taken[]) => spends.reduce((all, spend) => all + spend.amount, 0);

/** Whether a state stands still: would never go on by itself, however long. */
const standsStill = (held: Held, player: PlayerId, guest: boolean) =>
  !held.run(ctxOf({ playerId: player, guest }, Infinity, 0, 0, []), () => false);

/** A tend that failed, logged (whose, and of which game) as the sweep's tends are waited for: the others go on. */
const failed = (player: PlayerId, game: string, defect: unknown) =>
  Effect.annotateLogs(Effect.logError(`Tending the ${game} state of ${player} failed`, defect), { player, game });

/** Counts `n` play commands of a game by what became of them. */
const outcome = (game: string, what: CommandOutcome, n: number) =>
  n === 0 ? Effect.void : Metric.update(playCommands({ game, outcome: what }), n);

/** The commands of a batch with their ids, or why the batch is not one. */
function sentOf(played: Played, commands: readonly unknown[]): readonly Sent[] | string {
  if (commands.length > MOST_FLUSHED) {
    return `A batch holds at most ${MOST_FLUSHED} commands`;
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
 * has won for good (`Game.awards`), which every game is told on every call. A batch is answered
 * with each command's answer and the game's answer to it (`Game.answer`), or for a game without one
 * its view; an opening and a visit always with the view. A command whose id
 * was seen before answers as it did then and changes nothing; one whose Coins changes, added to the
 * balance in order, would take it below nothing at any point is refused with `not_enough_coins`;
 * one that pays is done whatever the player has earned, and paid only as far as they may still earn
 * (`Coins.room`, which each game is told, so that it says what was really paid), but for a change
 * that is `free`, which is paid whole and uses none of it. A command may take Leaf (`Done.leaf`), never
 * pay it in: it is refused `leaf_closed` while `GAME_LEAF_SPENDING` is off, `members_only` when the
 * player is a guest and one of its spends is for members (`LeafSpend.for`), and `not_enough_leaf`
 * when its spends come to more than the ledger's balance; otherwise each is
 * posted to the ledger as a spend on the `shop` sink, keyed `play:<game>:<player>:<born>:<key>` (`ofState`), and logged
 * (`leaf_spent`). A key the ledger has seen is not taken again, and the command stands. Leaf earns no
 * XP and uses none of the Coins' room. A player with no state yet gets a new one,
 * and their Coins open with the welcome as it is made. A stored state that will not read is left as
 * it is: the player and the game are logged, and nothing is done. Leaf's dice for each call come from
 * `SecureRandom`. A visitor (`visit`) is shown somebody's state, and is given nothing of theirs.
 * Everybody in the state's visit room (`visitRoom`, `Watchers`) is told each batch once it is kept,
 * for a game that echoes its commands (`Game.echo`): the live wire's `did`, with each command kept,
 * in order, as the game echoes it, and each one's id as its page gave it (so the owner's own page
 * knows its own), the stored `rev` after the batch, and the batch's answer. With
 * nobody there, nothing is made for them.
 *
 * Everything asked of one player's state in one game (an open, a visit, a batch, Leaf's own tend)
 * is a job in that state's lane (`Lane`), which holds at most one copy of it in memory (`Copy`).
 * A job takes its place in the lane's line as it arrives, with the moment it arrived, before
 * anything is waited for; the lane does them one at a time in that order. Doing one: the copy is
 * read from what is stored if there is none or the stored `rev` is no longer its own, run on to the
 * job's moment (a slice at a time, for a game that tends its states), and shown; or each of a
 * batch's commands is done to it in order, once it is run on to where the command is done, and
 * weighed against the balances as they stood before; and then a transaction checks and writes: the
 * stored `rev` first, then those balances, then what the batch did. The copy is written by a batch,
 * and whenever a job leaves the line empty with the copy unsaved, as a batch of no commands; nothing
 * else writes it. What is stored having moved on (`Lost`), nothing is written, and the job is done
 * again from it, `TRIES` times in all. Anything going wrong drops the copy. A batch is done whatever
 * becomes of its request; any other job whose caller has gone while it waited is never done.
 *
 * One slice of running states on (`SLICE_NS`) runs at a time, then one turn of the thread, so that
 * whatever waits for it goes first (`nextSlice`):
 * players' slices go round the states asking for one, in the order they asked (a tend with a
 * player's job behind it in its line runs for it), so a state far behind never holds up another's
 * command for all of its catching up; Leaf's own tends take one slice, the first tend's, after
 * each `TEND_WAITS` of those. Leaf puts a tend in the line of each state of a game that tends its
 * states that is due one (`due_at`: `TEND_AFTER` after it was written, never while it stands
 * still), but those with one in line, and waits for none; each reads nothing until its first turn.
 */
export class Play extends Context.Service<
  Play,
  {
    /**
     * The player's state in a game, made for them if they have none. `differs` is the tick at which
     * their page found its copy not to be the state Leaf has: a fault in the rules, logged at most
     * once a minute for a player and a game.
     */
    readonly open: (playing: Playing, played: Played, differs?: number) => Effect.Effect<Opening>;
    /** Does a batch of commands, as they came off the wire. */
    readonly send: (playing: Playing, played: Played, commands: readonly unknown[]) => Effect.Effect<Batch>;
    /** Another player's state in a game, as a visitor (`caller`) is given it. Takes one of the caller's batches. */
    readonly visit: (player: PlayerId, played: Played, caller: Playing) => Effect.Effect<Visiting>;
    /** Puts a tend in the line of each of these games' states due one, and is done; what it gives back waits for them. */
    readonly tend: (games: readonly Played[]) => Effect.Effect<Effect.Effect<void>>;
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
      const watchers = yield* Watchers;
      const meter = yield* PlayMeter;
      const scope = yield* Effect.scope;
      const dice = random.intBetween(0, 0xffffffff);
      // Each player's batches and commands, across all games.
      const pace = new Allowances([BATCHES, COMMANDS], ALLOWANCES_KEPT);
      // Each player's and game's differences logged.
      const differed = new Allowances([DIFFERENCES], ALLOWANCES_KEPT);
      // Every lane, by `keyOf`; and how many jobs have arrived, in all of them.
      const lanes = new Map<string, Lane>();
      let arrivals = 0;
      // The copies of states whose lanes have let go, by `keyOf`, for each state's next job.
      const copies = new Copies<Copy>(HELD_TEXT_BYTES);

      // The one budget: the slices asked for, and how many players' slices a waiting tend has let go.
      const asks: Ask[] = [];
      const asked = yield* Latch.make(false);
      const nanos = () => clock.monotonicTimeNanosUnsafe();
      let waited = 0;
      /** Whose a slice is: the oldest player's job waiting in the line of the lane that asks, or else its own. */
      const whose = (ask: Ask) => ask.job.lane.jobs.find((job) => job.kind !== "tend" && !job.gone) ?? ask.job;
      /** The slice to run next, taken from those asked for (`nextSlice`). */
      const nextAsk = () => {
        const weighed = asks.map((ask) => {
          const job = whose(ask);
          return { tend: job.kind === "tend", seq: job.seq };
        });
        const turn = nextSlice(weighed, waited, TEND_WAITS);
        if (turn === null) return undefined;
        waited = turn.waited;
        return asks.splice(turn.index, 1)[0];
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
            ask.job.waited += began - ask.asked;
            const ran = yield* Effect.exit(Effect.sync(() => ask.work(() => nanos() - began < SLICE_NS)));
            ask.job.simulated += nanos() - began;
            Deferred.doneUnsafe(ask.done, ran);
            // One turn of the thread: whatever waits for it runs before the next slice; with nothing
            // waiting, the next comes at once.
            yield* Effect.yieldNow;
          }
        }),
        scope,
      );
      /** Does `effect` for a job, its time counted as the job's in SQLite. */
      const inSqlite = <A, E>(job: Job, effect: Effect.Effect<A, E>) =>
        Effect.suspend(() => {
          const began = nanos();
          return Effect.ensuring(
            effect,
            Effect.sync(() => void (job.sqlite += nanos() - began)),
          );
        });
      /** Does `make` for a job, its time counted as the job's reading or writing the state's text. */
      const coded = <A>(job: Job, make: () => A): A => {
        const began = nanos();
        try {
          return make();
        } finally {
          job.coded += nanos() - began;
        }
      };
      /** Counts where a job's time went (`leaf_play_job_seconds`), and tells the meter, if there is one. */
      const measured = (job: Job) =>
        Effect.suspend(() => {
          const total = nanos() - job.arrived;
          const game = job.lane.played.id;
          const phases: Record<JobPhase, bigint> = {
            queue: job.waited,
            simulation: job.simulated,
            codec: job.coded,
            sqlite: job.sqlite,
            other: total - job.waited - job.simulated - job.coded - job.sqlite,
          };
          meter?.({
            game,
            kind: job.kind,
            waited: msOf(job.waited),
            sqlite: msOf(job.sqlite),
            worked: msOf(total - job.waited - job.sqlite),
          });
          return Effect.forEach(
            Object.entries(phases),
            ([phase, ns]) =>
              Metric.update(playJobSeconds({ game, kind: job.kind, phase }), Math.max(0, Number(ns)) / 1e9),
            { discard: true },
          );
        });

      /** Runs `work` for a job when its slice comes, and says what it said: whether there is further to go. */
      const slice = (job: Job, work: (more: () => boolean) => boolean) =>
        Effect.suspend(() => {
          const done = Deferred.makeUnsafe<boolean>();
          asks.push({ job, asked: nanos(), work, done });
          asked.openUnsafe();
          return Deferred.await(done);
        });

      /**
       * The lane's copy for a job at `at`: the one it holds while the stored `rev` is its own, or
       * else the stored state read; where none is stored, the new one it holds, unsaved, or for its
       * owner's open or batch (`maker`) one made now. Undefined for no state; null for one that does
       * not read, which is logged.
       */
      const copyOf = (job: Job, maker: Playing | null) =>
        Effect.gen(function* () {
          const { lane, at } = job;
          const { player, played } = lane;
          // While the stored `rev` is the copy's own, the copy is the state: nothing more is read.
          const storedAt = yield* inSqlite(job, store.revOf(player, played.id));
          if (Option.isSome(storedAt) && lane.copy?.rev === storedAt.value) return lane.copy;
          const found = Option.isNone(storedAt) ? Option.none() : yield* inSqlite(job, store.read(player, played.id));
          if (Option.isNone(found)) {
            // Nothing stored: only a new copy, not yet stored, still stands, whoever asks.
            if (lane.copy?.rev !== null) lane.copy = undefined;
            if (lane.copy !== undefined || maker === null) return lane.copy;
            // The player's Coins open with the welcome as their first state is made.
            yield* coins.open(player, at);
            const ctx = ctxOf(maker, at, yield* dice, 0, yield* store.awards(player));
            const text = coded(job, () => played.create(ctx));
            const held = coded(job, () => played.read(text));
            return held && (lane.copy = { rev: null, text, guest: maker.guest, born: null, at, held, unsaved: true });
          }
          lane.copy = undefined;
          const { rev, state, guest, born, dueAt } = found.value;
          const held = coded(job, () => played.read(state));
          if (held === null) {
            yield* Effect.logError(
              `The ${played.id} state stored for ${player} does not read; it is kept as it is`,
            ).pipe(Effect.annotateLogs({ player, game: played.id, rev }));
          }
          // A state stored due a tend that stands still is due none until it is written again.
          if (dueAt !== null && (held === null || standsStill(held, player, guest))) {
            yield* inSqlite(job, store.rest(player, played.id, rev));
          }
          return held && (lane.copy = { rev, text: state, guest, born, at, held, unsaved: false });
        });

      /** Runs the job's copy on to its moment, or to where `command` is done, a slice at a time while there is further to go. */
      const runOn = (job: Job, copy: Copy, awards: readonly string[], command?: unknown) =>
        Effect.gen(function* () {
          // Running on is no call: it gets no dice.
          const ctx = ctxOf({ playerId: job.lane.player, guest: copy.guest }, copy.at, 0, 0, awards);
          if (!copy.held.run(ctx, () => false, command)) return;
          copy.unsaved = true;
          for (let more = true; more;) more = yield* slice(job, (time) => copy.held.run(ctx, time, command));
        });

      /** The lane's copy (`copyOf`) brought to the job's moment (`runOn`), with what its owner has won; or none. */
      const brought = (job: Job, maker: Playing | null) =>
        Effect.gen(function* () {
          const copy = yield* copyOf(job, maker);
          if (!copy) return copy;
          const awards = yield* store.awards(job.lane.player);
          copy.at = job.at;
          yield* runOn(job, copy, awards);
          return { copy, awards };
        });

      /**
       * Does a batch's commands to the job's copy with the dice `seed`, each once the copy is run on to
       * it (`runOn`) and weighed against the balances as they were before (`weigh`); then keeps it in a
       * transaction that only checks and writes, or fails `Lost` when what is stored moved on.
       */
      const batch = (job: Job, copy: Copy, playing: Playing, sent: readonly Sent[], seed: number) =>
        Effect.gen(function* () {
          const { player, played } = job.lane;
          const { at } = copy;
          // The state's generation: a new one is made, by this batch's transaction, at `at`.
          const born = copy.born ?? at;
          const awards = yield* store.awards(player);
          const against = { coins: yield* coins.balance(player), room: yield* coins.room(player, at) };
          // The ledger's balance, read once a command takes Leaf.
          let leaf: number | null = null;
          let { coins: balance, room } = against;
          const ctx = (roll: number, left: number): Ctx => ctxOf(playing, at, roll, left, awards);
          const game = copy.held.open(ctx(seed, room));
          const results: Result[] = [];
          const answers: { readonly id: string; readonly result: Result }[] = [];
          const entries: CoinEntry[] = [];
          const taken: Taken[] = [];
          const logs: Logged[] = [];
          // Everybody visiting the state hears what the batch did, if anybody does: each command kept, as the game echoes it.
          const visitors = played.echoes ? visitRoom(played.id, player) : null;
          const echoes: unknown[] | null = visitors !== null && watchers.heard(visitors) ? [] : null;
          // And each one's id, as the page that sent it gave it.
          const echoed: string[] = [];
          /**
           * A command the rules did, refused `leaf_closed`, `members_only`, `not_enough_leaf` (its spends whose keys the
           * ledger and the batch have not seen, past the balance less what the batch took) or
           * `not_enough_coins` (`payable`), or kept. A spend not a whole number of Leaf above 0 is a defect.
           */
          const weigh = (id: string, did: Exclude<Attempt, { readonly refused: string }>) =>
            Effect.gen(function* () {
              if (did.leaf.length > 0 && !gameLeafSpending) return { id, refused: "leaf_closed" };
              if (!did.leaf.every((spend) => mayBuy(spend.for, playing.guest))) return { id, refused: "members_only" };
              const spends: Taken[] = [];
              for (const { amount, reason, key } of did.leaf) {
                if (!isLeaf(amount)) return yield* Effect.die(new Error(`A ${played.id} command took ${amount} Leaf`));
                const spend = { amount, reason, key: `play:${played.id}:${player}:${ofState(born, key)}` };
                if (!taken.some((t) => t.key === spend.key) && !(yield* ledger.isRecorded(spend.key)))
                  spends.push(spend);
              }
              if (spends.length > 0 && sum(spends) + sum(taken) > (leaf ??= (yield* ledger.account(player)).balance)) {
                return { id, refused: "not_enough_leaf" };
              }
              const amounts = payable(did.coins, balance, room);
              if (amounts === null) return { id, refused: "not_enough_coins" };
              did.keep();
              if (echoes) {
                echoes.push(did.echo());
                echoed.push(id);
              }
              taken.push(...spends);
              for (const { amount, reason } of spends)
                logs.push({ kind: LOGGED.leafSpent, data: { leaf: amount, reason } });
              for (const [n, change] of did.coins.entries()) {
                // Past what the player may still earn, the command is done all the same and pays what is left.
                const amount = amounts[n] ?? 0;
                const key = `${played.id}:${player}:${ofState(born, change.key)}`;
                // A change whose key was paid before is not paid again, and the command stands.
                if (amount === 0 || entries.some((e) => e.key === key) || (yield* coins.posted(key))) continue;
                const free = change.free === true;
                entries.push({ amount, reason: change.reason, game: played.id, key, free });
                balance += amount;
                room -= free ? 0 : Math.max(0, amount);
              }
              logs.push(...did.log);
              return { id, notes: did.notes };
            });
          for (const { id, command } of sent) {
            const before = yield* store.answered(player, played.id, id);
            if (Option.isSome(before)) {
              results.push({ id, ...readKept(before.value) });
              continue;
            }
            yield* runOn(job, copy, awards, command);
            const attempt = game.attempt(command, ctx(yield* dice, room));
            // A command refused, by the rules or for Leaf or Coins, is not done at all.
            const result = "refused" in attempt ? { id, refused: attempt.refused } : yield* weigh(id, attempt);
            results.push(result);
            answers.push({ id, result });
          }
          const text = coded(job, () => game.text());
          const changed = text !== copy.text;
          const standing = changed ? game.standing() : null;
          const won = changed ? game.awards().filter((id) => !awards.includes(id)) : [];
          // A state that goes on by itself is Leaf's to tend once no page has kept it up for a while.
          const dueAt = played.tends && !standsStill(copy.held, player, playing.guest) ? at + TEND_AFTER : null;
          const { rev, purse } = yield* inSqlite(
            job,
            sql.withTransaction(
              Effect.gen(function* () {
                // What is stored first: the copy is kept over the `rev` it came from, or as the first state.
                const first =
                  copy.rev === null
                    ? store.create(player, played.id, copy.text, playing.guest, at, dueAt)
                    : store.isAt(player, played.id, copy.rev);
                if (!(yield* first)) return yield* new Lost();
                // Then the balances the commands were weighed against.
                if (
                  answers.length > 0 &&
                  ((yield* coins.balance(player)) !== against.coins ||
                    (yield* coins.room(player, at)) !== against.room ||
                    (leaf !== null && (yield* ledger.account(player)).balance !== leaf))
                ) {
                  return yield* new Lost();
                }
                const next = (copy.rev ?? 0) + (changed ? 1 : 0);
                if (changed) {
                  yield* store.write(player, played.id, text, playing.guest, at, dueAt);
                  if (standing !== null) yield* store.stand(player, played.id, standing, playing.guest, at);
                  yield* store.award(player, won, at);
                }
                for (const { id, result } of answers) {
                  // An answer kept for it already: another Leaf did it at this `rev`.
                  if (!(yield* store.answer(player, played.id, id, next, keptOf(result)))) return yield* new Lost();
                }
                if (answers.length > 0) yield* store.keepNewest(player, played.id);
                for (const { amount, reason, key } of taken) {
                  const posted = yield* ledger.post(
                    { kind: "spend", playerId: player, amount, sink: "shop", idempotencyKey: key, memo: reason },
                    at,
                  );
                  // Weighed against the balance this transaction checked: a refusal is a defect.
                  if (posted.status === "rejected")
                    return yield* Effect.die(new Error(`The ledger refused ${key}: ${posted.reason}`));
                }
                for (const entry of entries) yield* coins.post(player, entry, at);
                yield* store.log(player, played.id, logs, at);
                // Counted for the staff's report: each command done or refused now, not those answered from before.
                const refused = answers.filter((a) => "refused" in a.result).length;
                yield* store.count(player, answers.length - refused, refused, at);
                // The balances as the batch leaves them, for the page: no other answer is needed.
                return { rev: next, purse: yield* coins.balances(player) };
              }),
            ),
          ).pipe(Effect.catchTag("SqlError", Effect.die));
          Object.assign(copy, { rev, text, guest: playing.guest, born, unsaved: false });
          const refusedNow = answers.filter((a) => "refused" in a.result).length;
          yield* outcome(played.id, "taken", answers.length - refusedNow);
          yield* outcome(played.id, "refused", refusedNow);
          let answered: unknown;
          const view = () => (answered ??= game.answer(ctx(0, room)));
          if (visitors !== null && echoes !== null && echoes.length > 0) {
            const did = { t: "did", rev, did: echoes, after: view(), ids: echoed } satisfies ToClient;
            watchers.tell(visitors, JSON.stringify(did));
          }
          return { now: at, rev, results, view, purse };
        });

      /** Writes the job's copy if it leaves its line empty with the copy unsaved, as a batch of no commands from its owner keeps it. */
      const settle = (job: Job) =>
        Effect.suspend(() => {
          const { jobs, copy, player } = job.lane;
          // Leaf keeping a copy is no call: it gets no dice.
          return jobs.length > 1 || copy?.unsaved !== true
            ? Effect.void
            : Effect.asVoid(batch(job, copy, { playerId: player, guest: copy.guest }, [], 0));
        });

      /** Does a lane's jobs one at a time, in the order they came, and lets it go when its line is empty. */
      const drain = (lane: Lane) =>
        Effect.gen(function* () {
          for (let job = lane.jobs[0]; job !== undefined; job = lane.jobs[0]) {
            yield* job.run;
            lane.jobs.shift();
          }
          lanes.delete(lane.key);
          // A copy as stored is held for the state's next job.
          if (lane.copy !== undefined && !lane.copy.unsaved && lane.copy.rev !== null) copies.put(lane.key, lane.copy);
        }).pipe(
          // Stopped (Leaf is stopping): every job still in the line is answered so.
          Effect.onExit(() => Effect.sync(() => lane.jobs.forEach((job) => job.stop()))),
        );

      /**
       * Puts a job in the line of `player`'s state in a game, at once and with the moment it arrived;
       * and gives back the wait for what `work` answers,
       * once the copy is saved. What is stored moving on (`Lost`), the job is done again, `TRIES` times
       * in all. All but a batch are never done once whoever waits has gone, but for saving the copy.
       */
      const line = <A>(kind: Kind, player: PlayerId, played: Played, work: Work<A>, shared?: Shared<A>) =>
        Effect.gen(function* () {
          const key = keyOf(player, played);
          const idle = lanes.get(key);
          const lane = idle ?? { key, player, played, jobs: [], copy: copies.take(key) };
          const done = Deferred.makeUnsafe<A>();
          shared?.answers.set(shared.key, done);
          const unshare = () => void shared?.answers.delete(shared.key);
          const again = <B>(effect: Effect.Effect<B, Lost>) =>
            effect.pipe(
              Effect.onError(() => Effect.sync(() => void (lane.copy = undefined))),
              Effect.retry({ times: TRIES - 1 }),
              Effect.orDie,
              Effect.exit,
            );
          const job: Job = {
            kind,
            lane,
            seq: ++arrivals,
            at: clock.currentTimeMillisUnsafe(),
            arrived: nanos(),
            waited: 0n,
            simulated: 0n,
            coded: 0n,
            sqlite: 0n,
            gone: false,
            run: Effect.suspend(() => {
              job.waited += nanos() - job.arrived;
              const doing = job.gone
                ? Effect.asVoid(again(settle(job)))
                : Effect.map(
                    again(Effect.flatMap(work(job), (then) => Effect.map(settle(job), then))),
                    (exit) => void Deferred.doneUnsafe(done, exit),
                  );
              return Effect.ensuring(doing, Effect.andThen(Effect.sync(unshare), measured(job)));
            }),
            stop: () => {
              unshare();
              Deferred.doneUnsafe(done, Exit.interrupt());
            },
          };
          lane.jobs.push(job);
          if (idle === undefined) {
            lanes.set(key, lane);
            yield* Effect.forkIn(drain(lane), scope);
          }
          return Deferred.await(done).pipe(Effect.onError(() => Effect.sync(() => void (job.gone = kind !== "batch"))));
        });

      /** A caller's job put in its line (`line`), and its answer waited for: only the waiting may be interrupted. */
      const ask = <A>(kind: Kind, player: PlayerId, played: Played, work: Work<A>, shared?: Shared<A>) =>
        Effect.uninterruptibleMask((restore) => Effect.flatMap(line(kind, player, played, work, shared), restore));
      // The answers to the batches in the lines, by lane and their commands' ids, for the same batch sent again.
      const sending = new Map<string, Deferred.Deferred<Batch>>();

      /** Leaf's own tend: its work, reading the state as much as running it on, waits for its turn (`slice`). */
      const tending: Work<void> = (job) =>
        slice(job, () => false).pipe(
          Effect.andThen(brought(job, null)),
          Effect.as(() => {}),
        );

      return Play.of({
        open: (playing, played, differs) =>
          ask("open", playing.playerId, played, (job) =>
            Effect.gen(function* () {
              const got = yield* brought(job, playing);
              if (!got) return (): Opening => ({ status: "unreadable" });
              const room = yield* coins.room(playing.playerId, job.at);
              const ctx = (seed: number): Ctx => ctxOf(playing, job.at, seed, room, got.awards);
              const seed = yield* dice;
              const purse = yield* coins.balances(playing.playerId);
              return (): Opening => {
                const view = got.copy.held.open(ctx(seed)).view(ctx(0));
                // A new state not yet stored, a batch behind it in the line, is one nothing has been done to.
                return { status: "open", rev: got.copy.rev ?? 0, now: job.at, view, purse };
              };
            }),
          ).pipe(
            Effect.ensuring(
              Effect.suspend(() =>
                differs === undefined ||
                !differed.take(keyOf(playing.playerId, played), clock.currentTimeMillisUnsafe(), [1])
                  ? Effect.void
                  : Effect.logWarning(`A page's copy of the ${played.id} state was not Leaf's`).pipe(
                      Effect.annotateLogs({ player: playing.playerId, game: played.id, tick: differs }),
                    ),
              ),
            ),
          ),
        send: (playing, played, commands) =>
          Effect.gen(function* () {
            const sent = sentOf(played, commands);
            if (typeof sent === "string") {
              yield* outcome(played.id, "invalid", commands.length);
              return { status: "invalid", why: sent } satisfies Batch;
            }
            // A batch that would take the player past either allowance is refused whole. A command
            // answered before changes nothing, and takes nothing of it: a page going away sends again
            // what may have come already.
            let fresh = 0;
            for (const { id } of sent)
              if (Option.isNone(yield* store.answered(playing.playerId, played.id, id))) fresh++;
            if (!pace.take(playing.playerId, yield* Clock.currentTimeMillis, [1, fresh])) {
              yield* outcome(played.id, "slow", sent.length);
              return { status: "slow" } satisfies Batch;
            }
            // The same commands sent again while their batch is still in its line (its page's wait ran out) wait for its answer.
            const same = `${keyOf(playing.playerId, played)} ${sent.map((one) => one.id).join(" ")}`;
            const inLine = sent.length > 0 ? sending.get(same) : undefined;
            if (inLine !== undefined) return yield* Deferred.await(inLine);
            // Its commands taken and refused are counted as its transaction keeps them; those of a batch
            // that could not be done, as failed.
            const failing = outcome(played.id, "failed", sent.length);
            const answered = yield* ask(
              "batch",
              playing.playerId,
              played,
              (job) =>
                Effect.gen(function* () {
                  const got = yield* brought(job, playing);
                  if (!got) return (): Batch => ({ status: "unreadable" });
                  const done = yield* batch(job, got.copy, playing, sent, yield* dice);
                  return (): Batch => ({ status: "done", ...done, view: done.view() });
                }),
              sent.length > 0 ? { answers: sending, key: same } : undefined,
            ).pipe(Effect.onError((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : failing)));
            if (answered.status === "unreadable") yield* failing;
            return answered;
          }),
        visit: (player, played, caller) =>
          Effect.gen(function* () {
            if (!pace.take(caller.playerId, yield* Clock.currentTimeMillis, [1, 0])) {
              return { status: "slow" } satisfies Visiting;
            }
            return yield* ask("visit", player, played, (job) =>
              Effect.gen(function* () {
                const got = yield* brought(job, null);
                if (!got) return (): Visiting => ({ status: got === null ? "unreadable" : "nothing" });
                // Nothing is earned by a visit: the call may pay none.
                const ctx = (seed: number): Ctx => ctxOf(caller, job.at, seed, 0, got.awards);
                const seed = yield* dice;
                const purse = yield* coins.balances(caller.playerId);
                return (): Visiting => {
                  const { visit } = got.copy.held.open(ctx(seed));
                  if (visit === null) return { status: "nothing" };
                  return { status: "open", rev: got.copy.rev ?? 0, now: job.at, view: visit(ctx(0)), purse };
                };
              }),
            );
          }),
        tend: (games) =>
          Effect.gen(function* () {
            const began = yield* Clock.currentTimeMillis;
            const ends: Effect.Effect<void>[] = [];
            for (const played of games) {
              if (!played.tends) continue;
              for (const player of yield* store.due(played.id, began)) {
                if (lanes.get(keyOf(player, played))?.jobs.some((job) => job.kind === "tend")) continue;
                const tended = yield* line("tend", player, played, tending);
                ends.push(Effect.catchDefect(tended, (defect) => failed(player, played.id, defect)));
              }
            }
            const ended = Effect.gen(function* () {
              yield* Effect.all(ends, { discard: true });
              const took = (yield* Clock.currentTimeMillis) - began;
              if (ends.length > 0)
                yield* Effect.annotateLogs(Effect.logInfo("tended"), { states: ends.length, took_ms: took });
            });
            return Fiber.join(yield* Effect.forkIn(ended, scope));
          }),
      });
    }),
  );
}
