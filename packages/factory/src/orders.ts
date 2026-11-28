/**
 * Goals and orders. The depot pays a hundredth of a thing's worth for everything it takes in
 * (`ARRIVAL`); goals and orders are where the rest is. Each thing taken in goes toward the node in
 * hand first, then toward the plot being cleared (`clearing.ts`), then toward the board's standing
 * orders from the top; the folios a Study takes in go
 * toward the research being studied. A goal is finished the moment it has all it wants: what it
 * unlocks is unlocked, a node pays and brings the next into hand (the first in line after it that
 * may be taken, else the next by itself), and research known lets the next in the line begin. A standing order, once filled, waits on the board until it is handed over (`claim`).
 *
 * A standing order is drawn from the yard's seed, which only Leaf holds, so the page's copy cannot
 * hang one. Each counts only from `ORDER_WAITS` ticks after it is hung (`starts`): until then the
 * depot gives it nothing and the check leaves it out, and Leaf's answer to a command tells the page
 * of it in time to put it on its own board.
 */
import { ASKS } from "./content/asks.ts";
import { NODES, QUEUE } from "./content/nodes.ts";
import { LINE } from "./content/research.ts";
import type { Land } from "./land.ts";
import {
  ALL_ITEMS,
  ARRIVAL,
  type Goal,
  GOALS,
  isNode,
  type Item,
  item,
  ITEM_COUNT,
  ITEM_INFO,
  itemName,
  locked,
  makersOf,
  MILLI,
  nextHand,
  NONE,
  type Open,
  partsOf,
  type Plot,
  plotName,
  ready,
  type Recipe,
  STUDIES,
  workOf,
} from "./tables.ts";
import { type Counts, counts, hold, reopen, type Standing, type Yard } from "./yard.ts";

/** How big a standing order is, in ticks of work: at first, and more for each tier open beyond the first. */
const ORDER_WORK = { first: 6000, tier: 3000, deepest: 0.4, ground: 0.3 } as const;
/** Ticks between free swaps: ten minutes of the yard's time. */
export const SWAP_EVERY = 6000;
/** Ticks an order hangs on the board before it counts: five seconds, longer than Leaf takes to answer. */
export const ORDER_WAITS = 50;
/** For how many ticks after an order is hung the answer to a batch carries it: a minute. */
export const ORDER_TOLD = 600;
/** Whether an order counts at a tick: the depot gives to it, and the check mixes it in. */
export const counting = (order: Standing, tick: number): boolean => tick >= order.starts;
const WORTH = ITEM_INFO.map((i) => i?.worth ?? 0);

/** Whether everything an order or a goal wants has come in. */
export function isFilled(want: Counts, filled: Counts): boolean {
  for (let k = 0; k < ITEM_COUNT; k++) if ((filled[k] ?? 0) < (want[k] ?? 0)) return false;
  return true;
}

/** The depot takes in `n` of a thing: it goes into its books, pays its price, and goes toward whatever wants it. */
export function deliver(y: Yard, thing: number, n: number): void {
  if (n <= 0) return;
  y.depot[thing] = (y.depot[thing] ?? 0) + n;
  const coins = (ARRIVAL[thing] ?? 0) * n;
  y.till += coins;
  y.sold += coins;
  let left = n;
  for (let tries = 0; left > 0 && tries < 64; tries++) {
    const used = offer(y, thing, left);
    if (used === 0) break;
    left -= used;
  }
}

/** Puts up to `n` of a thing toward the first that wants it, the node in hand, the plot being cleared and then the board, and says how many it took. */
function offer(y: Yard, thing: number, n: number): number {
  const g = y.hand;
  const used = g === -1 ? 0 : giveGoal(y, g, thing, n);
  if (used > 0) return used;
  const cleared = giveClearing(y, thing, n);
  if (cleared > 0) return cleared;
  for (let o = 0; o < y.board.length; o++) {
    const order = y.board[o];
    const wants = order ? (order.want[thing] ?? 0) - (order.filled[thing] ?? 0) : 0;
    if (!order || wants <= 0 || !counting(order, y.tick)) continue;
    const took = Math.min(n, wants);
    order.filled[thing] = (order.filled[thing] ?? 0) + took;
    if (isFilled(order.want, order.filled)) filledOrder(y, order);
    return took;
  }
  return 0;
}

