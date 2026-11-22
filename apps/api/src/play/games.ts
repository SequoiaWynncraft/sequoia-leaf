import { type CoinChange, type Ctx, type Game, type GameId, isRefused, type Logged } from "@sequoia-leaf/core";
import { RAID } from "@sequoia-leaf/raid/game.ts";

/** What one command came to, before Leaf keeps it: a refusal, or what it did and how to keep the state it left. */
export type Attempt =
  | { readonly refused: string }
  | {
      readonly notes: readonly unknown[];
      readonly coins: readonly CoinChange[];
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

/** Wraps a game for the service, keeping its own types inside. */
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
      return {
        attempt: (raw, at) => {
          const command = game.command(raw);
          if (command === null) {
            return { refused: "invalid_command" };
          }
          const answer = game.apply(state, command, at);
          if (isRefused(answer)) {
            return { refused: answer.refused };
          }
          return {
            notes: answer.notes,
            coins: answer.coins ?? [],
            log: answer.log ?? [],
            keep: () => {
              state = answer.state;
            },
          };
        },
        text: () => game.encode(state),
        view: (at) => game.view(state, at),
      };
    },
  };
}

/** The games on the play service. The Works and the town are not on it yet. */
export const GAMES: Readonly<Partial<Record<GameId, Played>>> = { raid: played(RAID) };
