/**
 * The member's purse: Leaf and Coins, shared by the town and every game in it, so that a game
 * running inside the town and the town itself always show the same numbers. Both are Leaf's, and
 * the purse only shows them:
 *
 * - **Leaf** is the guild's ledger's (`fromLedger`), and nothing else: a page never takes Leaf
 *   itself. A game's command on Leaf may take it, while Leaf says spending is on (`leafSpending`)
 *   and the member is not a guest (`leafOpen`); every other Leaf button shows itself closed. A
 *   guest, who is not in the guild, has no Leaf at all (`asGuest`): no page shows a Leaf number
 *   (`leafShown`), and every Leaf button is closed with the guest's own line (`leafShut`).
 * - **Coins** are the Coins ledger's (`fromLeaf`, with what `/v1/game/me` says). A game's commands
 *   pay and take them on Leaf; the page then asks Leaf for the balance again (`refreshCoins`), or
 *   takes the number another page of the game heard (`heardCoins`), or a game shows the change it
 *   worked out itself until Leaf answers. Nothing of either is kept in the browser.
 */

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
/** Whether the purse is a guest's, with no Leaf to show. */
let guest = false;
/** Whether Leaf says a game's command may take Leaf (`/v1/game/hello`'s `leaf_spending`). */
let spending = false;
/** Counts each start, so that an answer to an older question is let go. */
let round = 0;
/** Whether Leaf is being asked for the Coins, and whether it is to be asked again after. */
let asking = false;
let again = false;

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

/** The purse is a guest's: somebody signed in who is not in the guild. They have no Leaf, and no page shows a Leaf number. */
export function asGuest(): void {
  guest = true;
  fromLedger(0);
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
  void askCoins(round);
}

async function askCoins(mine: number): Promise<void> {
  const answer = await ask("/v1/game/me");
  if (mine !== round) return;
  asking = false;
  const coins = answer.status === 200 && isRecord(answer.body) ? whole(answer.body.coins) : null;
  if (coins !== null && coins !== purse.coins) {
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
  purse = { ...purse, coins: Math.max(0, Math.floor(coins)) };
  tell("the town");
}

/** Whether the purse holds Leaf's Coins. */
export const coinsOnLeaf = (): boolean => onLeaf;

/** Leaf says whether a game's command may take Leaf. */
export function leafSpending(on: boolean): void {
  spending = on;
}

/** Whether a game's command may take Leaf: while Leaf's spending is on, and the member is not a guest. */
export const leafOpen = (): boolean => spending && !guest;

/** Whether a page shows the purse's Leaf: not to a guest, who has none. */
export const leafShown = (): boolean => !guest;

/** What every closed Leaf button says to a member. */
export const LEAF_SHUT = "Leaf spending opens after the play-test.";
/** What a Leaf button with no command to take its Leaf says, while spending is on. */
export const LEAF_NOT_HERE = "Leaf cannot be spent here yet.";
/** What every Leaf button says to a guest. */
export const LEAF_GUEST = "Leaf is earned by raiding with Sequoia.";

/** What a closed Leaf button says, to whoever is playing. */
export const leafShut = (): string => (guest ? LEAF_GUEST : spending ? LEAF_NOT_HERE : LEAF_SHUT);

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
