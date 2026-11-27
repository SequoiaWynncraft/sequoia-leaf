import {
  campRoom,
  type CoinChange,
  type Ctx,
  type Done,
  type Game,
  type GameId,
  isRefused,
  type Kept,
  type LeafSpend,
  type Logged,
  type Meeting,
  newerThan,
  type PlayerId,
  type Standing,
  type ToClient,
  visitRoom,
} from "@sequoia-leaf/core";
import { rulesVersions } from "@sequoia-leaf/core/build/rules.ts" with { type: "macro" };
import { FACTORY } from "@sequoia-leaf/factory/game.ts";
import { keptLater } from "@sequoia-leaf/factory/later.ts";
import { PULLS, PULLS_VERSION, readStaffCommand } from "@sequoia-leaf/pulls";
import { RAID, TABLE_VERSION } from "@sequoia-leaf/raid/game.ts";
import { TOWN, TOWN_VERSION } from "@sequoia-leaf/town";
import { Effect } from "effect";

/** What one command came to, before Leaf keeps it: a refusal, or what it did and how to keep the state it left. */
export type Attempt =
  | { readonly refused: string }
  | {
      readonly notes: readonly unknown[];
      readonly coins: readonly CoinChange[];
      readonly leaf: readonly LeafSpend[];
      readonly log: readonly Logged[];
      /** What it leaves for other players to meet (`Done.keep`). */
      readonly pieces: readonly Kept[];
      /** Makes the state the command left the open state. Until then, nothing has changed. */
      readonly keep: () => void;
      /** What a visitor's page is told of it (`Game.echo`): asked once it is kept, before the next command. */
      readonly echo: () => unknown;
    };

/** A state brought to Leaf's clock, that commands are done to one at a time. */
export interface Opened {
  /** Where a command (one the game `reads`), done now, would meet another player's piece (`Game.meets`); else null. */
  readonly meets: (command: unknown) => Meeting | null;
  readonly attempt: (command: unknown, ctx: Ctx) => Attempt;
  /** The state as it stands, as the game stores it. */
  readonly text: () => string;
  /** What the player's page is given of it. */
  readonly view: (ctx: Ctx) => unknown;
  /** What a batch is answered with: the game's short answer (`Game.answer`), or else the view. */
  readonly answer: (ctx: Ctx) => unknown;
  /** What a visitor is given of it, or null for a game that cannot be visited. */
  readonly visit: ((ctx: Ctx) => unknown) | null;
  /** Where it stands among everyone's, or null for a game with no board. */
  readonly standing: () => Standing | null;
  /** What it shows was won for good (`Game.awards`); none for a game that awards nothing. */
  readonly awards: () => readonly string[];
}

/** A stored state read into memory, one state however it is used: run on, brought to a moment, and commanded. */
export interface Held {
  /**
   * Runs it on toward `ctx.now`, or toward where a command (one the game `reads`) is done, while
   * `more` says to (`Game.tend`), and says whether there is further to go: never, for a game that
   * does not tend its states.
   */
  readonly run: (ctx: Ctx, more: () => boolean, command?: unknown) => boolean;
  /** Brings it to `ctx.now` (`Game.advance`), to show and to do commands to. */
  readonly open: (ctx: Ctx) => Opened;
  /**
   * What it tells the town as it stands (`Game.postcard`), as JSON, when that is not the postcard
   * stored with it; null when it is, and for a game that writes none.
   */
  readonly unposted: () => string | null;
  /**
   * What to store with it as a batch keeps it: its postcard as it stands, when it is `written` (its
   * `rev` moves on, and the postcard with it) or that is not the one stored; else null. Taken to be
   * stored: the batch that takes it keeps it, and one that fails lets go of the copy holding it.
   */
  readonly post: (written: boolean) => string | null;
  /**
   * Takes the postcard stored with it now (null: none) as the one stored, read again while it is
   * still the state: a tool, or another Leaf, may have written another at the same `rev`.
   */
  readonly stored: (postcard: string | null) => void;
  /** Where it stands among everyone's as it is, brought to no moment; null for a game with no board. */
  readonly standing: () => Standing | null;
}

/** A game as the play service handles it: in stored text and JSON, whatever the game's own types. */
export interface Played {
  readonly id: GameId;
  /** The version of its rules Leaf runs (core's `rulesVersion`), made as Leaf started: every answer says it, for the page to check its own. */
  readonly rules: string;
  /** A new player's state, as the game stores it. */
  readonly create: (ctx: Ctx) => string;
  /** Whether a command reads as one of the game's, or one of the staff's (`StaffCommand`) as the game reads those. */
  readonly reads: (command: unknown) => boolean;
  /** Whether a command is one of the game's that its page sends by itself (`Game.chore`), not for anything the player did. */
  readonly chore: (command: unknown) => boolean;
  /** A stored state read into memory, with the postcard stored with it (null: none); null when the text is not one the game can read. */
  readonly read: (text: string, postcard: string | null) => Held | null;
  /** Whether stored text is a newer Leaf's (`NEWER`), which `read` refuses: it is left exactly as it is. */
  readonly newer: (text: string) => boolean;
  /** Whether its states go on by themselves (`Game.tend`), for Leaf to tend. */
  readonly tends: boolean;
  /** Whether its states tell the town anything (`Game.postcard`), which Leaf keeps with each. */
  readonly posts: boolean;
  /** Whether it shows the doors to the other games (the town): its owner's opens and batches are given the postcards. */
  readonly showsDoors: boolean;
  /** Whether a visitor's page is told each command done (`Game.echo`). */
  readonly echoes: boolean;
  /**
   * The live room whose people see a player's state, if anybody can (a visit's, a camp's): Leaf tells
   * it each batch it keeps of the state (`did`), or, for a game that does not echo, each that changed
   * what a visitor is shown (`changed`).
   */
  readonly room: (player: PlayerId) => string | null;
}

