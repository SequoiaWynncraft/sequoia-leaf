import {
  type CoinChange,
  type Ctx,
  type Game,
  type GameId,
  isRefused,
  type LeafSpend,
  type Logged,
  type Standing,
} from "@sequoia-leaf/core";
import { PULLS } from "@sequoia-leaf/pulls";
import { RAID } from "@sequoia-leaf/raid/game.ts";
import { TOWN } from "@sequoia-leaf/town";
import { WORKS } from "@sequoia-leaf/yard/game.ts";

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
    };

/** A stored state, opened at Leaf's clock, that commands are done to one at a time. */
export interface Opened {
  readonly attempt: (command: unknown, ctx: Ctx) => Attempt;
  /** The state as it stands, as the game stores it. */
  readonly text: () => string;
  /** What the player's page is given of it. */
  readonly view: (ctx: Ctx) => unknown;
  /** What a visitor is given of it, or null for a game that cannot be visited. */
  readonly visit: ((ctx: Ctx) => unknown) | null;
  /** Where it stands among everyone's, or null for a game with no board. */
  readonly standing: () => Standing | null;
  /** What it shows was won for good (`Game.awards`); none for a game that awards nothing. */
  readonly awards: () => readonly string[];
}

/** A game as the play service handles it: in stored text and JSON, whatever the game's own types. */
export interface Played {
  readonly id: GameId;
  /** A new player's state, as the game stores it. */
  readonly create: (ctx: Ctx) => string;
  /** Whether a command reads as one of the game's. */
  readonly reads: (command: unknown) => boolean;
  /** A stored state brought to `ctx.now`; null when the text is not one the game can read. */
  readonly open: (text: string, ctx: Ctx) => Opened | null;
}

/**
 * Wraps a game for the service, keeping its own types inside. A game's rules may change the state
 * they are given in place (the Works' do), so the state is kept as text before each command, and a
 * command that is not kept (refused by the rules, or by the service for Coins or Leaf) is undone from it:
 * the service goes on only from a state whose command was done.
 */
export function played<State, Command, View, Note>(game: Game<State, Command, View, Note>): Played {
  return {
    id: game.id,
    create: (ctx) => game.encode(game.create(ctx)),
    reads: (command) => game.command(command) !== null,
    open: (text, ctx) => {
      const decoded = game.decode(text);
      if (decoded === null) {
        return null;
      }
      let state = game.advance(decoded, ctx);
      /** The state as it was before a command that has not been kept. */
      let undo: string | null = null;
      const current = (): State => {
        if (undo !== null) {
          state = game.decode(undo) ?? state;
          undo = null;
        }
        return state;
      };
      return {
        attempt: (raw, at) => {
          const command = game.command(raw);
          if (command === null) {
            return { refused: "invalid_command" };
          }
          const before = game.encode(current());
          const answer = game.apply(state, command, at);
          undo = before;
          if (isRefused(answer)) {
            return { refused: answer.refused };
          }
          return {
            notes: answer.notes,
            coins: answer.coins ?? [],
            leaf: answer.leaf ?? [],
            log: answer.log ?? [],
            keep: () => {
              state = answer.state;
              undo = null;
            },
          };
        },
        text: () => game.encode(current()),
        view: (at) => game.view(current(), at),
        visit: game.visit ? (at) => game.visit?.(current(), at) : null,
        standing: () => game.standing?.(current()) ?? null,
        awards: () => game.awards?.(current()) ?? [],
      };
    },
  };
}

/** The games on the play service. */
export const GAMES: Readonly<Record<GameId, Played>> = {
  raid: played(RAID),
  works: played(WORKS),
  town: played(TOWN),
  pulls: played(PULLS),
};
