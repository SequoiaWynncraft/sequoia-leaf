/**
 * A player's purse as Leaf's answers carry it: a wire type, apart from the Coins' limits that games'
 * rules use (`coins.ts`).
 */

/**
 * The header an answer that moved the player's Leaf outside the play service (a reroll, a request
 * bought) carries Leaf's word in, as JSON `Balances`: beside its body, which the mod reads as it was.
 */
export const PURSE_HEADER = "Leaf-Purse";

/**
 * A player's Coins and Leaf as one moment of Leaf's ledgers had them, and that moment's `version`,
 * which grows with every entry to either ledger and never goes back: of two, the one with the higher
 * version is the newer. Every answer of the play service carries the caller's, and so does
 * `/v1/game/me` (its `coins`, `leaf` and `version`).
 */
export interface Balances {
  readonly coins: number;
  readonly leaf: number;
  readonly version: number;
}

const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Balances as the wire carries them, or null for anything that is not. */
export function readBalances(v: unknown): Balances | null {
  if (typeof v !== "object" || v === null || !("coins" in v) || !("leaf" in v) || !("version" in v)) return null;
  const { coins, leaf, version } = v;
  return whole(coins) && whole(leaf) && whole(version) ? { coins, leaf, version } : null;
}
