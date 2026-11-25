/**
 * What a game tells the town about a player's state there, for the door to it (`Game.postcard`).
 * The game's rules write it from the state, and Leaf keeps it beside the state, written in the
 * transaction that writes the state; the town is given the player's (`Ctx.postcards`). So the town
 * says what the state says, as Leaf last ran it, on any device.
 */

import { GAME_IDS, type GameId } from "./games.ts";

export interface Postcard {
  /** What is waiting there, in a line, for the card on the game's door. */
  readonly waiting: string;
  /** Whole Coins earned there and not yet collected. */
  readonly till: number;
}

/** The postcard of each of a player's games that writes one, by game: none for a game they have no state in. */
export type Postcards = Readonly<Partial<Record<GameId, Postcard>>>;

/** No postcards: what every call is given but the town's own (`Ctx.postcards`). */
export const NO_POSTCARDS: Postcards = {};

/** The longest line a postcard's `waiting` is read with. */
const LONGEST = 160;

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A postcard off the wire, or null for anything a game's rules could not have written. */
export function readPostcard(v: unknown): Postcard | null {
  if (!isRecord(v)) return null;
  const { waiting, till } = v;
  if (typeof waiting !== "string" || waiting.length > LONGEST) return null;
  return typeof till === "number" && Number.isSafeInteger(till) && till >= 0 ? { waiting, till } : null;
}

/** Postcards off the wire: each that reads, of a game Leaf plays; anything else is left out. */
export function readPostcards(v: unknown): Postcards {
  if (!isRecord(v)) return NO_POSTCARDS;
  const read: Partial<Record<GameId, Postcard>> = {};
  for (const id of GAME_IDS) {
    const card = readPostcard(v[id]);
    if (card) read[id] = card;
  }
  return read;
}
