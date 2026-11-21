/**
 * The yard as plain data: what stands on each tile and what it is holding, what has been opened and
 * bought, the orders in hand, and the Coins the yard has earned and not yet handed over.
 *
 * The yard does not keep the member's purse. Anything that costs Coins is told the balance and says
 * what it took; whatever the yard earns gathers in `till` until `collect` hands it over.
 */
import type { Item, Tally } from "./content/items.ts";
import { CRATE, KIND, type Kind, START_KINDS } from "./content/machines.ts";
import { type PlanId, PLANS } from "./content/plans.ts";
import type { PlotId } from "./content/plots.ts";
import { STORY } from "./content/story.ts";
import type { Dir } from "./grid.ts";
import type { Land } from "./land.ts";

export interface Building {
  kind: Kind;
  /** Which way it sends things on. */
  dir: Dir;
  /** What a belt, splitter, joiner or tunnel mouth is carrying, and how far across the tile it has come, 0 to 1. */
  item: Item | null;
  prog: number;
  /** What a machine, crate or boiler holds, how many different things that is, and how many in all. */
  buf: Tally;
  kinds: number;
  count: number;
  /** A finished piece waiting to leave, the work done on the next one in ticks, and what that next one is. */
  out: Item | null;
  work: number;
  making: Item | null;
  /** Set while a machine has looked at what it holds and found nothing it can start on. */
  idle: boolean;
  /** Whose turn it is: a splitter's next way out, a joiner's next way in. */
  turn: number;
  /** The one thing a machine has been told to make, or nothing if it goes by what arrives. */
  recipe: Item | null;
  /**
   * For a tunnel: how many tiles it passes under. The mouth things go in at has the number, the
   * mouth they come out of has it negated. The way-in mouth also holds what is under the ground.
   */
  span: number;
  under: (Item | null)[];
  underProg: number[];
  /** Whether a crate is letting things out. */
  open: boolean;
  /** Ticks a boiler will go on burning what it last took. */
  fuel: number;
}

export const blank = (kind: Kind, dir: Dir): Building => ({
  kind,
  dir,
  item: null,
  prog: 0,
  buf: {},
  kinds: 0,
  count: 0,
  out: null,
  work: 0,
  making: null,
  idle: false,
  turn: 0,
  recipe: null,
  span: 0,
  under: [],
  underProg: [],
  open: true,
  fuel: 0,
});

/** A standing order on the board. */
export interface Standing {
  /** Which order this is, counting from the first the board ever showed. */
  readonly id: number;
  readonly title: string;
  readonly from: string;
  readonly line: string;
  readonly want: Tally;
  readonly pay: number;
  filled: Tally;
}

/**
 * Something that happened which a screen will want to make a moment of: a story order done, a
 * standing order filled and waiting, a standing order handed over and paid.
 */
export type News =
  | { readonly kind: "story"; readonly index: number; readonly title: string; readonly pay: number }
  | { readonly kind: "filled"; readonly id: number; readonly title: string; readonly pay: number }
  | { readonly kind: "standing"; readonly id: number; readonly title: string; readonly pay: number };

/** How fast things go and how far things reach, with the plans that have been bought counted in. */
export interface Rates {
  gather: number;
  belt: number;
  craft: number;
  reach: number;
  crate: number;
  depot: number;
  slots: number;
}

/** What may be built, bought and read: worked out from how far the story has come and the plans owned. */
export interface Open {
  kinds: Set<Kind>;
  plots: Set<PlotId>;
  plans: Set<PlanId>;
  board: boolean;
}

/** The yard's plumbing, worked out from what stands where; see `step.ts`. */
export interface Wire {
  /** Tiles that hand things on, each after the tiles it hands to. */
  readonly order: number[];
  /** Tiles that carry, tiles that work, and boilers within reach of power. */
  readonly carry: number[];
  readonly work: number[];
  readonly boilers: number[];
  /** For each tile: the tile it hands to, the tile behind it, and up to three ways out or in. */
  readonly next: Int32Array;
  readonly back: Int32Array;
  readonly ways: Int32Array;
  /** Power that is always there (the depot and the waterwheels), and power drawn. */
  readonly steady: number;
  readonly demand: number;
}

