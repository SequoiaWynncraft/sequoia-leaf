/**
 * Coins changed by a page, for the game not on the play service yet (the town). Its page still
 * works out what it earns and spends, and tells Leaf each change through `POST /v1/game/coins`;
 * Leaf keeps it in the Coins ledger with the reason the page gives, within the limits here. All of
 * this goes when the town moves to the play service, which pays and takes Coins by its own rules.
 */

import { COMMAND_ID } from "./play.ts";

/** What a reason is: the game it belongs to, whether it pays Coins in or takes them, and what it is. */
export interface CoinReasonSpec {
  readonly game: "town";
  readonly way: "earn" | "spend";
  readonly what: string;
}

/**
 * Every reason a page on the guild's server changes Coins for, each the one place in the town that
 * earns or spends them. An entry's amount goes the reason's way: earnings in, spending out. (The
 * made-up guild's quests and its while-away letter pay Coins only in the browser, and never reach
 * Leaf.)
 */
export const COIN_REASONS = {
  camp_thing: { game: "town", way: "spend", what: "A thing for the camp, bought at a market stall." },
  daily_chest: { game: "town", way: "earn", what: "The chest by the Treasury: Leaf pays its 3 Coins once a UTC day." },
} as const satisfies Readonly<Record<string, CoinReasonSpec>>;

export type CoinReason = keyof typeof COIN_REASONS;

/** The reasons, in the order above. */
export const COIN_REASON_NAMES = Object.keys(COIN_REASONS).filter((name): name is CoinReason => name in COIN_REASONS);

/** The reason a name stands for, or undefined when it is not one. */
export const coinReason = (name: string): CoinReason | undefined => COIN_REASON_NAMES.find((r) => r === name);

/** What one call may change. */
export const PAGE_COINS = {
  /** The most one call may pay in. */
  most: 5000,
  /** The most one call may take, as a negative amount. */
  least: -100_000,
} as const;

/** The most a player's play may pay in, whatever the games: in any hour, and in a UTC day. */
export const EARNINGS = { hourly: 5000, daily: 20_000 } as const;

/** What the daily chest pays, whatever the page says: Leaf's amount, once a UTC day. */
export const DAILY_CHEST = 3;

/** A call to change Coins that may be done: its id (the page's own), the amount, and the reason. */
export interface PageCoinsCall {
  readonly id: string;
  readonly amount: number;
  readonly reason: CoinReason;
}

export type PageCoinsCheck =
  | ({ readonly ok: true } & PageCoinsCall)
  | { readonly ok: false; readonly code: "invalid_command" | "invalid_amount" | "invalid_reason" };

/**
 * Whether a page's call may be done as it is: an id as commands have them, a whole amount that is
 * not 0, from `PAGE_COINS.least` to `PAGE_COINS.most`, and one of the reasons, with the amount going
 * the reason's way. The daily chest takes no amount from the page: it is `DAILY_CHEST`.
 */
export function checkPageCoins(call: {
  readonly id: string;
  readonly amount: number;
  readonly reason: string;
}): PageCoinsCheck {
  if (!COMMAND_ID.test(call.id)) {
    return { ok: false, code: "invalid_command" };
  }
  const reason = coinReason(call.reason);
  if (reason === undefined) {
    return { ok: false, code: "invalid_reason" };
  }
  if (reason === "daily_chest") {
    return { ok: true, id: call.id, amount: DAILY_CHEST, reason };
  }
  const { amount } = call;
  if (!Number.isSafeInteger(amount) || amount === 0 || amount > PAGE_COINS.most || amount < PAGE_COINS.least) {
    return { ok: false, code: "invalid_amount" };
  }
  const spec: CoinReasonSpec = COIN_REASONS[reason];
  if (amount > 0 !== (spec.way === "earn")) {
    return { ok: false, code: "invalid_amount" };
  }
  return { ok: true, id: call.id, amount, reason };
}

/** The key of the ledger entry a page's call makes, so that a call sent twice is done once. */
export const pageCoinsKey = (playerId: string, id: string): string => `page:${playerId}:${id}`;

/** The key of the daily chest's entry for the UTC day (`utcDay`), so that it is paid once a day whatever ids are sent. */
export const dailyChestKey = (playerId: string, day: number): string => pageCoinsKey(playerId, `daily_chest:${day}`);
