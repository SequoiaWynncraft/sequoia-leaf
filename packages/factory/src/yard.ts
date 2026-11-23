/**
 * The yard as flat data. Everything about a tile is a number in an array indexed by the tile;
 * what only some pieces have lives in side tables with a row for each such piece (`row`): the
 * holders (gatherers, mills, benches, workshops, crates, boilers) and the tunnels' near mouths.
 * Beside them, a few small records: the yard's numbers, its orders, what is open, its blueprints.
 *
 * The yard keeps no purse: what it earns gathers in `till` until a command pays it in.
 */
import { BLUEPRINTS, CRATE_HOLDS, SPAN } from "./content/machines.ts";
import { STORY } from "./content/story.ts";
import type { Land } from "./land.ts";
import {
  BENCH,
  BOILER,
  CRATE,
  DEPOT,
  GATHERER,
  GIVES,
  type Item,
  ITEM_COUNT,
  type Kind,
  kind,
  kindBit,
  MILL,
  NONE,
  type Plan,
  plan,
  PLAN_INFO,
  PLAN_OPENS,
  type Plot,
  plot,
  START_OPEN,
  STARTING,
  WORKSHOP,
} from "./tables.ts";

/** A count of each thing, by its number. */
export type Counts = Float64Array;
export const counts = (): Counts => new Float64Array(ITEM_COUNT);

/** What the gatherers, machines, crates and boilers hold: a row each. */
export interface Holders {
  size: number;
  /** The tile each row belongs to. */
  tile: Int32Array;
  /** A finished piece waiting to leave, what is being made next, and the one thing a machine was told to make. */
  out: Uint8Array;
  making: Uint8Array;
  recipe: Uint8Array;
  /** The work done on the next piece, in ticks at the plain pace: a fraction when power is short. */
  work: Float64Array;
  /** 1 while a machine has looked at what it holds and found nothing it can start on. */
  idle: Uint8Array;
  /** 1 while a crate lets things out. */
  open: Uint8Array;
  /** Ticks a boiler will go on burning what it last took. */
  fuel: Uint8Array;
  /** How many different things it holds, how many in all, and how many of each (`ITEM_COUNT` a row). */
  kinds: Uint8Array;
  count: Uint16Array;
  stock: Uint16Array;
}

/** What is under the ground in each tunnel, a row for each way-in mouth: a thing and its progress for each tile passed under. */
export interface Tunnels {
  size: number;
  tile: Int32Array;
  under: Uint8Array;
  along: Uint8Array;
}

/** A standing order on the board. */
export interface Standing {
  readonly id: number;
  readonly title: string;
  readonly from: string;
  readonly line: string;
  readonly want: Counts;
  readonly pay: number;
  readonly filled: Counts;
}

/** Something that happened which a screen will want to make a moment of. */
export type News =
  | { readonly kind: "story"; readonly index: number; readonly title: string; readonly pay: number }
  | { readonly kind: "filled"; readonly id: number; readonly title: string; readonly pay: number }
  | { readonly kind: "standing"; readonly id: number; readonly title: string; readonly pay: number };

/** A time the yard worked on while its owner was away: for how long, the Coins its till gained, and what its depot took in. */
export interface Away {
  readonly seconds: number;
  readonly coins: number;
  readonly made: Counts;
}

/** The yard at its owner's last command: the tick, what its till held, and what its depot had ever taken in. */
export interface Seen {
  readonly tick: number;
  readonly till: number;
  readonly depot: Counts;
}

/** How fast things go and how far things reach, with the plans bought counted in. */
export interface Rates {
  readonly gather: number;
  readonly belt: number;
  readonly craft: number;
  readonly reach: number;
  readonly crate: number;
  readonly depot: number;
  readonly slots: number;
}

/** What may be built, bought and read, a bit for each kind, plot and plan. */
export interface Open {
  readonly kinds: number;
  readonly plots: number;
  readonly plans: number;
  readonly board: boolean;
}

/** The yard's plumbing, worked out from what stands where (`wire.ts`). */
export interface Wire {
  /** Tiles that hand things on, each after the tiles it hands to. */
  readonly order: Int32Array;
  /** Tiles that carry, tiles that work, and boilers within reach of power. */
  readonly carry: Int32Array;
  readonly work: Int32Array;
  readonly boilers: Int32Array;
  /** For each tile, the sides it takes things in from, a bit each (`sidesTaken`). */
  readonly taken: Uint8Array;
  /** Power always there (the depot and the waterwheels), and power drawn. */
  readonly steady: number;
  readonly demand: number;
}

