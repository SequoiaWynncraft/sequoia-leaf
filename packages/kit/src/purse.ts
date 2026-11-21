/**
 * The member's purse: Leaf and Coins, shared by the town and every game in it. It is kept in the
 * browser and every open page of the game hears when it changes, so a game running inside the town
 * and the town itself always show the same numbers.
 *
 * Leaf is earned outside the game, by what the member does with the guild. With the made-up guild,
 * `grant` stands in for the guild's ledger. On the guild's own server the purse keeps a ledger
 * (`fromLedger`): the Leaf number is the ledger's and nothing else, `grant` does nothing, Leaf
 * cannot be spent, and every Leaf button shows itself closed (`leafOpen`).
 */

import { keepText } from "./keep.ts";
import { outside } from "./net.ts";

export interface Purse {
  leaf: number;
  coins: number;
}
export type Currency = keyof Purse;

export const KEY = "town.purse.v1";
/** What the stand-in purse opens with: about a week of raiding, and a little pocket money. */
const START: Purse = { leaf: 1860, coins: 300 };

const watchers = new Set<(p: Purse, why: string) => void>();
/** Read the first time it is asked for, so that a page can fetch its saves before that. */
let purse: Purse | null = null;
/** The Leaf the guild's ledger holds, once the purse keeps one; null with the made-up guild. */
let ledger: number | null = null;

const whole = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

function read(): Purse {
  let kept: Purse = { ...START };
  try {
    const raw: unknown = JSON.parse(outside.store()?.getItem(KEY) ?? "null");
    if (typeof raw === "object" && raw !== null && "coins" in raw) {
      const coins = whole(raw.coins);
      // A purse kept beside a ledger has no Leaf in it.
      const leaf = "leaf" in raw ? whole(raw.leaf) : START.leaf;
      if (coins !== null && leaf !== null) kept = { leaf, coins };
    }
  } catch {
    // No storage, or nonsense in it: start from the usual purse.
  }
  return ledger === null ? kept : { ...kept, leaf: ledger };
}

const now = (): Purse => (purse ??= read());

function tell(why: string): void {
  const p = now();
  for (const fn of watchers) fn(p, why);
}

/** Keeps the purse in the browser (where it cannot be, it still holds for this visit), and says so. */
function write(why: string): void {
  const p = now();
  keepText(KEY, JSON.stringify(ledger === null ? p : { coins: p.coins }));
  tell(why);
}

if (typeof window !== "undefined")
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key !== KEY) return;
    purse = read();
    tell("elsewhere");
  });

export const balance = (): Readonly<Purse> => now();
export const has = (kind: Currency, amount: number): boolean => now()[kind] >= amount;

/** Calls `fn` whenever the purse changes, here or in another page of the game. Returns how to stop. */
export function watch(fn: (p: Readonly<Purse>, why: string) => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/** Pays Coins in. */
export function earn(coins: number, why: string): void {
  if (!(coins > 0)) return;
  const p = now();
  purse = { ...p, coins: p.coins + Math.floor(coins) };
  write(why);
}

/** Takes the price if the purse holds it, and says whether it did. Beside a ledger, Leaf is never taken. */
export function spend(kind: Currency, amount: number, why: string): boolean {
  const price = Math.floor(amount);
  const p = now();
  if (kind === "leaf" && ledger !== null) return false;
  if (price < 0 || p[kind] < price) return false;
  purse = { ...p, [kind]: p[kind] - price };
  write(why);
  return true;
}

/** Stand-in for Leaf arriving from the guild's ledger. Beside the real ledger it does nothing. */
export function grant(leaf: number, why: string): void {
  if (!(leaf > 0) || ledger !== null) return;
  const p = now();
  purse = { ...p, leaf: p.leaf + Math.floor(leaf) };
  write(why);
}

/** Puts the purse back to how a new member finds it. Beside a ledger, only the Coins. */
export function reset(): void {
  purse = { leaf: ledger ?? START.leaf, coins: START.coins };
  write("reset");
}

/**
 * The guild's ledger says the member holds this much Leaf. From the first call on, the purse's
 * Leaf is only ever what the ledger says.
 */
export function fromLedger(leaf: number): void {
  ledger = Math.max(0, Math.floor(leaf));
  purse = read();
  tell("the guild's ledger");
}

/** Whether Leaf may be spent here at all: not beside the guild's ledger, for now. */
export const leafOpen = (): boolean => ledger === null;

/** What every closed Leaf button says. */
export const LEAF_SHUT = "Leaf spending opens after the play-test.";

/** Lets the ledger go again (for tests). */
export function forgetLedger(): void {
  ledger = null;
  purse = null;
}

/** Reads the purse again from the browser: something has just put the member's saved purse there. */
export function reread(): void {
  purse = read();
  tell("kept");
}