/** What a command done comes to, as the service weighs it: every part there, as nothing where the game left it out. */
const doneOf = <S, N>(done: Done<S, N>) => ({
  notes: done.notes,
  coins: done.coins ?? [],
  leaf: done.leaf ?? [],
  log: done.log ?? [],
  pieces: done.keep ?? [],
});

/**
 * A command one of the guild's staff give through Leaf's own code (`POST /v1/game/admin/grants`),
 * with its id, to be done to a player's state as a batch of theirs is (`Play.send`). No page can
 * send one: nothing read off the wire is ever an instance of a class. A game reads it with the
 * reader it was given for the staff's (`played`'s `staff`), and never as one of its own.
 */
export class StaffCommand {
  readonly id: string;
  readonly command: unknown;
  constructor(id: string, command: unknown) {
    this.id = id;
    this.command = command;
  }
}

/** A command as a game reads it: one off the wire by its own reader (`Game.command`), one of the staff's by `staff`. */
const readerOf =
  <C>(command: (raw: unknown) => C | null, staff: (raw: unknown) => C | null) =>
  (raw: unknown): C | null =>
    raw instanceof StaffCommand ? staff(raw.command) : command(raw);

/** What a command off the wire, done to `state` now, would meet (`Game.meets`): null for none, and for one not the game's. */
function meetsOf<State, Command>(
  game: Pick<Game<State, Command, unknown, unknown>, "meets">,
  state: State,
  command: Command | null,
): Meeting | null {
  return command === null ? null : (game.meets?.(state, command) ?? null);
}

/**
 * Whether stored text is a newer Leaf's (`Played.newer`), for each game: of a version above the one
 * it writes (its `v`); for the Works, also a yard kept on more land than this Leaf's (`keptLater`).
 */
const NEWER: Readonly<Record<GameId, (text: string) => boolean>> = {
  raid: (text) => newerThan(text, TABLE_VERSION),
  works: (text) => keptLater(text),
  town: (text) => newerThan(text, TOWN_VERSION),
  pulls: (text) => newerThan(text, PULLS_VERSION),
};

/**
 * Wraps a game for the service, keeping its own types inside. A game's rules may change the state
 * they are given in place (the Works' do), so the state is kept as text before each command, and a
 * command done that the service does not keep (for Coins or Leaf) is undone from it: the service
 * goes on only from a state whose command was done. One the rules refuse leaves the state as the
 * rules left it, as running on to it alone would (`Game.apply`).
 */
export function played<State, Command, View, Note, Short>(
  game: Game<State, Command, View, Note, Short>,
  room: (player: PlayerId) => string | null = () => null,
  showsDoors = false,
  /** Reads the staff's commands (`StaffCommand`); none for a game the staff give nothing in. */
  staff: (raw: unknown) => Command | null = () => null,
): Played {
  const commandOf = readerOf((raw) => game.command(raw), staff);
  const held = (decoded: State, stored: string | null): Held => {
    let state = decoded;
    /** The state as it was before a command that has not been kept. */
    let undo: string | null = null;
    /** The postcard stored with the state. */
    let kept = stored;
    const current = (): State => {
      if (undo !== null) {
        state = game.decode(undo) ?? state;
        undo = null;
      }
      return state;
    };
    const unposted = (): string | null => {
      const postcard = game.postcard ? JSON.stringify(game.postcard(current())) : null;
      return postcard === kept ? null : postcard;
    };
    const opened: Opened = {
      meets: (raw) => meetsOf(game, current(), commandOf(raw)),
      attempt: (raw, at) => {
        const command = commandOf(raw);
        if (command === null) {
          return { refused: "invalid_command" };
        }
        const before = game.encode(current());
        const answer = game.apply(state, command, at);
        if (isRefused(answer)) {
          return { refused: answer.refused };
        }
        undo = before;
        return {
          ...doneOf(answer),
          keep: () => {
            state = answer.state;
            undo = null;
          },
          echo: () => game.echo?.(answer.state, command),
        };
      },
      text: () => game.encode(current()),
      view: (at) => game.view(current(), at),
      answer: (at) => (game.answer ? game.answer(current(), at) : game.view(current(), at)),
      visit: game.visit ? (at) => game.visit?.(current(), at) : null,
      standing: () => game.standing?.(current()) ?? null,
      awards: () => game.awards?.(current()) ?? [],
    };
    return {
      run: (ctx, more, raw) => game.tend?.(current(), ctx, more, commandOf(raw) ?? undefined) ?? false,
      open: (ctx) => {
        state = game.advance(current(), ctx);
        return opened;
      },
      unposted,
      post: (written) => {
        const postcard = written && game.postcard ? JSON.stringify(game.postcard(current())) : unposted();
        kept = postcard ?? kept;
        return postcard;
      },
      stored: (postcard) => {
        kept = postcard;
      },
      standing: opened.standing,
    };
  };
  return {
    id: game.id,
    rules: RULES[game.id],
    create: (ctx) => game.encode(game.create(ctx)),
    reads: (command) => commandOf(command) !== null,
    chore: (raw) => {
      const command = commandOf(raw);
      return command !== null && game.chore?.(command) === true;
    },
    read: (text, postcard) => {
      const decoded = game.decode(text);
      return decoded === null ? null : held(decoded, postcard);
    },
    newer: NEWER[game.id],
    tends: game.tend !== undefined,
    posts: game.postcard !== undefined,
    showsDoors,
    echoes: game.echo !== undefined,
    room,
  };
}