/** Gives a goal up to `n` of a thing it still wants, and finishes it if that is all it wanted; says how many it took. */
export function giveGoal(y: Yard, g: Goal, thing: number, n: number): number {
  const want = GOALS[g]?.want;
  const got = y.got[g];
  const need = want && got ? (want[thing] ?? 0) - (got[thing] ?? 0) : 0;
  if (!want || !got || need <= 0) return 0;
  const took = Math.min(n, need);
  got[thing] = (got[thing] ?? 0) + took;
  if (isFilled(want, got)) finish(y, g);
  return took;
}

/** Gives the plot being cleared up to `n` of a thing it still wants, and tells a screen once it has all it wants; says how many it took. */
function giveClearing(y: Yard, thing: number, n: number): number {
  const c = y.clearing;
  const need = c ? (c.want[thing] ?? 0) - (c.filled[thing] ?? 0) : 0;
  if (!c || need <= 0) return 0;
  const took = Math.min(n, need);
  c.filled[thing] = (c.filled[thing] ?? 0) + took;
  if (isFilled(c.want, c.filled)) filledClearing(y, c.plot);
  return took;
}

/** The plot being cleared has all it wants: it waits to be handed over (`handClearing`), and a screen is told. */
function filledClearing(y: Yard, p: Plot): void {
  const title = y.land.plots.find((q) => q.plot === p)?.name ?? "";
  y.news.push({ kind: "clearing", plot: plotName(p), title, pay: 0 });
}

/** A standing order is filled: it waits on the board to be handed over (`claim`), and a screen is told. */
function filledOrder(y: Yard, order: Standing): void {
  y.news.push({ kind: "filled", id: order.id, title: order.title, pay: order.pay });
}

/**
 * A goal has all it wants: it is done, pays and unlocks what it unlocks; when it was the node in hand,
 * or nothing is in hand, the next comes into hand (`upNext`); research known lets the next in the
 * line begin.
 */
function finish(y: Yard, g: Goal): void {
  const info = GOALS[g];
  if (!info) return;
  y.done.push(g);
  y.got[g] = null;
  y.till += info.pay * MILLI;
  y.paid += info.pay * MILLI;
  y.news.push({ kind: "done", goal: info.id, title: info.title, pay: info.pay });
  reopen(y);
  if (y.hand === g || y.hand === -1) hold(y, upNext(y));
  if (y.line[0] === g) {
    y.line.shift();
    begin(y);
  }
  fillBoard(y);
}

/**
 * The research first in the line begins: somewhere to count what it is given, and every Study looks
 * again at what it holds. The work a Study had done was for the research first before, and is dropped.
 */
function begin(y: Yard): void {
  const g = y.line[0];
  if (g !== undefined) y.got[g] ??= counts();
  const h = y.holders;
  h.idle.fill(0);
  for (let r = 0; r < h.size; r++)
    if (STUDIES[y.kind[h.tile[r] ?? 0] ?? NONE] === 1) {
      h.making[r] = NONE;
      h.work[r] = 0;
    }
}

/** Why a piece of research cannot be put in the line just now, or nothing if it can. */
export function studyRefusal(y: Yard, g: Goal): string | null {
  const info = GOALS[g];
  if (!info || isNode(g)) return "There is no such research";
  if (y.open.done[g] === 1) return `${info.title} is known already`;
  if (y.line.includes(g)) return `${info.title} is in the line already`;
  if (!ready(y.open, g)) return `${info.title} cannot be studied yet`;
  return y.line.length >= LINE ? `The line holds ${LINE} pieces of research` : null;
}

/** Puts a piece of research at the end of the line: studied at once if the line was empty. Says whether it could. */
export function study(y: Yard, g: Goal): boolean {
  if (studyRefusal(y, g) !== null) return false;
  y.line.push(g);
  if (y.line.length === 1) begin(y);
  return true;
}

/** Takes a piece of research out of the line, keeping what it has been given; if it was being studied, the next begins. Says whether it was there. */
export function unstudy(y: Yard, g: Goal): boolean {
  const at = y.line.indexOf(g);
  if (at < 0) return false;
  y.line.splice(at, 1);
  if (at === 0) begin(y);
  return true;
}