/** A piece kept in a blueprint, 9 bytes: kind, x, y, way, span, recipe, open, tint, shut. */
export const PIECE_BYTES = 9;

export interface Yard {
  readonly land: Land;
  /** What stands on each tile (`NONE` for nothing), and which way it sends things. */
  readonly kind: Uint8Array;
  readonly dir: Uint8Array;
  /** What a belt, splitter, joiner or tunnel mouth carries, and how far across its tile, in eighths. */
  readonly item: Uint8Array;
  readonly prog: Uint8Array;
  /** The side it was handed in from: 0 for none, else 1 and the way to that tile. Only for drawing. */
  readonly via: Uint8Array;
  /** A line's colour, 0 to 6; a splitter's next way out or a joiner's next way in; a splitter's shut ways, a bit each. */
  readonly tint: Uint8Array;
  readonly turn: Uint8Array;
  readonly shut: Uint8Array;
  /** 1 for one of the pieces a new yard has to hand: it cost nothing and gives nothing back. */
  readonly free: Uint8Array;
  /** For a tunnel, the tiles it passes under: positive at the mouth things go in at, negative at the other. */
  readonly span: Int8Array;
  /** The piece's row in `holders` (or for a tunnel's way-in mouth, in `tunnels`), or -1. */
  readonly row: Int32Array;
  holders: Holders;
  tunnels: Tunnels;
  /** Which tiles power reaches, 1 for each, while `powered`; worked out again when next read after a change. */
  readonly lit: Uint8Array;
  powered: boolean;
  wire: Wire | null;
  supply: number;
  demand: number;

  /** What the board's orders are drawn from; a yard read from a view has none, and hangs no order. */
  seed: number | null;
  tick: number;
  /** The moment of Leaf's clock `tick` stands for. */
  at: number;
  /** Coins earned and not yet paid in. */
  till: number;
  /** How many changes to Coins the yard has made, and how many story orders it has logged. */
  bank: number;
  told: number;
  away: Away | null;
  seen: Seen;
  /** Plots and plans owned, in the order they were bought. */
  plots: Plot[];
  plans: Plan[];
  /** The pieces to hand that are not standing, by kind. */
  readonly spare: Uint8Array;
  blueprints: (Uint8Array | null)[];
  story: number;
  filled: Counts;
  board: Standing[];
  serial: number;
  done: number;
  swapAt: number;
  depot: Counts;
  given: Counts;
  sold: number;
  paid: number;
  /** What the depot has been taking in since the yard was last changed; `warm` counts down ticks left out. */
  pace: { ticks: number; warm: number; made: Counts };
  rates: Rates;
  open: Open;
  news: News[];
}

/** Ticks left out of the pace after the yard is changed, while belts fill. */
export const WARM = 300;

const holders = (cap: number): Holders => ({
  size: 0,
  tile: new Int32Array(cap),
  out: new Uint8Array(cap),
  making: new Uint8Array(cap),
  recipe: new Uint8Array(cap),
  work: new Float64Array(cap),
  idle: new Uint8Array(cap),
  open: new Uint8Array(cap),
  fuel: new Uint8Array(cap),
  kinds: new Uint8Array(cap),
  count: new Uint16Array(cap),
  stock: new Uint16Array(cap * ITEM_COUNT),
});
const tunnels = (cap: number): Tunnels => ({
  size: 0,
  tile: new Int32Array(cap),
  under: new Uint8Array(cap * SPAN),
  along: new Uint8Array(cap * SPAN),
});

const PLAIN: Rates = { gather: 1, belt: 1, craft: 1, reach: 1, crate: CRATE_HOLDS, depot: GIVES[DEPOT] ?? 0, slots: 3 };

