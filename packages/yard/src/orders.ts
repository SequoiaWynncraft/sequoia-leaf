/**
 * Orders. The depot pays a little for everything it takes in; orders are where the Coins are.
 *
 * There is the story, one order after another, and once it is under way there is the board: a few
 * standing orders from places in town and the town's own, which never run out and never expire. Each
 * thing the depot takes in goes toward one order that still wants it, the story's first and then
 * the board's from the top. A story order pays the moment it is filled; a standing order, once
 * filled, waits on the board until it is handed over (`claim`), so the board is never emptied
 * behind the member's back.
 */
import { ASKS } from "./content/asks.ts";
import { ITEM, type Item, ITEMS, type Raw, type Tally } from "./content/items.ts";
import { partsOf, RECIPES, workOf } from "./content/recipes.ts";
import { STORY, type StoryOrder } from "./content/story.ts";
import { reopen, type Standing, type World } from "./world.ts";

/** The share of a thing's worth the depot pays for it on arrival, whether or not an order wants it. */
export const DEPOT_SHARE = 0.01;
/**
 * How big a standing order is, in ticks of work by every gatherer and machine that has a hand in
 * it: this much when the board first goes up, and this much more for each story order done.
 * The two goods that take the whole yard are asked for in smaller numbers than their work alone
 * would give, and so are things straight from the ground.
 */
const ORDER_WORK = { first: 6000, more: 600, deepest: 0.4, ground: 0.3 } as const;
/** Ticks between free swaps: ten minutes of the yard's time. */
export const SWAP_EVERY = 6000;

/** The depot takes in `n` of a thing while the yard runs: it counts toward the yard's pace as well. */
export function deliver(w: World, item: Item, n: number): void {
  if (w.pace.warm <= 0) w.pace.made[item] = (w.pace.made[item] ?? 0) + n;
  takeIn(w, item, n);
}

/** The depot takes in `n` of a thing: pays its price, and puts it toward whichever orders want it. */
export function takeIn(w: World, item: Item, n: number): void {
  if (n <= 0) return;
  w.depot[item] = (w.depot[item] ?? 0) + n;
  const coins = ITEM[item].worth * DEPOT_SHARE * n;
  w.till += coins;
  w.sold += coins;
  let left = n;
  for (let tries = 0; left > 0 && tries < 64; tries++) {
    const used = offer(w, item, left);
    if (used === 0) break;
    left -= used;
  }
}

/** Puts up to `n` of a thing toward the first order that wants it, and says how many it took. */
function offer(w: World, item: Item, n: number): number {
  const story = STORY[w.story];
  const need = (story?.want[item] ?? 0) - (w.filled[item] ?? 0);
  if (story && need > 0) {
    const used = Math.min(n, need);
    w.filled[item] = (w.filled[item] ?? 0) + used;
    w.given[item] = (w.given[item] ?? 0) + used;
    if (isFilled(story.want, w.filled)) finishStory(w, story);
    return used;
  }
  for (const order of w.board) {
    const wants = (order.want[item] ?? 0) - (order.filled[item] ?? 0);
    if (wants <= 0) continue;
    const used = Math.min(n, wants);
    order.filled[item] = (order.filled[item] ?? 0) + used;
    w.given[item] = (w.given[item] ?? 0) + used;
    // A filled order waits on the board to be handed over: see `claim`.
    if (isFilled(order.want, order.filled))
      w.news.push({ kind: "filled", id: order.id, title: order.title, pay: order.pay });
    return used;
  }
  return 0;
}

/** Whether everything an order wants has come in. */
export const isFilled = (want: Tally, filled: Tally): boolean => ITEMS.every((k) => (filled[k] ?? 0) >= (want[k] ?? 0));

function finishStory(w: World, order: StoryOrder): void {
  w.till += order.pay;
  w.paid += order.pay;
  w.news.push({ kind: "story", index: w.story, title: order.title, pay: order.pay });
  w.story++;
  w.filled = {};
  reopen(w);
  fillBoard(w);
}

/** Hangs orders on the board until it is full, once the story has put the board up. A yard with no seed hangs none. */
export function fillBoard(w: World): void {
  const seed = w.seed;
  if (!w.open.board || seed === null) return;
  while (w.board.length < w.rates.slots) w.board.push(fresh(w, seed));
  if (w.news.length > 200) w.news.splice(0, w.news.length - 200);
}

/** Takes an order down and hangs a fresh one in its place; a yard with no seed leaves the place empty. */
function rehang(w: World, slot: number): void {
  if (w.seed === null) w.board.splice(slot, 1);
  else w.board[slot] = fresh(w, w.seed);
}

/** Everything the yard could make as it stands: what lies in its plots, and whatever its machines make of that. */
export function makeable(w: World): Item[] {
  const can = new Set<Item>();
  const owned = w.land.plots.map((p) => w.plots.includes(p.id));
  w.land.deposit.forEach((raw: Raw | null, i) => {
    if (raw !== null && owned[w.land.plot[i] ?? -1]) can.add(raw);
  });
  for (let grew = true; grew;) {
    grew = false;
    for (const r of RECIPES) {
      if (can.has(r.out) || !w.open.kinds.has(r.by) || !r.from.every((k) => can.has(k))) continue;
      can.add(r.out);
      grew = true;
    }
  }
  return ITEMS.filter((item) => can.has(item));
}

/**
 * What the board may ask for: things the yard could make as it stands, and that the story has
 * given it a reason to make (what its orders so far have wanted, the one in hand included, and
 * everything that goes into those). So nothing turns up on the board before the story has shown it.
 */
