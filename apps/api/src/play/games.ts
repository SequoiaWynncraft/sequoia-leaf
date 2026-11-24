import {
  campRoom,
  type CoinChange,
  type Ctx,
  type Game,
  type GameId,
  isRefused,
  type LeafSpend,
  type Logged,
  type PlayerId,
  type Standing,
  type ToClient,
  visitRoom,
} from "@sequoia-leaf/core";
import { rulesVersions } from "@sequoia-leaf/core/build/rules.ts" with { type: "macro" };
import { FACTORY } from "@sequoia-leaf/factory/game.ts";
import { PULLS } from "@sequoia-leaf/pulls";
import { RAID } from "@sequoia-leaf/raid/game.ts";
import { TOWN } from "@sequoia-leaf/town";

/** What one command came to, before Leaf keeps it: a refusal, or what it did and how to keep the state it left. */
export type Attempt =
  | { readonly refused: string }
  | {
      readonly notes: readonly unknown[];
      readonly coins: readonly CoinChange[];
      readonly leaf: readonly LeafSpend[];
      readonly log: readonly Logged[];
      /** Makes the state the command left the open state. Until then, nothing has changed. */
      readonly keep: () => void;
      /** What a visitor's page is told of it (`Game.echo`): asked once it is kept, before the next command. */
      readonly echo: () => unknown;
    };

/** A state brought to Leaf's clock, that commands are done to one at a time. */
export interface Opened {
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
}

/** A game as the play service handles it: in stored text and JSON, whatever the game's own types. */
export interface Played {
  readonly id: GameId;
  /** The version of its rules Leaf runs (core's `rulesVersion`), made as Leaf started: every answer says it, for the page to check its own. */
  readonly rules: string;
  /** A new player's state, as the game stores it. */
  readonly create: (ctx: Ctx) => string;
  /** Whether a command reads as one of the game's. */
  readonly reads: (command: unknown) => boolean;
  /** Whether a command is one of the game's that its page sends by itself (`Game.chore`), not for anything the player did. */
  readonly chore: (command: unknown) => boolean;
  /** A stored state read into memory; null when the text is not one the game can read. */
  readonly read: (text: string) => Held | null;
  /** Whether its states go on by themselves (`Game.tend`), for Leaf to tend. */
  readonly tends: boolean;
  /** Whether a visitor's page is told each command done (`Game.echo`). */
  readonly echoes: boolean;
  /**
   * The live room whose people see a player's state, if anybody can (a visit's, a camp's): Leaf tells
   * it each batch it keeps of the state (`did`), or, for a game that does not echo, each that changed
   * what a visitor is shown (`changed`).
   */
  readonly room: (player: PlayerId) => string | null;
}

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
): Played {
  const held = (decoded: State): Held => {
    let state = decoded;
    /** The state as it was before a command that has not been kept. */
    let undo: string | null = null;
    const current = (): State => {
      if (undo !== null) {
        state = game.decode(undo) ?? state;
        undo = null;
      }
      return state;
    };
    const opened: Opened = {
      attempt: (raw, at) => {
        const command = game.command(raw);
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
          notes: answer.notes,
          coins: answer.coins ?? [],
          leaf: answer.leaf ?? [],
          log: answer.log ?? [],
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
      run: (ctx, more, raw) => game.tend?.(current(), ctx, more, game.command(raw) ?? undefined) ?? false,
      open: (ctx) => {
        state = game.advance(current(), ctx);
        return opened;
      },
    };
  };
  return {
    id: game.id,
    rules: RULES[game.id],
    create: (ctx) => game.encode(game.create(ctx)),
    reads: (command) => game.command(command) !== null,
    chore: (raw) => {
      const command = game.command(raw);
      return command !== null && game.chore?.(command) === true;
    },
    read: (text) => {
      const decoded = game.decode(text);
      return decoded === null ? null : held(decoded);
    },
    tends: game.tend !== undefined,
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

/** The version of each game's rules, read from the files Leaf runs as it starts. */
const RULES = rulesVersions();

/** The games on the play service. */
export const GAMES: Readonly<Record<GameId, Played>> = {
  raid: played(RAID),
  works: played(FACTORY, (player) => visitRoom("works", player)),
  town: played(TOWN, campRoom),
  pulls: played(PULLS),
};
