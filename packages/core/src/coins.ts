/** The limits on Coins that hold whatever the game: what play may pay in, and the daily chest. */

/** The most a player's play may pay in, whatever the games: in any hour, and in a UTC day. */
export const EARNINGS = { hourly: 5000, daily: 20_000 } as const;

/** What the daily chest by the Treasury pays, once a UTC day. */
export const DAILY_CHEST = 3;

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