/** Why a node cannot be taken into hand just now, or nothing if it can. */
export function takeRefusal(y: Yard, g: Goal): string | null {
  const info = GOALS[g];
  if (!info || !isNode(g)) return "There is no such project";
  if (y.hand === g) return `${info.title} is in hand already`;
  if (y.open.done[g] === 1) return `${info.title} is done already`;
  return ready(y.open, g) ? null : `${info.title} is not open yet`;
}

/** Takes a node into hand in place of the one there, and out of the line if it was in it; what each has been given stays given. Says whether it could. */
export function takeNode(y: Yard, g: Goal): boolean {
  if (takeRefusal(y, g) !== null) return false;
  unqueue(y, g);
  hold(y, g);
  return true;
}

/** The node that comes into hand when the one there is finished: the first in line after it that may be taken now, out of the line; else the next by itself (`nextHand`). */
function upNext(y: Yard): Goal | -1 {
  const at = y.queue.findIndex((g) => takeRefusal(y, g) === null);
  return at < 0 ? nextHand(y.open) : (y.queue.splice(at, 1)[0] ?? -1);
}

/** Why a node cannot be put in line after the one in hand just now, or nothing if it can: as for taking it, and the line not full. */
export function queueRefusal(y: Yard, g: Goal): string | null {
  const why = takeRefusal(y, g);
  if (why !== null) return why;
  if (y.queue.includes(g)) return `${GOALS[g]?.title ?? ""} is in the line already`;
  return y.queue.length >= QUEUE ? `The line holds ${QUEUE} projects` : null;
}

/** Puts a node at the end of the line after the one in hand; with nothing in hand it is taken at once. Says whether it could. */
export function queue(y: Yard, g: Goal): boolean {
  if (queueRefusal(y, g) !== null) return false;
  if (y.hand === -1) hold(y, g);
  else y.queue.push(g);
  return true;
}

/** Takes a node out of the line after the one in hand, keeping what it has been given. Says whether it was there. */
export function unqueue(y: Yard, g: Goal): boolean {
  const at = y.queue.indexOf(g);
  if (at >= 0) y.queue.splice(at, 1);
  return at >= 0;
}

/** What finished nodes have left in the town, oldest first. */
export function townGifts(y: Yard): { id: string; title: string; line: string }[] {
  return y.done.flatMap((g) => {
    const node = NODES[g];
    return isNode(g) && node?.gift ? [{ id: node.gift.id, title: node.title, line: node.gift.line }] : [];
  });
}

// ---------- the board ----------

/**
 * Hangs orders on the board until it is full, once it is up. From tier 2 an order not yet filled
 * that asks only for things straight off the ground, hung before the board stopped asking for those,
 * is taken down, on every copy of the yard alike; a fresh one is hung in its place as `fresh` would
 * draw today. A yard with no seed, as the page's copy is, hangs none: it hears them from Leaf.
 */
export function fillBoard(y: Yard): void {
  if (!y.open.board) return;
  if (y.open.tier >= 2 && askable(y).some((k) => step(k) > 0))
    for (let slot = y.board.length - 1; slot >= 0; slot--) {
      const o = y.board[slot];
      if (o && !isFilled(o.want, o.filled) && ALL_ITEMS.every((k) => (o.want[k] ?? 0) === 0 || step(k) === 0))
        rehang(y, slot);
    }
  const seed = y.seed;
  if (seed === null) return;
  while (y.board.length < y.open.hooks) y.board.push(fresh(y, seed));
  if (y.news.length > 200) y.news.splice(0, y.news.length - 200);
}

/** Takes an order down, and hangs a fresh one at the end of the board, drawn while the old one still hung; a yard with no seed hangs none. */
function rehang(y: Yard, slot: number): void {
  const next = y.seed === null ? null : fresh(y, y.seed);
  y.board.splice(slot, 1);
  if (next) y.board.push(next);
}

