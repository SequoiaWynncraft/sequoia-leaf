/**
 * A game, as Leaf's play service holds it. Leaf owns every game's state: a browser sends commands,
 * Leaf checks each one with the game's rules, applies it, stores the result and answers with what
 * happened. The rules are a pure package (no page, no clock of their own, no randomness of their
 * own) that both Leaf and the browser import; a game hands Leaf one `Game`.
 *
 * Time is Leaf's (`Ctx.now`) and so are the dice (`Ctx.seed`): a state holds its own random stream,
 * which `apply` draws from and moves on, and which `view` never shows.
 */

/** The games Leaf plays. */
export const GAME_IDS = ["raid", "works", "town", "pulls"] as const;
export type GameId = (typeof GAME_IDS)[number];

/** The game a name stands for, or undefined when it is not one. */
export function gameId(name: string): GameId | undefined {
  return GAME_IDS.find((id) => id === name);
}

/** What Leaf tells a game about each call. */
export interface Ctx {
  /** Leaf's clock, in milliseconds. */
  readonly now: number;
  /** Who is calling: the state's owner, or in a visit whoever is looking (`awards` are always the owner's). */
  readonly player: { readonly id: string; readonly guest: boolean };
  /**
   * Leaf's dice for this call: a whole number from 0 up to 2^32 that nobody outside Leaf could have
   * known. A game seeds a new state's stream with it, and stirs it into the stream before drawing,
   * so that what a command draws cannot be worked out beforehand from anything a player has seen.
   */
  readonly seed: number;
  /**
   * How many more Coins the player may earn now. Leaf pays in no more than this whatever a command
   * says (but for a change that is `free`), so a game that pays past it says what was really paid.
   */
  readonly room: number;
  /** Everything the player has won for good, in any game (`Game.awards`): Leaf keeps each, and never takes one away. */
  readonly awards: readonly string[];
}

/** Coins a command pays (or, negative, takes), each keyed by the fact it records so it is paid once. */
export interface CoinChange {
  readonly amount: number;
  readonly reason: string;
  /** Unique among the game's payments to this player, such as `run:7`. */
  readonly key: string;
  /**
   * Not weighed against what a player may earn: Coins given back for something paid for, or paid by
   * Leaf's own clock. Such a change is never cut to `Ctx.room`, and does not use any of it up.
   */
  readonly free?: true;
}

/**
 * Who may spend Leaf on something: anyone signed in, guests too, or only the guild's members (and
 * website admins). Every offer says which, so that nothing is members-only, or open to guests, by
 * being left out.
 */
export type LeafFor = "everyone" | "members";

/** Whether a player, a guest or not, may spend Leaf on something that is `forWhom`. */
export const mayBuy = (forWhom: LeafFor, guest: boolean): boolean => forWhom === "everyone" || !guest;

/** Leaf a command takes. No game ever pays Leaf in. */
export interface LeafSpend {
  /** A whole number of Leaf, above 0. */
  readonly amount: number;
  /** What it was for, as the ledger and the staff are shown it. */
  readonly reason: string;
  /** Unique among the game's spends for this player, such as `look:plum`. */
  readonly key: string;
  /** Who may spend it: Leaf refuses a guest `members_only` for a spend that is `members`. */
  readonly for: LeafFor;
}

/** Something worth remembering that a player did, for the `activity` table. */
export interface Logged {
  readonly kind: string;
  readonly data: Readonly<Record<string, string | number | boolean>>;
}

/** A command done: the state after it, and what happened, for the player's page to show. */
export interface Done<S, N> {
  readonly state: S;
  readonly notes: readonly N[];
  readonly coins?: readonly CoinChange[];
  readonly leaf?: readonly LeafSpend[];
  /** Things worth remembering that the player did (a run begun or ended, an order filled). */
  readonly log?: readonly Logged[];
}

/** A whole number players are listed by, highest first, and a few more shown beside it. */
export interface Standing {
  readonly score: number;
  readonly also: Readonly<Record<string, number>>;
}

