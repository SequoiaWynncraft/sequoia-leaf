/**
 * Orders. The depot pays a hundredth of a thing's worth for everything it takes in; orders are
 * where the Coins are. Each thing taken in goes toward one order that still wants it: the story's
 * first, then the board's from the top. A story order pays the moment it is filled; a standing
 * order, once filled, waits on the board until it is handed over (`claim`).
 */
import { ASKS } from "./content/asks.ts";
import type { Wants } from "./content/items.ts";
import { STORY, type StoryOrder } from "./content/story.ts";
import {
  ALL_ITEMS,
  type Item,
  item,
  ITEM_COUNT,
  ITEM_INFO,
  itemName,
  itemNamed,
  kindBit,
  NONE,
  partsOf,
  RECIPES_N,
  workOf,
} from "./tables.ts";
import { type Counts, counts, reopen, type Standing, type Yard } from "./yard.ts";

/** The share of a thing's worth the depot pays for it on arrival, whether or not an order wants it. */
export const DEPOT_SHARE = 0.01;
/** How big a standing order is, in ticks of work: at first, and more for each story order done. */
const ORDER_WORK = { first: 6000, more: 600, deepest: 0.4, ground: 0.3 } as const;
/** Ticks between free swaps: ten minutes of the yard's time. */
export const SWAP_EVERY = 6000;

/** A count by name, as numbers. */
export function countsOf(v: Wants): Counts {
  const out = counts();
  for (const [name, n] of Object.entries(v)) {
    const k = itemNamed(name);
    if (k !== null && typeof n === "number") out[k] = n;
  }
  return out;
}
/** What each story order wants, by number. */
const WANTS = STORY.map((o) => countsOf(o.want));
const WORTH = ITEM_INFO.map((i) => i?.worth ?? 0);

/** Whether everything an order wants has come in. */
export function isFilled(want: Counts, filled: Counts): boolean {
  for (let k = 0; k < ITEM_COUNT; k++) if ((filled[k] ?? 0) < (want[k] ?? 0)) return false;
  return true;
}

/** The depot takes in `n` of a thing: it counts toward the pace, pays its price, and goes toward whichever orders want it. */
export function deliver(y: Yard, thing: number, n: number): void {
  if (n <= 0) return;
  if (y.pace.warm <= 0) y.pace.made[thing] = (y.pace.made[thing] ?? 0) + n;
  y.depot[thing] = (y.depot[thing] ?? 0) + n;
  const coins = (WORTH[thing] ?? 0) * DEPOT_SHARE * n;
  y.till += coins;
  y.sold += coins;
  let left = n;
  for (let tries = 0; left > 0 && tries < 64; tries++) {
    const used = offer(y, thing, left);
    if (used === 0) break;
    left -= used;
  }
}

/** Puts up to `n` of a thing toward the first order that wants it, and says how many it took. */
function offer(y: Yard, thing: number, n: number): number {
  const story = STORY[y.story];
  const want = WANTS[y.story];
  const need = (want?.[thing] ?? 0) - (y.filled[thing] ?? 0);
  if (story && want && need > 0) {
    const used = Math.min(n, need);
    y.filled[thing] = (y.filled[thing] ?? 0) + used;
    y.given[thing] = (y.given[thing] ?? 0) + used;
    if (isFilled(want, y.filled)) finishStory(y, story);
    return used;
  }
  for (let o = 0; o < y.board.length; o++) {
    const order = y.board[o];
    const wants = order ? (order.want[thing] ?? 0) - (order.filled[thing] ?? 0) : 0;
    if (!order || wants <= 0) continue;
    const used = Math.min(n, wants);
    order.filled[thing] = (order.filled[thing] ?? 0) + used;
    y.given[thing] = (y.given[thing] ?? 0) + used;
    if (isFilled(order.want, order.filled)) filledOrder(y, order);
    return used;
  }
  return 0;
}