export function askable(w: World): Item[] {
  const met = new Set<Item>();
  for (const order of STORY.slice(0, w.story + 1))
    for (const item of ITEMS) if ((order.want[item] ?? 0) > 0) for (const part of partsOf(item)) met.add(part);
  return makeable(w).filter((item) => met.has(item));
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

/**
 * The next standing order. It is drawn from the yard's seed and how many orders the board has shown
 * before, so the same yard is always offered the same orders; it asks only for things the yard
 * could make as it stands and has met in the story, and for more of them the further the story has
 * come.
 */
export function fresh(w: World, seed: number): Standing {
  const id = w.serial++;
  const roll = dice(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(id + 1, 0xc2b2ae35));
  const pool = askable(w);
  const taken = new Set(w.board.flatMap((o) => ITEMS.filter((k) => (o.want[k] ?? 0) > 0)));
  // Things from deeper in the yard are asked for more often, and what is already on the board less.
  const pick = (not: Item | null): Item | null => {
    const weights = pool.map((k) => (k === not ? 0 : (0.4 + ITEM[k].step) * (taken.has(k) ? 0.15 : 1)));
    let at = roll() * weights.reduce((a, b) => a + b, 0);
    for (const [n, k] of pool.entries()) {
      at -= weights[n] ?? 0;
      if (at < 0) return k;
    }
    return pool.find((k) => k !== not) ?? null;
  };
  const first = pick(null) ?? "plank";
  const second = pool.length > 2 && roll() < 0.35 ? pick(first) : null;
  const budget = (ORDER_WORK.first + ORDER_WORK.more * w.story) * (second === null ? 1 : 0.6);
  const want: Tally = {};
  let worth = 0;
  for (const item of second === null ? [first] : [first, second]) {
    const share = ITEM[item].step === 4 ? ORDER_WORK.deepest : ITEM[item].step === 0 ? ORDER_WORK.ground : 1;
    const n = round((budget * share * (0.8 + roll() * 0.4)) / workOf(item));
    want[item] = n;
    worth += n * ITEM[item].worth;
  }
  const asks = ASKS[first];
  const ask = asks[Math.floor(roll() * asks.length)] ?? { from: "The guild", line: "" };
  const pay = Math.max(5, Math.round((worth * (second === null ? 1 : 1.15) * (0.9 + roll() * 0.2)) / 5) * 5);
  return {
    id,
    title: titled(second === null ? [first] : [first, second], ask.from),
    from: ask.from,
    line: ask.line,
    want,
    pay,
    filled: {},
  };
}

/** "Planks for the gate": the things lead, and a place loses its capital mid-sentence. */
function titled(items: readonly Item[], from: string): string {
  const things = items.map((k) => ITEM[k].many).join(" and ") || "things";
  const whom = from.startsWith("The ") ? `the ${from.slice(4)}` : from;
  return `${things.charAt(0).toUpperCase()}${things.slice(1)} for ${whom}`;
}

/** Everybody (and everywhere) that asks for things on the board today. */
const ASKERS = new Set(Object.values(ASKS).flatMap((list) => list.map((a) => a.from)));

/**
 * A standing order kept from before the board's askers changed, asked again by one of today's
 * for the same things, so that nobody asks who no longer does. Anything else comes back as it was.
 */
export function reask(o: Standing): Standing {
  if (ASKERS.has(o.from)) return o;
  const first = ITEMS.find((k) => (o.want[k] ?? 0) > 0) ?? "plank";
  const asks = ASKS[first];
  const ask = asks[o.id % asks.length] ?? { from: "The guild", line: "" };
  const items = ITEMS.filter((k) => (o.want[k] ?? 0) > 0);
  return { ...o, title: titled(items, ask.from), from: ask.from, line: ask.line };
}

/** Where an order hangs on the board, by its id, or -1. */
const slotOf = (w: World, id: number): number => w.board.findIndex((o) => o.id === id);

/**
 * Hands a filled standing order over, by its id: it pays into the till and a fresh order takes its
 * place. A filled order waits for this for as long as it takes; nothing on the board ever runs out.
 * Gives back what it paid, or nothing if that order is not on the board filled.
 */
export function claim(w: World, id: number): number | null {
  const slot = slotOf(w, id);
  const order = w.board[slot];
  if (!order || !isFilled(order.want, order.filled)) return null;
  w.till += order.pay;
  w.paid += order.pay;
  w.done++;
  w.news.push({ kind: "standing", id: order.id, title: order.title, pay: order.pay });
  rehang(w, slot);
  return order.pay;
}

/** Why an order on the board, by its id, cannot be swapped just now, or nothing if it can. */
export function swapRefusal(w: World, id: number): string | null {
  const order = w.board[slotOf(w, id)];
  if (!order) return "There is no such order";
  if (isFilled(order.want, order.filled)) return "That order is filled. Hand it over instead";
  if (w.tick < w.swapAt) {
    const minutes = Math.ceil((w.swapAt - w.tick) / 600);
    return `You can replace an order again in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return null;
}

/** Swaps an order on the board, by its id, for a fresh one, free, once every so often. Says whether it did. */
export function swap(w: World, id: number): boolean {
  if (swapRefusal(w, id) !== null) return false;
  rehang(w, slotOf(w, id));
  w.swapAt = w.tick + SWAP_EVERY;
  return true;
}

/** The story order in hand, if the story is not over. */
export const storyOrder = (w: World): StoryOrder | null => STORY[w.story] ?? null;

/** What finished story orders have left in the town, oldest first. */
export function townGifts(w: World): { id: string; title: string; line: string }[] {
  return STORY.slice(0, w.story).flatMap((o) => (o.gift ? [{ id: o.gift.id, title: o.title, line: o.gift.line }] : []));
}
