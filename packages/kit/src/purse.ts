/**
 * The member's purse: Leaf and Coins, shared by the town and every game in it, so that a game
 * running inside the town and the town itself always show the same numbers.
 *
 * On the guild's own server both numbers are Leaf's:
 *
 * - **Leaf** is the guild's ledger's (`fromLedger`), and nothing else: `grant` does nothing, Leaf
 *   cannot be spent, and every Leaf button shows itself closed (`leafOpen`). A guest, who is not in
 *   the guild, has no Leaf at all (`asGuest`): no page shows a Leaf number (`leafShown`), and every
 *   Leaf button is closed with the guest's own line (`leafShut`).
 * - **Coins** are the Coins ledger's (`fromLeaf`, with what `/v1/game/me` says). `earn` and `spend`
 *   change the page's number at once, giving the reason (one of `COIN_REASONS`), and send the
 *   change to Leaf behind it (`POST /v1/game/coins`): in order, one at a time, and sent again with
 *   the same id after a network failure. A change keeps its id and its amount from the first time
 *   it is sent; as the page is hidden or closed, every change not yet answered goes at once
 *   (`flushCoins`), and Leaf does each id once. `spend` still answers at once, from the page's number. A
 *   change Leaf refuses sets the page's number to Leaf's, and the watchers are told.
 *   `refreshCoins` asks Leaf for the balance again (a framed game closed, the page came back into view), and
 *   `heardCoins` takes the number another page of the game heard. Nothing of Coins is kept in the
 *   browser: the page's number is Leaf's last answer with the changes not yet answered on top.
 *
 * With the made-up guild there is no server: the purse is kept in the browser, every open page of
 * the game hears when it changes, and `grant` stands in for the guild's ledger.
 */

import { type CoinReason, PAGE_COINS } from "@sequoia-leaf/core";

import { keepText } from "./keep.ts";

export type { CoinReason };
import { ask, isRecord, outside } from "./net.ts";

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
/** Whether the purse is a guest's, with no Leaf to show. */
let guest = false;

const whole = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

// ---------- Coins on the guild's server ----------

/**
 * A change to Coins on its way to Leaf, or a question for the balance as it stands. A change gets
 * its id when it is made, and is `sent` once any request has carried it: from then on it never
 * changes, so that each id always means the same amount.
 */
type Owed =
  { readonly id: string; amount: number; readonly reason: CoinReason; readonly once: boolean; sent: boolean } | "ask";

/** The Coins Leaf last said the member holds; null with the made-up guild, whose Coins are the browser's. */
let held: number | null = null;
/** Who the page believes the member is, sent with every change. */
let me = "";
/** What has not been answered yet, oldest first; while `sending`, the first of it is on its way. */
let owed: Owed[] = [];
let sending = false;
/** Signed out, or signed in as somebody else: nothing more is sent, until the page starts again. */
let halted = false;
/** Counts each start of the Coins, so that an answer to an older one is let go. */
let round = 0;
let made = 0;
const settledHearers: (() => void)[] = [];

/** How long to wait before sending a change again after it found no answer, doubling up to `most`. */
const RETRY = { first: 500, most: 10_000 } as const;

/** A short name for this page, so that its changes' ids are its own among the member's other pages. */
function pageName(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("");
}
let page = "";

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** What is owed, in Coins: the changes not yet answered. */
const unanswered = (): number => owed.reduce((sum, o) => sum + (o === "ask" ? 0 : o.amount), 0);

/** The Coins the page shows on the guild's server: Leaf's last answer, with what is on its way on top. */
const shownCoins = (from: number): number => Math.max(0, from + unanswered());

function read(): Purse {
  if (held !== null) return { leaf: ledger ?? 0, coins: shownCoins(held) };
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

/**
 * Says the purse changed. With the made-up guild it is kept in the browser (where it cannot be, it
 * still holds for this visit); on the guild's server nothing of it is kept, and Leaf is told.
 */
function write(why: string): void {
  const p = now();
  if (held === null) keepText(KEY, JSON.stringify(ledger === null ? p : { coins: p.coins }));
  tell(why);
}

/** Shows Leaf's Coins, with what is still on its way on top, and tells the watchers why. */
function show(why: string): void {
  if (held === null) return;
  purse = { ...now(), coins: shownCoins(held) };
  tell(why);
}

if (typeof window !== "undefined")
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key !== KEY || held !== null) return;
    purse = read();
    tell("elsewhere");
  });

/**
 * Queues a change to Leaf: within what one change may be, and added to the last one waiting for the
 * same reason while no request has carried it yet.
 */