/** A standing order is filled: it waits on the board to be handed over (`claim`), and a screen is told. */
function filledOrder(y: Yard, order: Standing): void {
  y.news.push({ kind: "filled", id: order.id, title: order.title, pay: order.pay });
}

function finishStory(y: Yard, order: StoryOrder): void {
  y.till += order.pay;
  y.paid += order.pay;
  y.news.push({ kind: "story", index: y.story, title: order.title, pay: order.pay });
  y.story++;
  y.filled = counts();
  reopen(y);
  fillBoard(y);
}

/** Hangs orders on the board until it is full, once the story has put it up. A yard with no seed hangs none. */
export function fillBoard(y: Yard): void {
  const seed = y.seed;
  if (!y.open.board || seed === null) return;
  while (y.board.length < y.rates.slots) y.board.push(fresh(y, seed));
  if (y.news.length > 200) y.news.splice(0, y.news.length - 200);
}

/** Takes an order down and hangs a fresh one in its place; a yard with no seed leaves the place empty. */
function rehang(y: Yard, slot: number): void {
  if (y.seed === null) y.board.splice(slot, 1);
  else y.board[slot] = fresh(y, y.seed);
}

/** Everything the yard could make as it stands: what lies in its plots, and whatever its machines make of that. */
export function makeable(y: Yard): Item[] {
  const can = new Uint8Array(ITEM_COUNT);
  const owned = y.land.plots.map((p) => y.plots.includes(p.plot));
  const { deposit, plot } = y.land;
  for (let i = 0; i < deposit.length; i++) {
    const raw = deposit[i] ?? NONE;
    if (raw !== NONE && owned[plot[i] ?? NONE] === true) can[raw] = 1;
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const r of RECIPES_N) {
      if (can[r.out] === 1 || (y.open.kinds & kindBit(r.by)) === 0 || !r.from.every((k) => can[k] === 1)) continue;
      can[r.out] = 1;
      grew = true;
    }
  }
  return ALL_ITEMS.filter((k) => can[k] === 1);
}

/** What the board may ask for: things the yard could make that the story has given it a reason to make. */
export function askable(y: Yard): Item[] {
  const met = new Uint8Array(ITEM_COUNT);
  for (const want of WANTS.slice(0, y.story + 1))
    for (const k of ALL_ITEMS) if ((want[k] ?? 0) > 0) for (const part of partsOf(k)) met[part] = 1;
  return makeable(y).filter((k) => met[k] === 1);
}

