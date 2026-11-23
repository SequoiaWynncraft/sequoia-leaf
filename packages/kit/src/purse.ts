/**
 * The member's purse: Leaf and Coins, shared by the town and every game in it, so that a game
 * running inside the town and the town itself always show the same numbers. Both are Leaf's, and
 * the purse only shows them:
 *
 * - **Leaf's word** (`fromLeaf`) is its `Balances`: Coins and Leaf as one moment of its ledgers had
 *   them, with that moment's version. Every play answer carries one, and so does `/v1/game/me`; of
 *   two, the purse keeps the newer (the higher version) and nothing else, so an answer that comes
 *   late never takes the purse back.
 * - **On its way**: a game may show at once the Coins a command pays or takes (`play.ts`'s `send`,
 *   which `owe`s them by the command's id) until Leaf answers it, when they go (`settle`) in the same
 *   moment as the answer's word is taken: a purchase on its way is never shown undone, nor twice.
 * - An answer that moved Leaf outside the play service (a request bought, a reroll) says Leaf's word
 *   beside it, which `net.ts` gives the purse: nothing tells it a number without a version.
 *
 * A game's command on Leaf may take Leaf while Leaf says spending is on (`leafOpen`); every other
 * Leaf button shows itself closed (`leafShut`). A guest, who is not in the guild (`asGuest`), has
 * their Leaf as a member has, but may not spend it on what is for members only (`leafFor`), whose
 * buttons say so (`LEAF_MEMBERS`). Nothing of either is kept in the browser.
 */

import { type Balances, type LeafFor, mayBuy } from "@sequoia-leaf/core";

export interface Purse {
  leaf: number;
  coins: number;
}
export type Currency = keyof Purse;

const watchers = new Set<(p: Purse, why: string) => void>();
/** Leaf's newest word, once it has said one. */
let word: Balances | null = null;
/** The Coins each command still on its way is shown to pay (taking, below nothing), by its id. */
const owed = new Map<string, number>();
/** Whether the purse is a guest's, who may not spend Leaf on what is for members. */
let guest = false;
/** Whether Leaf says a game's command may take Leaf (`/v1/game/hello`'s `leaf_spending`). */
let spending = false;

/** What the purse shows: Leaf's word, and the Coins of what is on its way. */
export function balance(): Readonly<Purse> {
  let coins = word?.coins ?? 0;
  for (const n of owed.values()) coins += n;
  return { leaf: word?.leaf ?? 0, coins: Math.max(0, coins) };
}

function tell(why: string): void {
  const p = balance();
  for (const fn of watchers) fn(p, why);
}

/** Calls `fn` whenever the purse changes. Returns how to stop. */
export function watch(fn: (p: Readonly<Purse>, why: string) => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/** Leaf's newest word, or null before it has said one. */
export const said = (): Balances | null => word;

/** Whether `b` is newer than Leaf's word the purse holds. */
const newer = (b: Balances): boolean => word === null || b.version > word.version;

/** Leaf's word: taken if it is newer than the one the purse holds. Says whether it was. */
export function fromLeaf(b: Balances): boolean {
  if (!newer(b)) return false;
  word = b;
  tell("Leaf");
  return true;
}

/** Leaf answered commands (`ids`), with its word as of that answer (or none): what they owed goes as the word comes. */
export function settle(ids: readonly string[], b: Balances | null): void {
  let changed = false;
  for (const id of ids) changed = owed.delete(id) || changed;
  if (b !== null && newer(b)) {
    word = b;
    changed = true;
  }
  if (changed) tell("Leaf");
}

/** A command on its way (`id`) is shown to pay `coins` (taking, below nothing) until Leaf answers it. */
export function owe(id: string, coins: number): void {
  if (coins === 0 || word === null) return;
  owed.set(id, coins);
  tell("on its way");
}

/** The purse is a guest's: somebody signed in who is not in the guild. */
export function asGuest(): void {
  guest = true;
}

/** Whether the purse holds Leaf's word. */
export const onLeaf = (): boolean => word !== null;

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
  word = null;
  owed.clear();
  guest = false;
  spending = false;
}
