/**
 * The member's purse: Leaf and Coins, shared by the town and every game in it. It is kept in the
 * browser for now and every open page of the game hears when it changes, so a game running inside
 * the town and the town itself always show the same numbers.
 *
 * Leaf is earned outside the game, by what the member does with the guild; nothing here mints it
 * except `grant`, which stands in for the guild's ledger until that is connected.
 */

export interface Purse {
  leaf: number;
  coins: number;
}
export type Currency = keyof Purse;

const KEY = "town.purse.v1";
/** What the stand-in purse opens with: about a week of raiding, and a little pocket money. */
const START: Purse = { leaf: 1860, coins: 300 };

const watchers = new Set<(p: Purse, why: string) => void>();
let purse: Purse = read();

function read(): Purse {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (typeof raw === "object" && raw !== null && "leaf" in raw && "coins" in raw) {
      const { leaf, coins } = raw;
      if (typeof leaf === "number" && typeof coins === "number" && leaf >= 0 && coins >= 0)
        return { leaf: Math.floor(leaf), coins: Math.floor(coins) };
    }
  } catch {
    // No storage, or nonsense in it: start from the usual purse.
  }
  return { ...START };
}

function write(why: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(purse));
  } catch {
    // It still holds for this visit.
  }
  for (const fn of watchers) fn(purse, why);
}

if (typeof window !== "undefined")
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key !== KEY) return;
    purse = read();
    for (const fn of watchers) fn(purse, "elsewhere");
  });

export const balance = (): Readonly<Purse> => purse;
export const has = (kind: Currency, amount: number): boolean => purse[kind] >= amount;

/** Calls `fn` whenever the purse changes, here or in another page of the game. Returns how to stop. */
export function watch(fn: (p: Readonly<Purse>, why: string) => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/** Pays Coins in. */
export function earn(coins: number, why: string): void {
  if (!(coins > 0)) return;
  purse = { ...purse, coins: purse.coins + Math.floor(coins) };
  write(why);
}

/** Takes the price if the purse holds it, and says whether it did. */
export function spend(kind: Currency, amount: number, why: string): boolean {
  const price = Math.floor(amount);
  if (price < 0 || purse[kind] < price) return false;
  purse = { ...purse, [kind]: purse[kind] - price };
  write(why);
  return true;
}

/** Stand-in for Leaf arriving from the guild's ledger. */
export function grant(leaf: number, why: string): void {
  if (!(leaf > 0)) return;
  purse = { ...purse, leaf: purse.leaf + Math.floor(leaf) };
  write(why);
}

/** Puts the purse back to how a new member finds it. */
export function reset(): void {
  purse = { ...START };
  write("reset");
}
