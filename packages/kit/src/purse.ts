/**
 * The member's purse: Leaf and Coins, shared by the town and every game in it, so that a game
 * running inside the town and the town itself always show the same numbers. Both are Leaf's, and
 * the purse only shows them:
 *
 * - **Leaf** is the guild's ledger's (`fromLedger`), and nothing else: a page never takes Leaf
 *   itself. A game's command on Leaf may take it, while Leaf says spending is on (`leafOpen`);
 *   every other Leaf button shows itself closed (`leafShut`). A guest, who is not in the guild
 *   (`asGuest`), has their Leaf as a member has, but may not spend it on what is for members only
 *   (`leafFor`), whose buttons say so (`LEAF_MEMBERS`).
 * - **Coins** are the Coins ledger's (`fromLeaf`, with what `/v1/game/me` says). A game's commands
 *   pay and take them on Leaf; the page then asks Leaf for the balance again (`refreshCoins`), or
 *   takes the number another page of the game heard (`heardCoins`), or a game shows the change it
 *   worked out itself until Leaf answers. Nothing of either is kept in the browser.
 */

import { type LeafFor, mayBuy } from "@sequoia-leaf/core";

import { ask, isRecord } from "./net.ts";

export interface Purse {
  leaf: number;
  coins: number;
}
export type Currency = keyof Purse;

const watchers = new Set<(p: Purse, why: string) => void>();
let purse: Purse = { leaf: 0, coins: 0 };
/** Whether the purse holds Leaf's numbers yet: until it does, Leaf is not asked anything. */
let onLeaf = false;
/** Whether the purse is a guest's, who may not spend Leaf on what is for members. */
let guest = false;
/** Whether Leaf says a game's command may take Leaf (`/v1/game/hello`'s `leaf_spending`). */
let spending = false;
/** Counts each start, so that an answer to an older question is let go. */
let round = 0;
/** Whether Leaf is being asked for the Coins, and whether it is to be asked again after. */
let asking = false;
let again = false;
/** Counts each change to the Coins the purse is told of (`heardCoins`), so that an answer asked for before one is let go. */
let told = 0;

const whole = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

function tell(why: string): void {
  for (const fn of watchers) fn(purse, why);
}

export const balance = (): Readonly<Purse> => purse;

/** Calls `fn` whenever the purse changes. Returns how to stop. */
export function watch(fn: (p: Readonly<Purse>, why: string) => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/** The guild's ledger says the member holds this much Leaf. */
export function fromLedger(leaf: number): void {
  purse = { ...purse, leaf: Math.max(0, Math.floor(leaf)) };
  tell("the guild's ledger");
}

/** The purse is a guest's: somebody signed in who is not in the guild. */
export function asGuest(): void {
  guest = true;
}

/** Leaf says the member holds this many Coins. From now on the purse's Coins are Leaf's. */
export function fromLeaf(coins: number): void {
  round++;
  onLeaf = true;
  asking = false;
  again = false;
  purse = { ...purse, coins: Math.max(0, Math.floor(coins)) };
  tell("Leaf");
}

/** Asks Leaf for the member's Coins again: one question at a time, and once more if asked meanwhile. */
export function refreshCoins(): void {
  if (!onLeaf) return;
  if (asking) {
    again = true;
    return;
  }
  asking = true;
  void askCoins(round, told);
}

async function askCoins(mine: number, since: number): Promise<void> {
  const answer = await ask("/v1/game/me");
  if (mine !== round) return;
  asking = false;
  const coins = answer.status === 200 && isRecord(answer.body) ? whole(answer.body.coins) : null;
  // Coins spent or paid after it was asked (a purchase shown at once, another page's number) may
  // not be in the answer: it is let go, and the answer to that purchase asks again.
  if (coins !== null && coins !== purse.coins && since === told) {
    purse = { ...purse, coins };
    tell("Leaf");
  }
  if (again) {
    again = false;
    refreshCoins();
  }
}

/** Another page of the game (the town, to a game in its frame), or a game's own reckoning, says the Coins are now this. */
export function heardCoins(coins: number): void {
  if (!onLeaf) return;
  told++;
  purse = { ...purse, coins: Math.max(0, Math.floor(coins)) };
  tell("the town");
}

/** Whether the purse holds Leaf's Coins. */
export const coinsOnLeaf = (): boolean => onLeaf;

/** Leaf says whether a game's command may take Leaf. */
export function leafSpending(on: boolean): void {
  spending = on;
}

/** Whether a game's command may take Leaf: while Leaf's spending is on. */
export const leafOpen = (): boolean => spending;

/** Whether the player may spend Leaf on something that is `forWhom`: a guest only on what is for everyone. */
export const leafFor = (forWhom: LeafFor): boolean => mayBuy(forWhom, guest);

/** What a closed Leaf button says while Leaf's spending is off. */
export const LEAF_SHUT = "Leaf spending opens after the play-test.";
/** What a Leaf button with no command to take its Leaf says, while spending is on. */
export const LEAF_NOT_HERE = "Leaf cannot be spent here yet.";
/** What a Leaf button for something only members may buy says to a guest. */
export const LEAF_MEMBERS = "For guild members.";

/** What a closed Leaf button says. */
export const leafShut = (): string => (spending ? LEAF_NOT_HERE : LEAF_SHUT);

/** Lets the ledgers go again (for tests). */
export function forgetLedger(): void {
  round++;
  purse = { leaf: 0, coins: 0 };
  onLeaf = false;
  guest = false;
  spending = false;
  asking = false;
  again = false;
}