/** Where Leaf tells the people in a room what was done there (`Watchers`). */
interface Telling {
  readonly heard: (room: string) => boolean;
  readonly tell: (room: string, frame: string) => void;
}

/**
 * What the people in the room where a player's state is seen hear of a batch done to it (`of`'s
 * `room`), made only while anybody is there: for a game that echoes its commands, each
 * command kept, in order, as the game echoes it, and each one's id as its page gave it (so the
 * owner's own page knows its own), with the stored `rev` after the batch and the batch's answer
 * (`did`); for any other, that what a visitor is shown of the state changed (`changed`), weighed
 * on the state `game` before the batch and after it.
 */
export function toRoom(of: Played, player: PlayerId, game: Opened, ctx: Ctx, watchers: Telling) {
  const room = of.room(player);
  if (room === null || !watchers.heard(room)) return null;
  const shown = (): string => JSON.stringify(game.visit?.(ctx) ?? null);
  const before = of.echoes ? "" : shown();
  const did: unknown[] = [];
  const ids: string[] = [];
  return {
    kept(id: string, echo: () => unknown): void {
      if (!of.echoes) return;
      did.push(echo());
      ids.push(id);
    },
    tell(rev: number, after: () => unknown): void {
      const changed = !of.echoes && shown() !== before;
      const told: ToClient | null =
        did.length > 0 ? { t: "did", rev, did, after: after(), ids } : changed ? { t: "changed", rev } : null;
      if (told) watchers.tell(room, JSON.stringify(told));
    },
  };
}

/** What Leaf tells every call of a player's, whatever the game: what they have won, and for the town, what each game tells it. */
export type Given = Pick<Ctx, "awards" | "postcards">;
/** Nothing given: for Leaf's own running on, which is no call. */
export const NOTHING_GIVEN: Given = { awards: [], postcards: {} };

/** Logs a player's state stored in a game that does not read, at its `rev`, and what becomes of it (`so`). */
export const unreadable = (game: string, player: PlayerId, rev: number, so: string) =>
  Effect.annotateLogs(Effect.logError(`The ${game} state stored for ${player} does not read; ${so}`), {
    player,
    game,
    rev,
  });

/**
 * Logs a player's state stored that does not read (`unreadable`), and says whether it may rest: be due
 * none until it is written again. One a newer Leaf wrote (`Played.newer`) may not: it is left as it is.
 */
export function unread(game: Played, player: PlayerId, rev: number, text: string) {
  const newer = game.newer(text);
  const so = newer ? "it is a newer Leaf's, left as it is" : "it is kept as it is";
  return Effect.as(unreadable(game.id, player, rev, so), !newer);
}

/** What Leaf tells a game about a call by `playing`. */
export const ctxOf = (
  playing: { readonly playerId: PlayerId; readonly guest: boolean },
  now: number,
  seed: number,
  room: number,
  given: Given,
): Ctx => ({ now, player: { id: playing.playerId, guest: playing.guest }, seed, room, ...given });

/** The version of each game's rules, read from the files Leaf runs as it starts. */
const RULES = rulesVersions();

/** The games on the play service. */
export const GAMES: Readonly<Record<GameId, Played>> = {
  raid: played(RAID),
  works: played(FACTORY, (player) => visitRoom("works", player)),
  // The town's doors and letter say what each of the member's games tells it.
  town: played(TOWN, campRoom, true),
  // The staff give a prize as a pull would (`POST /v1/game/admin/grants`).
  pulls: played(PULLS, undefined, false, readStaffCommand),
};

/** The games whose states tell the town anything (`Played.posts`). */
export const POSTING: readonly GameId[] = Object.values(GAMES).flatMap((p) => (p.posts ? [p.id] : []));