/** A yard with nothing on it but the depot, and the starting pieces to hand. */
export function emptyYard(land: Land, story = 0): Yard {
  const n = land.w * land.h;
  const y: Yard = {
    land,
    kind: new Uint8Array(n).fill(NONE),
    dir: new Uint8Array(n),
    item: new Uint8Array(n).fill(NONE),
    prog: new Uint8Array(n),
    via: new Uint8Array(n),
    tint: new Uint8Array(n),
    turn: new Uint8Array(n),
    shut: new Uint8Array(n),
    free: new Uint8Array(n),
    span: new Int8Array(n),
    row: new Int32Array(n).fill(-1),
    holders: holders(16),
    tunnels: tunnels(8),
    lit: new Uint8Array(n),
    powered: false,
    wire: null,
    supply: 0,
    demand: 0,
    seed: null,
    tick: 0,
    at: 0,
    till: 0,
    bank: 0,
    told: 0,
    away: null,
    seen: { tick: 0, till: 0, depot: counts() },
    plots: [plot("yard")],
    plans: [],
    spare: Uint8Array.from(STARTING),
    blueprints: Array.from({ length: BLUEPRINTS }, () => null),
    story: Math.max(0, Math.min(STORY.length, Math.floor(story))),
    filled: counts(),
    board: [],
    serial: 0,
    done: 0,
    swapAt: 0,
    depot: counts(),
    given: counts(),
    sold: 0,
    paid: 0,
    pace: { ticks: 0, warm: WARM, made: counts() },
    rates: PLAIN,
    open: { kinds: 0, plots: 0, plans: 0, board: false },
    news: [],
  };
  const [cx, cy] = land.depot;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const i = (cy + dy) * land.w + cx + dx;
      if (i >= 0 && i < n) y.kind[i] = DEPOT;
    }
  reopen(y);
  return y;
}

/** Works out again what is open and how fast things go, from the story so far and the plans owned. */
export function reopen(y: Yard): void {
  let kinds = START_OPEN;
  let plots = 1 << plot("yard");
  let plans = 0;
  let board = false;
  for (const order of STORY.slice(0, y.story)) {
    for (const k of order.opens.kinds ?? []) kinds |= kindBit(kind(k));
    for (const p of order.opens.plots ?? []) plots |= 1 << plot(p);
    for (const p of order.opens.plans ?? []) plans |= 1 << plan(p);
    if (order.opens.board) board = true;
  }
  let { gather, belt, craft, reach, crate, depot, slots } = PLAIN;
  PLAN_INFO.forEach((info, n) => {
    if (!info || !y.plans.includes(plan(info.id))) return;
    const e = info.effect;
    kinds |= PLAN_OPENS[n] ?? 0;
    gather = Math.max(gather, e.gather ?? 0);
    belt = Math.max(belt, e.belt ?? 0);
    craft = Math.max(craft, e.craft ?? 0);
    reach = Math.max(reach, e.reach ?? 0);
    crate = Math.max(crate, e.crate ?? 0);
    depot = Math.max(depot, e.depot ?? 0);
    slots = Math.max(slots, e.slots ?? 0);
  });
  y.open = { kinds, plots, plans, board };
  // Power reaches other tiles now, and who is in reach is part of the plumbing.
  if (reach !== y.rates.reach) {
    y.powered = false;
    y.wire = null;
  }
  y.rates = { gather, belt, craft, reach, crate, depot, slots };
}

/** Marks the yard as changed: its plumbing is worked out afresh, and its pace is measured from now. */
export function changed(y: Yard): void {
  y.wire = null;
  y.pace = { ticks: 0, warm: WARM, made: counts() };
}

/** Takes the whole Coins out of the till, and says how many. */
export function collect(y: Yard): number {
  const coins = Math.floor(y.till);
  y.till -= coins;
  return coins;
}

/** Takes the news a screen has not yet shown. */
export function drain(y: Yard): News[] {
  const news = y.news;
  y.news = [];
  return news;
}

// ---------- rows ----------

/** Whether a kind of piece holds things, and so has a row in `holders`. */
export const holds = (k: number): boolean =>
  k === GATHERER || k === MILL || k === BENCH || k === WORKSHOP || k === CRATE || k === BOILER;

/** A new row in a side table for the piece on a tile, the table grown if it is full. */
export function holderRow(y: Yard, tile: number): number {
  let h = y.holders;
  if (h.size === h.tile.length) {
    const bigger = holders(h.size * 2);
    for (const key of [
      "tile",
      "out",
      "making",
      "recipe",
      "work",
      "idle",
      "open",
      "fuel",
      "kinds",
      "count",
      "stock",
    ] as const)
      bigger[key].set(h[key]);
    bigger.size = h.size;
    y.holders = h = bigger;
  }
  const r = h.size++;
  h.tile[r] = tile;
  h.out[r] = NONE;
  h.making[r] = NONE;
  h.recipe[r] = NONE;
  h.work[r] = 0;
  h.idle[r] = 0;
  h.open[r] = 1;
  h.fuel[r] = 0;
  h.kinds[r] = 0;
  h.count[r] = 0;
  h.stock.fill(0, r * ITEM_COUNT, (r + 1) * ITEM_COUNT);
  return r;
}

