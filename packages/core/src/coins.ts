/**
 * Coins changed by a page, for the games not on the play service yet (the town and the Works).
 * Their pages still work out what they earn and spend, and tell Leaf each change through
 * `POST /v1/game/coins`; Leaf keeps it in the Coins ledger with the reason the page gives, within
 * the limits here. All of this goes when those games move to the play service, which pays and
 * takes Coins by its own rules.
 */

import { COMMAND_ID } from "./play.ts";

/** What a reason is: the game it belongs to, whether it pays Coins in or takes them, and what it is. */
export interface CoinReasonSpec {
  readonly game: "town" | "works";
  readonly way: "earn" | "spend";
  readonly what: string;
}

/**
 * Every reason a page may change Coins for, each the one place in the town or the Works that earns
 * or spends them. An entry's amount goes the reason's way: earnings in, spending out.
 */
export const COIN_REASONS = {
  camp_thing: { game: "town", way: "spend", what: "A thing for the camp, bought at a market stall." },
  daily_chest: { game: "town", way: "earn", what: "The chest by the Treasury, once a UTC day." },
  quest: { game: "town", way: "earn", what: "A quest on the board that pays Coins, claimed." },
  while_away: { game: "town", way: "earn", what: "Coins the letter that meets a returning member pays out." },
  works_order: { game: "works", way: "earn", what: "Orders filled in the Works, paid from its till." },
  works_depot: { game: "works", way: "earn", what: "What the Works' depot pays for what it takes in, from the till." },
  works_build: {
    game: "works",
    way: "spend",
    what: "A machine or a run of belt built in the yard, or one taken away put back.",
  },
  works_refund: { game: "works", way: "earn", what: "What taking a machine or a belt away gives back." },
  works_plot: { game: "works", way: "spend", what: "A plot of land bought for the yard." },
  works_plan: { game: "works", way: "spend", what: "A plan bought for the yard." },
} as const satisfies Readonly<Record<string, CoinReasonSpec>>;

export type CoinReason = keyof typeof COIN_REASONS;

/** The reasons, in the order above. */
export const COIN_REASON_NAMES = Object.keys(COIN_REASONS).filter((name): name is CoinReason => name in COIN_REASONS);

/** The reason a name stands for, or undefined when it is not one. */
export const coinReason = (name: string): CoinReason | undefined => COIN_REASON_NAMES.find((r) => r === name);

/** What one call may change, and what a player may earn through the calls in any hour. */
export const PAGE_COINS = {
  /** The most one call may pay in. */
  most: 5000,
  /** The most one call may take, as a negative amount. */
  least: -100_000,
  /** The most a player's calls may pay in, together, in any hour. */
  hourly: 10_000,
} as const;

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
 * the reason's way.
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
  const { amount } = call;
  if (!Number.isSafeInteger(amount) || amount === 0 || amount > PAGE_COINS.most || amount < PAGE_COINS.least) {
    return { ok: false, code: "invalid_amount" };
  }
  if (amount > 0 !== (COIN_REASONS[reason].way === "earn")) {
    return { ok: false, code: "invalid_amount" };
  }
  return { ok: true, id: call.id, amount, reason };
}

/** The key of the ledger entry a page's call makes, so that a call sent twice is done once. */
export const pageCoinsKey = (playerId: string, id: string): string => `page:${playerId}:${id}`;
