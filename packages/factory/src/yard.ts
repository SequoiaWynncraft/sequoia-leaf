/**
 * The yard as flat data. Everything about a tile is a number in an array indexed by the tile;
 * what only some pieces have lives in side tables with a row for each such piece (`row`): the
 * holders (gatherers, mills, benches, workshops, crates, boilers, Studies) and the tunnels' near mouths.
 * Beside them, a few small records: the yard's numbers, its goals and orders, its blueprints, and
 * what is open, worked out from the goals done.
 *
 * The yard keeps no purse: what it earns gathers in `till` until a command pays it in.
 */
import type { Land } from "./land.ts";
import type { Wire } from "./plumbing.ts";

export type { Rings, Wire } from "./plumbing.ts";
import { FACING, layOver, pieceOf } from "./sizes.ts";
import {
  BLUEPRINTS_MOST,
  DEPOT,
  type Goal,
  GOALS,
  goalsBelow,
  gradeOf,
  HOLDS,
  type Item,
  ITEM_COUNT,
  type Kind,
  MILLI,
  nextHand,
  NONE,
  type Open,
  openOf,
  type Plot,
  plot,
  type Recipe,
  SPAN_MOST,
  SPANS,
  STARTING,
} from "./tables.ts";

/** A count of each thing, by its number. */
export type Counts = Float64Array;
export const counts = (): Counts => new Float64Array(ITEM_COUNT);