function owe(amount: number, reason: CoinReason, once: string | undefined): void {
  if (once !== undefined) {
    owed.push({ id: once, amount, reason, once: true, sent: false });
    return;
  }
  let left = amount;
  while (left !== 0) {
    const last = owed.at(-1);
    const waiting = last !== undefined && last !== "ask" && !last.sent ? last : null;
    if (waiting && !waiting.once && waiting.reason === reason) {
      const room = left > 0 ? PAGE_COINS.most - waiting.amount : PAGE_COINS.least - waiting.amount;
      const add = left > 0 ? Math.min(left, room) : Math.max(left, room);
      if (add !== 0) {
        waiting.amount += add;
        left -= add;
        continue;
      }
    }
    const part = left > 0 ? Math.min(left, PAGE_COINS.most) : Math.max(left, PAGE_COINS.least);
    owed.push({ id: `${page}-${++made}`, amount: part, reason, once: false, sent: false });
    left -= part;
  }
}

/** Reads the Coins out of an answer: `{ "coins" }`, as both `/v1/game/me` and `/v1/game/coins` answer. */
const coinsIn = (body: unknown): number | null => (isRecord(body) ? whole(body.coins) : null);

/** Whether a refusal is for good: sending it again would be refused again. */
const forGood = (status: number, body: unknown): boolean =>
  status === 400 ||
  status === 404 ||
  status === 409 ||
  status === 410 ||
  (status === 429 && isRecord(body) && body.code === "too_much");

/** Sends what is owed to Leaf, one at a time, until nothing is. */
async function pump(): Promise<void> {
  if (sending || halted || held === null) return;
  const next = owed[0];
  if (next === undefined) {
    for (const fn of settledHearers.splice(0)) fn();
    return;
  }
  sending = true;
  if (next !== "ask") next.sent = true;
  const mine = round;
  let pause: number = RETRY.first;
  for (;;) {
    const asking =
      next === "ask"
        ? ask("/v1/game/me")
        : ask("/v1/game/coins", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ player: me, id: next.id, amount: next.amount, reason: next.reason }),
          });
    // oxlint-disable-next-line no-await-in-loop -- the same change, again, until Leaf has it
    const answer = await asking;
    if (mine !== round) return;
    const coins = answer.status === 200 ? coinsIn(answer.body) : null;
    if (coins !== null) {
      owed.shift();
      held = coins;
      show("Leaf");
      break;
    }
    if (answer.status === 409 && isRecord(answer.body) && answer.body.code === "not_you") {
      // Signed in as somebody else since this page opened: nothing of this page's is theirs, and
      // nothing more is sent. The page loads again, as whoever is signed in now.
      halted = true;
      owed = [];
      sending = false;
      for (const fn of settledHearers.splice(0)) fn();
      outside.reload();
      return;
    }
    if (answer.status === 401 || answer.status === 403) {
      // Signed out, or no longer let in: nothing more can be sent. The page shows Leaf's last number.
      halted = true;
      owed = [];
      sending = false;
      show("signed out");
      for (const fn of settledHearers.splice(0)) fn();
      return;
    }
    if (answer.status !== 200 && forGood(answer.status, answer.body)) {
      // Refused: the page's number goes back to Leaf's, and Leaf is asked what that is now.
      owed.shift();
      if (owed[0] !== "ask") owed.unshift("ask");
      show("refused");
      break;
    }
    // No answer, or Leaf having trouble: the same change again in a moment, with the same id.
    // oxlint-disable-next-line no-await-in-loop -- waiting before trying again
    await wait(pause);
    if (mine !== round) return;
    pause = Math.min(RETRY.most, pause * 2);
  }
  sending = false;
  void pump();
}

/**
 * Sends every change Leaf has not answered yet at once, as the page is hidden or goes away (or the
 * town puts the game away), so that it reaches Leaf though the page does not wait: the one on its
 * way and one waiting to be sent again too, each with its own id. What is sent stays owed and never
 * changes: if the page stays after all, it is sent again in turn with the same ids, and done once.
 */
export function flushCoins(): void {
  if (held === null || halted) return;
  for (const o of owed) {
    if (o === "ask") continue;
    o.sent = true;
    void outside.fetch("/v1/game/coins", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: me, id: o.id, amount: o.amount, reason: o.reason }),
      keepalive: true,
    });
  }
}

if (typeof window !== "undefined") window.addEventListener("pagehide", flushCoins);
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushCoins();
  });

// ---------- what pages use ----------

export const balance = (): Readonly<Purse> => now();
export const has = (kind: Currency, amount: number): boolean => now()[kind] >= amount;