export function tunnelRow(y: Yard, tile: number): number {
  let t = y.tunnels;
  if (t.size === t.tile.length) {
    const bigger = tunnels(t.size * 2);
    for (const key of ["tile", "under", "along"] as const) bigger[key].set(t[key]);
    bigger.size = t.size;
    y.tunnels = t = bigger;
  }
  const r = t.size++;
  t.tile[r] = tile;
  t.under.fill(NONE, r * SPAN, (r + 1) * SPAN);
  t.along.fill(0, r * SPAN, (r + 1) * SPAN);
  return r;
}

/** Gives back the row of the piece on a tile: the last row takes its place, so the rows stay packed. */
export function dropRow(y: Yard, tile: number): void {
  const r = y.row[tile] ?? -1;
  y.row[tile] = -1;
  if (r < 0) return;
  if (holds(y.kind[tile] ?? NONE)) {
    const h = y.holders;
    const last = --h.size;
    if (r !== last) {
      for (const key of ["tile", "out", "making", "recipe", "work", "idle", "open", "fuel", "kinds", "count"] as const)
        h[key][r] = h[key][last] ?? 0;
      h.stock.copyWithin(r * ITEM_COUNT, last * ITEM_COUNT, (last + 1) * ITEM_COUNT);
      y.row[h.tile[r] ?? 0] = r;
    }
  } else {
    const t = y.tunnels;
    const last = --t.size;
    if (r !== last) {
      t.tile[r] = t.tile[last] ?? 0;
      t.under.copyWithin(r * SPAN, last * SPAN, (last + 1) * SPAN);
      t.along.copyWithin(r * SPAN, last * SPAN, (last + 1) * SPAN);
      y.row[t.tile[r] ?? 0] = r;
    }
  }
}

/** Adds a thing to what a holder's row holds, and takes one away. */
export function put(h: Holders, r: number, n: number): void {
  const at = r * ITEM_COUNT + n;
  const had = h.stock[at] ?? 0;
  if (had === 0) h.kinds[r] = (h.kinds[r] ?? 0) + 1;
  h.stock[at] = had + 1;
  h.count[r] = (h.count[r] ?? 0) + 1;
  h.idle[r] = 0;
}
export function take(h: Holders, r: number, n: number): void {
  const at = r * ITEM_COUNT + n;
  const had = h.stock[at] ?? 0;
  if (had <= 0) return;
  if (had === 1) h.kinds[r] = (h.kinds[r] ?? 0) - 1;
  h.stock[at] = had - 1;
  h.count[r] = (h.count[r] ?? 1) - 1;
}
/** How many of a thing a holder's row holds. */
export const held = (h: Holders, r: number, n: Item | number): number => h.stock[r * ITEM_COUNT + n] ?? 0;

// ---------- pieces on tiles ----------

/** Sets a new piece of a kind down on a tile, facing a way, with a row if it needs one. */
export function place(y: Yard, i: number, k: Kind, d: number): void {
  vacate(y, i);
  y.kind[i] = k;
  y.dir[i] = d;
  if (holds(k)) y.row[i] = holderRow(y, i);
}

/** Takes whatever stands on a tile away, row and all, leaving it as new ground. */
export function vacate(y: Yard, i: number): void {
  dropRow(y, i);
  y.kind[i] = NONE;
  y.dir[i] = 0;
  y.item[i] = NONE;
  y.prog[i] = 0;
  y.via[i] = 0;
  y.tint[i] = 0;
  y.turn[i] = 0;
  y.shut[i] = 0;
  y.free[i] = 0;
  y.span[i] = 0;
}

/** The bytes a yard holds in memory: every array of it, its side tables and its plumbing; not its land, which yards share. */
export function bytesHeld(y: Yard): number {
  let n = 0;
  const add = (a: ArrayBufferView | null | undefined): void => {
    n += a?.byteLength ?? 0;
  };
  for (const a of [y.kind, y.dir, y.item, y.prog, y.via, y.tint, y.turn, y.shut, y.free, y.span, y.row, y.lit]) add(a);
  const h = y.holders;
  for (const a of [h.tile, h.out, h.making, h.recipe, h.work, h.idle, h.open, h.fuel, h.kinds, h.count, h.stock])
    add(a);
  for (const a of [y.tunnels.tile, y.tunnels.under, y.tunnels.along]) add(a);
  if (y.wire) for (const a of [y.wire.order, y.wire.carry, y.wire.work, y.wire.boilers, y.wire.taken]) add(a);
  for (const a of [y.spare, y.filled, y.depot, y.given, y.pace.made, y.seen.depot, ...y.blueprints]) add(a);
  for (const o of y.board) for (const a of [o.want, o.filled]) add(a);
  return n;
}