/** What the gatherers, machines, crates, boilers and Studies hold: a row each. */
export interface Holders {
  size: number;
  /** The tile each row belongs to. */
  tile: Int32Array;
  /** A finished thing waiting to leave, and what is being made next. */
  out: Uint8Array;
  /** What was made beside it (a recipe's by-product), waiting to leave by its own way out, or `NONE` (`KindDef.ports`). */
  also: Uint8Array;
  /**
   * How many more of the finished thing (`out`) it holds beyond the one there, waiting to leave after
   * it: a machine that stands in for several (`TIMES_MOST`, the assembler's 9 benches) holds one for
   * each, so its belt's timing never holds its work up. 0 for every other.
   */
  more: Uint8Array;
  making: Uint8Array;
  /**
   * What a machine last began to make, or `NONE` before it has begun anything (`lastRecipe`). It is
   * the piece's, so it goes when the piece is taken away; it is neither kept in a save nor checked,
   * so a page carries it over to a yard it reads afresh (`keepLast`).
   */
  last: Uint8Array;
  /** The work done on the next piece, in half-ticks (`tick.ts`). */
  work: Uint16Array;
  /** For a piece that breaks one thing into several, its place in its mix: what it gives next (`kinds/mix.ts`). */
  mix: Uint8Array;
  /** For a piece smog slows, the quarters of a half-tick of work done past its whole half-ticks, 0 to 3, toward its next tick's (`tick.ts`). */
  quarter: Uint8Array;
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

/** A standing order on the board, and the tick from which it counts. */
export interface Standing {
  readonly id: number;
  readonly title: string;
  readonly from: string;
  readonly line: string;
  readonly want: Counts;
  readonly pay: number;
  readonly filled: Counts;
  readonly starts: number;
}

/** Something that happened which a screen will want to make a moment of: a node finished or research known, a standing order filled or handed over. */
export type News =
  | { readonly kind: "done"; readonly goal: string; readonly title: string; readonly pay: number }
  | { readonly kind: "filled"; readonly id: number; readonly title: string; readonly pay: number }
  | { readonly kind: "standing"; readonly id: number; readonly title: string; readonly pay: number }
  /** A plot being cleared has all it wants: it waits to be handed over (`handClearing`). */
  | { readonly kind: "clearing"; readonly plot: string; readonly title: string; readonly pay: number };

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

/**
 * Smog on each plot, by its place in the land's `plots` (`smog.ts`): its level, 0 to `SMOG.most`, and
 * what was made on it since it was last counted, both kept and checked. Worked out from the level, and
 * neither kept nor checked: each plot's pace in fourths (4, or 3, 2 and 1 at smog's steps) and how many
 * plots are slowed, changed only where a level is set (`setLevel`), so the tick reads a plot's pace
 * only while some plot is slowed; and a place to count the redwoods standing on each plot (`standingInto`).
 */
export interface Smog {
  readonly level: Uint16Array;
  readonly made: Uint16Array;
  readonly pace: Uint8Array;
  slowed: number;
  readonly standing: Uint8Array;
}

/** Something done that Undo would undo, as the rules keep it (`history.ts`): its bytes, and its id, read from them: the id of the command that did it. */
export interface Entry {
  readonly id: string;
  readonly bytes: Uint8Array;
  /** The most tiles any piece it would stand again passes under: what keeping it asks, without reading it again. */
  readonly span: number;
  /** The highest kind, by its number, of any piece it would stand again, -1 for none: what keeping it asks too. */
  readonly top: number;
}

/** A piece kept in a blueprint, 10 bytes: kind, x, y, way, span, recipe, open, tint, a splitter's ways or a sorter's side (`packWays`), grade. */
export const PIECE_BYTES = 10;

/**
 * A blueprint: its pieces, `PIECE_BYTES` a piece, and whether it is a plan of the whole yard
 * (`whole.ts`), whose pieces are kept on the tiles they stood on and go back there. Any other has its
 * pieces from the corner of their box, and is set down wherever it is aimed.
 */
export interface Print {
  readonly pieces: Uint8Array;
  readonly whole: boolean;
}

export interface Yard {
  readonly land: Land;
  /** What stands on each tile (`NONE` for nothing), and which way it sends things. */
  readonly kind: Uint8Array;
  readonly dir: Uint8Array;
  /**
   * For each tile of a piece of more than one tile, where the piece's own tile is from it (`sizes.ts`:
   * every other part of the piece is kept on its own tile, once); 0 for every other tile.
   */
  readonly part: Uint8Array;
  /** What a belt, splitter, joiner or tunnel mouth carries, and how far across its tile, in eighths. */
  readonly item: Uint8Array;
  readonly prog: Uint8Array;
  /** The side it was handed in from: 0 for none, else 1 and the way to that tile. Only for drawing. */
  readonly via: Uint8Array;
  /**
   * A line's colour, 0 to 6; a splitter's next way out or a joiner's next way in; a splitter's shut
   * ways, a bit each; and the way a splitter puts first, 1 + the way, or 0 for none, or for a sorter
   * 3 where it sends the thing it is set to to its right and 0 where to its left (`sortWay`).
   */
  readonly tint: Uint8Array;
  readonly turn: Uint8Array;
  readonly shut: Uint8Array;
  readonly first: Uint8Array;
  /**
   * A splitter's ways out turned to take things in, a bit each as `shut` has them (1 ahead, 2 left,
   * 4 right): never a shut way, nor the way it puts first. Things come in by these and from behind
   * in turn, the next of them kept in `turn` over its next way out (`inTurn`).
   */
  readonly ins: Uint8Array;
  /** The one thing a machine is told to make, or `NONE`. */
  readonly set: Uint8Array;
  /** A piece's grade, 1 to 3, or 0 for a kind that has none. */
  readonly grade: Uint8Array;
  /** 1 for one of the pieces a new yard has to hand: it cost nothing and gives nothing back. */
  readonly free: Uint8Array;
  /** For a tunnel, the tiles it passes under: positive at the mouth things go in at, negative at the other. */
  readonly span: Int8Array;
  /** The piece's row in `holders` (or for a tunnel's way-in mouth, in `tunnels`), or -1. */
  readonly row: Int32Array;
  /**
   * How many times each tile has been cleared (`vacate`, as taking a piece away and standing one do),
   * counting round from 255 to 0: a piece taken up, whether or not another like it is stood in its
   * place, is told from one that stayed, within a command (`history.ts`). Neither kept nor checked:
   * reading a yard back stands every piece anew.
   */
  readonly made: Uint8Array;
  holders: Holders;
  tunnels: Tunnels;
  /** Which tiles power reaches, 1 for each, while `powered`; worked out again when next read after a change. */
  readonly lit: Uint8Array;
  powered: boolean;
  wire: Wire | null;
  supply: number;
  demand: number;
  /** Power put by toward the next tick the machines work, while the yard is short of it (`tick.ts`). */
  charge: number;