/** Everything a yard could make on some land with what is open and the plots it owns: what lies in them, and whatever its machines make of that. */
export function makeableOn(land: Land, open: Open, plots: readonly Plot[]): Item[] {
  const can = new Uint8Array(ITEM_COUNT);
  const owned = land.plots.map((p) => plots.includes(p.plot));
  const { deposit, plot } = land;
  for (let i = 0; i < deposit.length; i++) {
    const raw = deposit[i] ?? NONE;
    if (raw !== NONE && owned[plot[i] ?? NONE] === true) can[raw] = 1;
  }
  // Then each thing a recipe it may make makes from what it can, its own thing or beside it, till none is new.
  const may = (r: Recipe): boolean => locked(open, { make: r.out }) === null && r.from.every((k) => can[k] === 1);
  for (let grew = true; grew;) {
    grew = false;
    for (const n of ALL_ITEMS) {
      if (can[n] === 1 || !makersOf(n).some(may)) continue;
      can[n] = 1;
      grew = true;
    }
  }
  return ALL_ITEMS.filter((k) => can[k] === 1);
}
/** Everything the yard could make as it stands. */
export const makeable = (y: Yard): Item[] => makeableOn(y.land, y.open, y.plots);

/** What the board may ask for: things the yard could make that the nodes done or in hand have given it a reason to make, and that the town buys. */
export function askable(y: Yard): Item[] {
  const met = new Uint8Array(ITEM_COUNT);
  for (const g of y.hand === -1 ? y.done : [...y.done, y.hand]) {
    const want = isNode(g) ? GOALS[g]?.want : undefined;
    for (const k of ALL_ITEMS) if ((want?.[k] ?? 0) > 0) for (const part of partsOf(k)) met[part] = 1;
  }
  return makeable(y).filter((k) => met[k] === 1 && ITEM_INFO[k]?.unsold !== true);
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
  // From tier 2 the board asks for nothing straight off the ground, unless that is all it could ask for.
  const all = askable(y);
  const made = y.open.tier >= 2 ? all.filter((k) => step(k) > 0) : all;
  const pool = made.length > 0 ? made : all;
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
  const budget = (ORDER_WORK.first + ORDER_WORK.tier * y.open.tier) * (second === null ? 1 : 0.6);
  const want = counts();
  let worth = 0;
  const items = second === null ? [first] : [first, second];
  for (const k of items) {
    const share = step(k) >= 4 ? ORDER_WORK.deepest : step(k) === 0 ? ORDER_WORK.ground : 1;
    const n = round((budget * share * (0.8 + roll() * 0.4)) / workOf(k));
    want[k] = n;
    worth += n * (WORTH[k] ?? 0);
  }
  const asks = ASKS[itemName(first)] ?? [];
  const ask = asks[Math.floor(roll() * asks.length)] ?? { from: "The guild", line: "" };
  const pay = Math.max(5, Math.round((worth * (second === null ? 1 : 1.15) * (0.9 + roll() * 0.2)) / 5) * 5);
  const title = titled(items, ask.from);
  return { id, title, from: ask.from, line: ask.line, want, pay, filled: counts(), starts: y.tick + ORDER_WAITS };
}

/** "Planks for the gate": the things lead, and a place loses its capital mid-sentence. */
function titled(items: readonly Item[], from: string): string {
  const things = items.map((k) => ITEM_INFO[k]?.many ?? "").join(" and ") || "things";
  const whom = from.startsWith("The ") ? `the ${from.slice(4)}` : from;
  return `${things.charAt(0).toUpperCase()}${things.slice(1)} for ${whom}`;
}

/** Where an order hangs on the board, by its id, or -1. */
const slotOf = (y: Yard, id: number): number => y.board.findIndex((o) => o.id === id);
/** The order on the board with an id, wherever it hangs; nothing once it has been taken down. */
export const orderAt = (y: Yard, id: number): Standing | undefined => y.board.find((o) => o.id === id);

/** Hands a filled standing order that counts over, by its id: it pays into the till and a fresh order takes its place. */
export function claim(y: Yard, id: number): number | null {
  const slot = slotOf(y, id);
  const order = y.board[slot];
  if (!order || !counting(order, y.tick) || !isFilled(order.want, order.filled)) return null;
  y.till += order.pay * MILLI;
  y.paid += order.pay * MILLI;
  y.handed++;
  y.news.push({ kind: "standing", id: order.id, title: order.title, pay: order.pay });
  rehang(y, slot);
  return order.pay;
}

/** Why an order on the board, by its id, cannot be swapped just now, or nothing if it can. */
export function swapRefusal(y: Yard, id: number): string | null {
  const order = orderAt(y, id);
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