/** A standing with its place among everyone's: how many score higher, and one. */
export interface Placed extends Standing {
  readonly place: number;
}

/** A command that may not be done, with a code, as API errors have. Nothing changed. */
export interface Refused {
  readonly refused: string;
}

export interface Game<State, Command, View, Note, Short = never> {
  readonly id: GameId;
  /** A new player's state. */
  create(ctx: Ctx): State;
  /** The state as it stands at `ctx.now` (time passing by itself: a yard working, a day turning). */
  advance(state: State, ctx: Ctx): State;
  /**
   * For a game whose states go on by themselves for hours, too much to do at once (a yard working
   * while its owner is away): runs the state on toward `ctx.now`, or with a command toward where
   * `apply` does it, for as long as `more` says, asked before each step, and says whether there is
   * further to go. Leaf runs such states itself, a slice of work at a time, before it shows a state
   * and before each command, so that neither `advance` nor `apply` has any running on left to do.
   */
  tend?(state: State, ctx: Ctx, more: () => boolean, command?: Command): boolean;
  /**
   * Does one command, or refuses it. Refused, the state is as running on to the command alone
   * leaves it: time only goes forward.
   */
  apply(state: State, command: Command, ctx: Ctx): Done<State, Note> | Refused;
  /** What the player's browser is given: the state without anything that tells the future. */
  view(state: State, ctx: Ctx): View;
  /**
   * For a game whose page runs the same rules on a copy of its own: what a batch of commands is
   * answered with in place of `view`. Only what the page cannot work out for itself, and enough for
   * it to tell whether its copy is still the state Leaf has; when it is not, the page asks for the
   * state again. A game without it is answered with `view`.
   */
  answer?(state: State, ctx: Ctx): Short;
  /** What a visitor is given of somebody's state (`ctx.player` is the visitor); a game without it cannot be visited. */
  visit?(state: State, ctx: Ctx): View;
  /**
   * For a game whose visitor's page runs the same rules on a copy of the state visited: a command
   * just done, as the page does it again, from the state it left. Leaf tells everybody visiting
   * each command of a batch it keeps, in order, with the batch's `answer` (the live wire's `did`),
   * so that a copy that does them sees what the owner does as they do it. A game without it tells
   * visitors nothing.
   */
  echo?(state: State, command: Command): unknown;
  /** Reads stored text back, of this or an older version, or null for nonsense. */
  decode(text: string): State | null;
  encode(state: State): string;
  /** Reads a command off the wire, or null. */
  command(v: unknown): Command | null;
  /**
   * A command the game's page sends by itself, on a timer or as it goes, rather than for something
   * the player did: it says nothing of whether they are at the keys (time AFK, `visits.ts`). A game
   * without it has none.
   */
  chore?(command: Command): boolean;
  /** Where a state stands among everyone's, for a game with a board (`GET /v1/game/play/{game}/standings`). */
  standing?(state: State): Standing;
  /** What this state shows was won for good (a boss beaten, a capstone built), by names other games know it by. */
  awards?(state: State): readonly string[];
}

/** Whether a command's answer is a refusal. */
export const isRefused = <S, N>(answer: Done<S, N> | Refused): answer is Refused => "refused" in answer;

/** The most commands a page puts in one batch. */
export const MOST_COMMANDS = 32;
/**
 * The most commands one request may carry: a page going away sends everything Leaf has not answered
 * at once, in order, in one request that outlives it, since two such requests may arrive in either order.
 */
export const MOST_FLUSHED = 4 * MOST_COMMANDS;

/** What a command's id may be: made by the browser, unique among the player's commands to a game. */
export const COMMAND_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

/** The play service's routes, by game. */
export const playPath = (game: GameId): string => `/v1/game/play/${game}`;
/** Where a visitor reads a player's state in a game. */
export const visitPath = (game: GameId, player: string): string => `${playPath(game)}/of/${encodeURIComponent(player)}`;