  /** What the board's orders are drawn from; a yard read from a view has none, and hangs no order. */
  seed: number | null;
  tick: number;
  /** The moment of Leaf's clock `tick` stands for. */
  at: number;
  /** Coins earned and not yet paid in, in thousandths; and all the yard has earned from the depot and from orders. */
  till: number;
  /** How many changes to Coins the yard has made, and how many of the goals done it has logged. */
  bank: number;
  told: number;
  away: Away | null;
  seen: Seen;
  /** Plots owned, in the order they were bought. */
  plots: Plot[];
  /**
   * The plot being cleared, one at a time, what it asks for and what has been delivered to it; the plots cleared, in
   * the order they were handed over, for good (`clearing.ts`).
   */
  clearing: {
    readonly plot: Plot;
    /** Its name: the id of the command that took it on, or for one taken on with none, `#` and the count of starts (`begun`). */
    readonly start: string;
    /** What it asks for, as the table had it when it was begun: a later change to the table does not touch it. */
    readonly want: Counts;
    readonly filled: Counts;
  } | null;
  cleared: Plot[];
  /**
   * How many clearings the yard has taken on, ever: a start with no command id is named by it
   * (`start` above), so that it too has a name no other start of the yard has.
   */
  begun: number;
  /**
   * Smog on each plot, by its place in the land's `plots` (`smog.ts`): its level, 0 to `SMOG.most`,
   * and what was made on it since it was last counted.
   */
  readonly smog: Smog;
  /**
   * 1 for each of the land's redwoods the yard has felled (`fell`), by its place in the land's
   * `trees`. Every rule asks whether one stands on a tile through `redwoodAt`, never the land alone.
   */
  readonly felled: Uint8Array;
  /** The pieces to hand that are not standing, by kind. */
  readonly spare: Uint8Array;
  blueprints: (Print | null)[];
  /**
   * The goals done, in the order they were done; the node in hand, or -1; the nodes waiting after it,
   * in the player's order; the research being studied and that waiting after it; and what each goal
   * not done has been given.
   */
  done: Goal[];
  hand: Goal | -1;
  queue: Goal[];
  line: Goal[];
  got: (Counts | null)[];
  board: Standing[];
  serial: number;
  /** How many standing orders have been handed over. */
  handed: number;
  swapAt: number;
  depot: Counts;
  sold: number;
  paid: number;
  /** Worked out from the goals done (`reopen`). */
  open: Open;
  news: News[];
  /** What Undo would undo, the newest last (`history.ts`). */
  history: Entry[];
  /**
   * How many changes the rules have made to the yard other than running it on: each command done
   * (`play`), and each time what is open is worked out again (`reopen`, as a goal is finished).
   * Whatever is worked out from the yard and kept is kept by the yard and this. It is not written
   * or checked: a yard read afresh is another yard, and starts again.
   */
  rev: number;
}

const holders = (cap: number): Holders => ({
  size: 0,
  tile: new Int32Array(cap),
  out: new Uint8Array(cap),
  also: new Uint8Array(cap),
  more: new Uint8Array(cap),
  making: new Uint8Array(cap),
  last: new Uint8Array(cap),
  work: new Uint16Array(cap),
  mix: new Uint8Array(cap),
  quarter: new Uint8Array(cap),
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
  under: new Uint8Array(cap * SPAN_MOST),
  along: new Uint8Array(cap * SPAN_MOST),
});

/**
 * Room in a yard's side tables, still empty, for so many holders and tunnels: a yard read back takes
 * the room its pieces need, where rows added one by one would leave a third more as they grow by half.
 */
export function reserve(y: Yard, holderRows: number, tunnelRows: number): void {
  if (y.holders.size === 0) y.holders = holders(Math.max(16, holderRows));
  if (y.tunnels.size === 0) y.tunnels = tunnels(Math.max(8, tunnelRows));
}

/** A yard with nothing on it but the depot, and the starting pieces to hand; every goal below `tier` done, for trying later parts. */
export function emptyYard(land: Land, tier = 0): Yard {
  const n = land.w * land.h;
  const done = goalsBelow(tier);
  const y: Yard = {
    land,
    kind: new Uint8Array(n).fill(NONE),
    dir: new Uint8Array(n),
    part: new Uint8Array(n),
    item: new Uint8Array(n).fill(NONE),
    prog: new Uint8Array(n),
    via: new Uint8Array(n),
    tint: new Uint8Array(n),
    turn: new Uint8Array(n),
    shut: new Uint8Array(n),
    ins: new Uint8Array(n),
    first: new Uint8Array(n),
    set: new Uint8Array(n).fill(NONE),
    grade: new Uint8Array(n),
    free: new Uint8Array(n),
    span: new Int8Array(n),
    row: new Int32Array(n).fill(-1),
    made: new Uint8Array(n),
    holders: holders(16),
    tunnels: tunnels(8),
    lit: new Uint8Array(n),
    powered: false,
    wire: null,
    supply: 0,
    demand: 0,
    charge: 0,
    seed: null,
    tick: 0,
    at: 0,
    till: 0,
    bank: 0,
    told: done.length,
    away: null,
    seen: { tick: 0, till: 0, depot: counts() },
    plots: [plot("yard")],
    clearing: null,
    cleared: [],
    begun: 0,
    smog: {
      level: new Uint16Array(land.plots.length),
      made: new Uint16Array(land.plots.length),
      pace: new Uint8Array(land.plots.length).fill(4),
      slowed: 0,
      standing: new Uint8Array(land.plots.length),
    },
    felled: new Uint8Array(land.trees.length),
    spare: Uint8Array.from(STARTING),
    blueprints: Array.from({ length: BLUEPRINTS_MOST }, () => null),
    done,
    hand: -1,
    queue: [],
    line: [],
    got: GOALS.map(() => null),
    board: [],
    serial: 0,
    handed: 0,
    swapAt: 0,
    depot: counts(),
    sold: 0,
    paid: 0,
    open: openOf(done),
    news: [],
    history: [],
    rev: 0,
  };
  const [cx, cy] = land.depot;
  place(y, cy * land.w + cx, DEPOT, 0);
  hold(y, nextHand(y.open));
  return y;
}

/**
 * Works out again what is open, from the goals done. The depot's power, how far power reaches, how
 * much a crate holds and what a machine may make may have changed with it, so power and the plumbing
 * are worked out again when next read (`changed`).
 */
export function reopen(y: Yard): void {
  y.open = openOf(y.done);
  y.powered = false;
  changed(y);
  y.rev++;
}

/** Takes a node into hand, or with -1 none, with somewhere to count what it is given. */
export function hold(y: Yard, g: Goal | -1): void {
  y.hand = g;
  if (g >= 0) y.got[g] ??= counts();
}

/**
 * Marks the yard as changed: its plumbing is worked out afresh when next read. Every tile waiting in
 * the plumbing let go stops waiting at once: a tick under way, when a goal finished in it reopens
 * what is open (a crate may hold more), goes on with the plumbing it read, and passes no later tile
 * over that may now have room (`tick.ts`).
 */
export function changed(y: Yard): void {
  y.wire?.waiting.fill(0);
  y.wire = null;
}

/** Takes the whole Coins out of the till, and says how many. */
export function collect(y: Yard): number {
  const coins = Math.floor(y.till / MILLI);
  y.till -= coins * MILLI;
  return coins;
}

/** Takes the news a screen has not yet shown. */
export function drain(y: Yard): News[] {
  const news = y.news;
  y.news = [];
  return news;
}

// ---------- redwoods ----------

/** The redwood standing on a tile, as its place in the land's `trees`; -1 where none grows, or the yard felled it. */
export function standingTree(y: Yard, i: number): number {
  const t = y.land.tree[i] ?? -1;
  return t >= 0 && y.felled[t] !== 1 ? t : -1;
}

/** Whether a redwood stands on a tile, as the yard has it: the one way anything asks. */
export const redwoodAt = (y: Yard, i: number): boolean => standingTree(y, i) >= 0;

// ---------- rows ----------

/** Whether a kind of piece holds things, and so has a row in `holders`. */
export const holds = (k: number): boolean => HOLDS[k] === 1;

/** How much a full side table grows by: a half, so a yard of nothing but crates stays under a megabyte. */
const grown = (size: number): number => Math.ceil(size * 1.5);

/**
 * The row in `holders` of the piece on a tile, or -1 for a kind that holds nothing. `row` holds a
 * holder's row for some kinds and a tunnel's for another: it is read only through this and `tunnelOf`.
 */
export const holderOf = (y: Yard, i: number): number => (holds(y.kind[i] ?? NONE) ? (y.row[i] ?? -1) : -1);
/** The row in `tunnels` of the tunnel going in on a tile (its way-in mouth), or -1 for anything else. */
export const tunnelOf = (y: Yard, i: number): number =>
  SPANS[y.kind[i] ?? NONE] === 1 && (y.span[i] ?? 0) > 0 ? (y.row[i] ?? -1) : -1;

/** A new row in a side table for the piece on a tile, the table grown if it is full. */
export function holderRow(y: Yard, tile: number): number {
  let h = y.holders;
  if (h.size === h.tile.length) {
    const bigger = holders(grown(h.size));
    for (const key of [
      "tile",
      "out",
      "also",
      "more",
      "making",
      "last",
      "work",
      "mix",
      "quarter",
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
  h.also[r] = NONE;
  h.more[r] = 0;
  h.making[r] = NONE;
  h.last[r] = NONE;
  h.work[r] = 0;
  h.mix[r] = 0;
  h.quarter[r] = 0;
  h.idle[r] = 0;
  h.open[r] = 1;
  h.fuel[r] = 0;
  h.kinds[r] = 0;
  h.count[r] = 0;
  h.stock.fill(0, r * ITEM_COUNT, (r + 1) * ITEM_COUNT);
  return r;
}

/** A new row in `tunnels` for the tunnel going in on a tile, the table grown if it is full. */
export function tunnelRow(y: Yard, tile: number): number {
  let t = y.tunnels;
  if (t.size === t.tile.length) {
    const bigger = tunnels(grown(t.size));
    for (const key of ["tile", "under", "along"] as const) bigger[key].set(t[key]);
    bigger.size = t.size;
    y.tunnels = t = bigger;
  }
  const r = t.size++;
  t.tile[r] = tile;
  t.under.fill(NONE, r * SPAN_MOST, (r + 1) * SPAN_MOST);
  t.along.fill(0, r * SPAN_MOST, (r + 1) * SPAN_MOST);
  y.row[tile] = r;
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
      for (const key of [
        "tile",
        "out",
        "also",
        "more",
        "making",
        "last",
        "work",
        "mix",
        "quarter",
        "idle",
        "open",
        "fuel",
        "kinds",
        "count",
      ] as const)
        h[key][r] = h[key][last] ?? 0;
      h.stock.copyWithin(r * ITEM_COUNT, last * ITEM_COUNT, (last + 1) * ITEM_COUNT);
      y.row[h.tile[r] ?? 0] = r;
    }
  } else {
    const t = y.tunnels;
    const last = --t.size;
    if (r !== last) {
      t.tile[r] = t.tile[last] ?? 0;
      t.under.copyWithin(r * SPAN_MOST, last * SPAN_MOST, (last + 1) * SPAN_MOST);
      t.along.copyWithin(r * SPAN_MOST, last * SPAN_MOST, (last + 1) * SPAN_MOST);
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
/** Takes `c` of a thing from a holder's row, or as many as it holds. */
export function take(h: Holders, r: number, n: number, c = 1): void {
  const at = r * ITEM_COUNT + n;
  const had = h.stock[at] ?? 0;
  const gone = Math.min(had, c);
  if (gone <= 0) return;
  if (had === gone) h.kinds[r] = (h.kinds[r] ?? 0) - 1;
  h.stock[at] = had - gone;
  h.count[r] = (h.count[r] ?? gone) - gone;
}
/** How many of a thing a holder's row holds. */
export const held = (h: Holders, r: number, n: Item | number): number => h.stock[r * ITEM_COUNT + n] ?? 0;
/** Whether a holder's row holds all a recipe takes. */
export function enough(h: Holders, r: number, recipe: Recipe): boolean {
  for (let p = 0; p < recipe.from.length; p++)
    if ((h.stock[r * ITEM_COUNT + (recipe.from[p] ?? 0)] ?? 0) < (recipe.need[p] ?? 1)) return false;
  return true;
}

// ---------- pieces on tiles ----------

/**
 * Sets a new piece of a kind down on a tile, facing a way, at a grade if its kind has one, with a row
 * if it needs one; one of more than one tile over every tile it covers (`cover`), which are on the map.
 */
export function place(y: Yard, i: number, k: Kind, d: number, g = 1): void {
  vacate(y, i);
  y.kind[i] = k;
  y.dir[i] = d;
  y.grade[i] = gradeOf(k, g);
  if (holds(k)) y.row[i] = holderRow(y, i);
  if ((FACING[k]?.[d & 3]?.dx.length ?? 1) > 1) cover(y, i, k, d & 3);
}

/** Lays the piece of more than one tile standing on its own tile `i` over the rest of its tiles, each cleared first: each takes its kind and where its own tile is, and nothing else (`layOver`). */
export function cover(y: Yard, i: number, k: number, d: number): void {
  const f = FACING[k]?.[d & 3];
  if (!f) return;
  const w = y.land.w;
  for (let t = 1; t < f.dx.length; t++) vacate(y, i + (f.dx[t] ?? 0) + (f.dy[t] ?? 0) * w);
  layOver(y.kind, y.part, w, i, k, d);
}

/**
 * Lets go of the tiles the piece of more than one tile on its own tile `i` covers, but its own, which
 * keeps all of it, what it holds and its row: to be laid over its tiles again (`cover`) as it then faces.
 */
export function uncover(y: Yard, i: number): void {
  const f = FACING[y.kind[i] ?? NONE]?.[(y.dir[i] ?? 0) & 3];
  for (let t = 1; t < (f?.dx.length ?? 0); t++) clearTile(y, i + (f?.dx[t] ?? 0) + (f?.dy[t] ?? 0) * y.land.w);
}

/**
 * Turns the piece on its own tile `i` to face `d`, what it holds and its row kept: the one way a
 * standing piece is turned, by a turn and by one of its kind laid over it. One of more than one tile
 * comes off the tiles it covered and over those it covers turned, which are clear.
 */
export function face(y: Yard, i: number, d: number): void {
  uncover(y, i);
  cover(y, i, y.kind[i] ?? NONE, d & 3);
  y.dir[i] = d;
}

/** Takes whatever stands on a tile away, row and all, leaving it as new ground: every tile of a piece of more than one. */
export function vacate(y: Yard, i: number): void {
  if ((y.part[i] ?? 0) === 0) {
    clearTile(y, i);
    return;
  }
  const own = pieceOf(y, i);
  const f = FACING[y.kind[own] ?? NONE]?.[(y.dir[own] ?? 0) & 3];
  for (let t = 1; t < (f?.dx.length ?? 0); t++) clearTile(y, own + (f?.dx[t] ?? 0) + (f?.dy[t] ?? 0) * y.land.w);
  clearTile(y, own);
}

/** Clears one tile, its row given back. */
function clearTile(y: Yard, i: number): void {
  dropRow(y, i);
  y.part[i] = 0;
  y.made[i] = ((y.made[i] ?? 0) + 1) & 255;
  y.kind[i] = NONE;
  y.dir[i] = 0;
  y.item[i] = NONE;
  y.prog[i] = 0;
  y.via[i] = 0;
  y.tint[i] = 0;
  y.turn[i] = 0;
  y.shut[i] = 0;
  y.first[i] = 0;
  y.ins[i] = 0;
  y.set[i] = NONE;
  y.grade[i] = 0;
  y.free[i] = 0;
  y.span[i] = 0;
}

/** Sets a splitter's ways in; with none left, its next way in goes from `turn` too (`kinds/splitter.ts`). Who takes from whom changes, so the plumbing is worked out again. */
export function insTo(y: Yard, i: number, ins: number): void {
  if (y.ins[i] === ins) return;
  y.ins[i] = ins;
  if (ins === 0) y.turn[i] = (y.turn[i] ?? 0) & 3;
  changed(y);
}

/**
 * The bytes a yard holds in memory: every typed array it reaches, through its side tables, its
 * plumbing, its orders and its records, each once; not its land, which yards share.
 */
export function bytesHeld(y: Yard): number {
  const seen = new Set<ArrayBufferView>();
  const walk = (v: unknown): void => {
    if (ArrayBuffer.isView(v)) seen.add(v);
    else if (Array.isArray(v)) for (const part of v) walk(part);
    else if (typeof v === "object" && v !== null) for (const part of Object.values(v)) walk(part);
  };
  for (const [key, part] of Object.entries(y)) if (key !== "land") walk(part);
  let n = 0;
  for (const a of seen) n += a.byteLength;
  return n;
}