/** Calls `fn` whenever the purse changes, here or in another page of the game. Returns how to stop. */
export function watch(fn: (p: Readonly<Purse>, why: string) => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/**
 * Pays Coins in, for a reason. On the guild's server Leaf is told; `once` is the change's id when
 * it must be paid once however many pages pay it (the chest's day), and Leaf answers a second one
 * with the balance as it stands.
 */
export function earn(coins: number, reason: CoinReason, once?: string): void {
  if (!(coins >= 1)) return;
  const amount = Math.floor(coins);
  if (held === null) {
    const p = now();
    purse = { ...p, coins: p.coins + amount };
    write(reason);
    return;
  }
  owe(amount, reason, once);
  show(reason);
  void pump();
}

/**
 * Pays Coins that only the made-up guild pays (its quests that pay Coins, the letter's Coins for
 * time away) into the purse kept in the browser. On the guild's server nothing pays these, and it
 * does nothing.
 */
export function earnMadeUp(coins: number, why: string): void {
  if (held !== null || !(coins >= 1)) return;
  const p = now();
  purse = { ...p, coins: p.coins + Math.floor(coins) };
  write(why);
}

/**
 * Takes the price if the purse holds it, and says whether it did, at once. Coins are spent for a
 * reason, and on the guild's server Leaf is told. Beside a ledger, Leaf is never taken.
 */
export function spend(kind: "coins", amount: number, reason: CoinReason): boolean;
export function spend(kind: "leaf", amount: number): boolean;
export function spend(kind: Currency, amount: number, reason?: CoinReason): boolean {
  const price = Math.floor(amount);
  const p = now();
  if (kind === "leaf" && ledger !== null) return false;
  if (!(price >= 0) || p[kind] < price) return false;
  if (kind === "coins" && held !== null && reason !== undefined) {
    if (price > 0) owe(-price, reason, undefined);
    show(reason);
    void pump();
    return true;
  }
  purse = { ...p, [kind]: p[kind] - price };
  write(reason ?? "Leaf");
  return true;
}

/** Stand-in for Leaf arriving from the guild's ledger. Beside the real ledger it does nothing. */
export function grant(leaf: number, why: string): void {
  if (!(leaf > 0) || ledger !== null) return;
  const p = now();
  purse = { ...p, leaf: p.leaf + Math.floor(leaf) };
  write(why);
}

/**
 * Sets the made-up guild's purse to exact amounts, for a tour or a stand-in that looks at the game
 * with more or less to spend. On the guild's server it does nothing: those are Leaf's.
 */
export function pretendPurse(coins: number, leaf?: number): void {
  if (held !== null) return;
  const p = now();
  purse = {
    coins: whole(coins) ?? p.coins,
    leaf: ledger === null && leaf !== undefined ? (whole(leaf) ?? p.leaf) : p.leaf,
  };
  write("pretend");
}

/** Puts the purse back to how a new member finds it. Beside a ledger, only the Coins; on the guild's server, nothing. */
export function reset(): void {
  if (held !== null) return;
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

/**
 * The purse is a guest's: somebody signed in who is not in the guild. They have no Leaf, the purse
 * keeps none beside the Coins, and no page shows a Leaf number.
 */
export function asGuest(): void {
  guest = true;
  fromLedger(0);
}

/**
 * The page is on the guild's server, and Leaf says the member (`player`, their id) holds this many
 * Coins. From now on the Coins are Leaf's: what the page earns and spends is sent to it, as theirs,
 * and nothing is kept in the browser.
 */
export function fromLeaf(coins: number, player: string): void {
  round++;
  page ||= pageName();
  me = player;
  held = Math.max(0, Math.floor(coins));
  owed = [];
  sending = false;
  halted = false;
  purse = read();
  tell("Leaf");
}

/** Asks Leaf for the member's Coins again, after anything still on its way. With the made-up guild, nothing. */
export function refreshCoins(): void {
  if (held === null || halted) return;
  if (owed.at(-1) !== "ask" || (sending && owed.length === 1)) owed.push("ask");
  void pump();
}

/**
 * Another page of the game (the town, to a game in its frame) heard Leaf's Coins change to this.
 * With nothing of this page's on its way, the page shows it at once; otherwise it asks Leaf.
 */
export function heardCoins(coins: number): void {
  if (held === null || halted) return;
  if (owed.length > 0 || sending) {
    refreshCoins();
    return;
  }
  held = Math.max(0, Math.floor(coins));
  show("the town");
}

/** Whether the Coins are Leaf's (the page is on the guild's server). */
export const coinsOnLeaf = (): boolean => held !== null;

/** Resolves once nothing is on its way to Leaf (at once with the made-up guild). */
export function settled(): Promise<void> {
  if (held === null || halted || (owed.length === 0 && !sending)) return Promise.resolve();
  return new Promise((resolve) => {
    settledHearers.push(resolve);
  });
}

/** Whether Leaf may be spent here at all: not beside the guild's ledger, for now. */
export const leafOpen = (): boolean => ledger === null;

/** Whether a page shows the purse's Leaf: not to a guest, who has none. */
export const leafShown = (): boolean => !guest;

/** What every closed Leaf button says to a member. */
export const LEAF_SHUT = "Leaf spending opens after the play-test.";
/** What every Leaf button says to a guest. */
export const LEAF_GUEST = "Leaf is earned by raiding with Sequoia.";

/** What a closed Leaf button says, to whoever is playing. */
export const leafShut = (): string => (guest ? LEAF_GUEST : LEAF_SHUT);

/** Lets the ledgers go again, and anything still on its way (for tests). */
export function forgetLedger(): void {
  round++;
  ledger = null;
  guest = false;
  purse = null;
  held = null;
  owed = [];
  sending = false;
  halted = false;
  for (const fn of settledHearers.splice(0)) fn();
}