/** A run of numbers from 0 up to 1 that is the same every time for the same seed. */
function dice(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A round number near `n`: whole below twenty, fives below two hundred, tens above. */
const round = (n: number): number =>
  n < 20 ? Math.max(1, Math.round(n)) : n < 200 ? Math.round(n / 5) * 5 : Math.round(n / 10) * 10;

const PLANK = item("plank");

/** How many machines deep a thing is. */
const step = (k: Item): number => ITEM_INFO[k]?.step ?? 0;

/** The next standing order, drawn from the yard's seed and how many orders the board has shown before. */
export function fresh(y: Yard, seed: number): Standing {
  const id = y.serial++;
  const roll = dice(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(id + 1, 0xc2b2ae35));
  const pool = askable(y);
  const taken = new Uint8Array(ITEM_COUNT);
  for (const o of y.board) for (const k of ALL_ITEMS) if ((o.want[k] ?? 0) > 0) taken[k] = 1;
  // Things from deeper in the yard are asked for more often, and what is already on the board less.
  const pick = (not: Item | null): Item | null => {
    const weights = pool.map((k) => (k === not ? 0 : (0.4 + step(k)) * (taken[k] === 1 ? 0.15 : 1)));
    let at = roll() * weights.reduce((a, b) => a + b, 0);
    for (const [n, k] of pool.entries()) {
      at -= weights[n] ?? 0;
      if (at < 0) return k;
    }
    return pool.find((k) => k !== not) ?? null;
  };
  const first = pick(null) ?? PLANK;
  const second = pool.length > 2 && roll() < 0.35 ? pick(first) : null;
  const budget = (ORDER_WORK.first + ORDER_WORK.more * y.story) * (second === null ? 1 : 0.6);
  const want = counts();
  let worth = 0;
  const items = second === null ? [first] : [first, second];
  for (const k of items) {
    const share = step(k) === 4 ? ORDER_WORK.deepest : step(k) === 0 ? ORDER_WORK.ground : 1;
    const n = round((budget * share * (0.8 + roll() * 0.4)) / workOf(k));
    want[k] = n;
    worth += n * (WORTH[k] ?? 0);
  }
  const asks = ASKS[itemName(first)];
  const ask = asks[Math.floor(roll() * asks.length)] ?? { from: "The guild", line: "" };
  const pay = Math.max(5, Math.round((worth * (second === null ? 1 : 1.15) * (0.9 + roll() * 0.2)) / 5) * 5);
  return { id, title: titled(items, ask.from), from: ask.from, line: ask.line, want, pay, filled: counts() };
}

/** "Planks for the gate": the things lead, and a place loses its capital mid-sentence. */
function titled(items: readonly Item[], from: string): string {
  const things = items.map((k) => ITEM_INFO[k]?.many ?? "").join(" and ") || "things";
  const whom = from.startsWith("The ") ? `the ${from.slice(4)}` : from;
  return `${things.charAt(0).toUpperCase()}${things.slice(1)} for ${whom}`;
}

/** Everybody (and everywhere) that asks for things on the board today. */
const ASKERS = new Set(Object.values(ASKS).flatMap((list) => list.map((a) => a.from)));

/** A standing order kept from before the board's askers changed, asked again by one of today's for the same things. */
export function reask(o: Standing): Standing {
  if (ASKERS.has(o.from)) return o;
  const items = ALL_ITEMS.filter((k) => (o.want[k] ?? 0) > 0);
  const asks = ASKS[itemName(items[0] ?? PLANK)];
  const ask = asks[o.id % asks.length] ?? { from: "The guild", line: "" };
  return { ...o, title: titled(items, ask.from), from: ask.from, line: ask.line };
}

/** Where an order hangs on the board, by its id, or -1. */
const slotOf = (y: Yard, id: number): number => y.board.findIndex((o) => o.id === id);

/** Hands a filled standing order over, by its id: it pays into the till and a fresh order takes its place. */
export function claim(y: Yard, id: number): number | null {
  const slot = slotOf(y, id);
  const order = y.board[slot];
  if (!order || !isFilled(order.want, order.filled)) return null;
  y.till += order.pay;
  y.paid += order.pay;
  y.done++;
  y.news.push({ kind: "standing", id: order.id, title: order.title, pay: order.pay });
  rehang(y, slot);
  return order.pay;
}

/** Why an order on the board, by its id, cannot be swapped just now, or nothing if it can. */
export function swapRefusal(y: Yard, id: number): string | null {
  const order = y.board[slotOf(y, id)];
  if (!order) return "There is no such order";
  if (isFilled(order.want, order.filled)) return "That order is filled. Hand it over instead";
  if (y.tick < y.swapAt) {
    const minutes = Math.ceil((y.swapAt - y.tick) / 600);
    return `You can replace an order again in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return null;
}

/** Swaps an order on the board, by its id, for a fresh one, free, once every so often. Says whether it did. */
export function swap(y: Yard, id: number): boolean {
  if (swapRefusal(y, id) !== null) return false;
  rehang(y, slotOf(y, id));
  y.swapAt = y.tick + SWAP_EVERY;
  return true;
}

/** The story order in hand, if the story is not over. */
export const storyOrder = (y: Yard): StoryOrder | null => STORY[y.story] ?? null;

/** What finished story orders have left in the town, oldest first. */
export function townGifts(y: Yard): { id: string; title: string; line: string }[] {
  return STORY.slice(0, y.story).flatMap((o) => (o.gift ? [{ id: o.gift.id, title: o.title, line: o.gift.line }] : []));
}