export interface World {
  readonly land: Land;
  readonly cells: (Building | null)[];
  /** Which tiles power reaches; worked out again whenever a pylon is built or taken away. */
  power: Uint8Array;
  /** What the board's orders are drawn from. */
  seed: number;
  /** How many ticks the yard has been run. */
  tick: number;
  /** The moment the yard has been run up to, and the moment a second shift ends, as the clock on the wall has them. */
  seen: number;
  boostUntil: number;
  /** Coins earned and not yet handed over. */
  till: number;
  plots: PlotId[];
  plans: PlanId[];
  /** How many story orders are done, and what has come in toward the one in hand. */
  story: number;
  filled: Tally;
  /** The standing orders, how many the board has ever shown, how many were filled, and the tick a swap is next free. */
  board: Standing[];
  serial: number;
  done: number;
  swapAt: number;
  /** Everything the depot has ever taken in, and the part of it that went to orders: what the town has been given. */
  depot: Tally;
  given: Tally;
  /** Coins the yard has ever earned, from the depot's prices and from orders. */
  sold: number;
  paid: number;
  /**
   * What the depot has been taking in since the yard was last changed: over how many ticks, and
   * how many of each thing. `warm` counts down the ticks after a change that are left out.
   */
  pace: { ticks: number; warm: number; made: Tally };
  // Worked out, never saved.
  rates: Rates;
  open: Open;
  supply: number;
  demand: number;
  wire: Wire | null;
  news: News[];
}

/** What a new yard has in its till: enough for a first line. */
export const START_FLOAT = 140;
/** Ticks left out of the pace after the yard is changed, while belts fill. */
export const WARM = 300;

/** Works out again what is open and how fast things go, from the story so far and the plans owned. */
export function reopen(w: World): void {
  const kinds = new Set<Kind>(START_KINDS);
  const plots = new Set<PlotId>(["yard"]);
  const plans = new Set<PlanId>();
  let board = false;
  for (const order of STORY.slice(0, w.story)) {
    for (const k of order.opens.kinds ?? []) kinds.add(k);
    for (const p of order.opens.plots ?? []) plots.add(p);
    for (const p of order.opens.plans ?? []) plans.add(p);
    if (order.opens.board) board = true;
  }
  const rates: Rates = { gather: 1, belt: 1, craft: 1, reach: 1, crate: CRATE, depot: KIND.depot.gives, slots: 3 };
  for (const plan of PLANS) {
    if (!w.plans.includes(plan.id)) continue;
    const e = plan.effect;
    for (const k of e.opens ?? []) kinds.add(k);
    rates.gather = Math.max(rates.gather, e.gather ?? 0);
    rates.belt = Math.max(rates.belt, e.belt ?? 0);
    rates.craft = Math.max(rates.craft, e.craft ?? 0);
    rates.reach = Math.max(rates.reach, e.reach ?? 0);
    rates.crate = Math.max(rates.crate, e.crate ?? 0);
    rates.depot = Math.max(rates.depot, e.depot ?? 0);
    rates.slots = Math.max(rates.slots, e.slots ?? 0);
  }
  w.open = { kinds, plots, plans, board };
  w.rates = rates;
}

/** Marks the yard as changed: its plumbing is worked out afresh, and its pace is measured from now. */
export function changed(w: World): void {
  w.wire = null;
  w.pace = { ticks: 0, warm: WARM, made: {} };
}

/** The place of a tile in the yard's lists, or -1 off the map. */
export const at = (w: World, x: number, y: number): number =>
  x < 0 || y < 0 || x >= w.land.w || y >= w.land.h ? -1 : y * w.land.w + x;

/** The plot a tile is on, and whether the yard owns it. */
export function plotAt(w: World, x: number, y: number): { id: PlotId; owned: boolean } | null {
  const i = at(w, x, y);
  const plot = i < 0 ? undefined : w.land.plots[w.land.plot[i] ?? -1];
  return plot ? { id: plot.id, owned: w.plots.includes(plot.id) } : null;
}

/** Hands over what the yard has earned since it was last asked, and empties the till. */
export function collect(w: World): number {
  const coins = Math.floor(w.till);
  w.till -= coins;
  return coins;
}

/** Takes the news a screen has not yet shown. */
export function drain(w: World): News[] {
  const news = w.news;
  w.news = [];
  return news;
}

/** Adds things to what a machine, crate or boiler holds, and takes one away. */
export function put(b: Building, item: Item): void {
  const n = b.buf[item] ?? 0;
  if (n === 0) b.kinds++;
  b.buf[item] = n + 1;
  b.count++;
  b.idle = false;
}
export function take(b: Building, item: Item): void {
  const n = b.buf[item] ?? 0;
  if (n <= 0) return;
  if (n === 1) b.kinds--;
  b.buf[item] = n - 1;
  b.count--;
}
