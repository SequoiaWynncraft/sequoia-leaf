/**
 * Building in the yard, taking things away, turning and setting pieces, and buying plots.
 * Everything that costs Coins is told the balance and says what it took.
 */
import { besideWater, type Plotted, tileAt, touching } from "./land.ts";
import { join } from "./lines.ts";
import {
  ALL_ITEMS,
  BELT,
  CRATE,
  DEPOT,
  GATHERER,
  gradeOf,
  holdsMost,
  isMaker,
  type Item,
  JOINER,
  type Kind,
  locked,
  NONE,
  type Plot,
  price,
  PYLON,
  RECIPE,
  type Recipe,
  recipesFor,
  SORTER,
  SPLITTER,
  STOP,
  STUDY,
  TUNNEL,
  WHEEL,
} from "./tables.ts";
import { changed, enough, held, holds, place, take, tunnelRow, vacate, type Yard } from "./yard.ts";

/** What came of trying to spend Coins: what it cost, or why not, in plain words. */
export type Spent = { readonly ok: true; readonly cost: number } | { readonly ok: false; readonly why: string };
/** What came of taking something away: the Coins that come back, or why not. */
export type Refund = { readonly ok: true; readonly refund: number } | { readonly ok: false; readonly why: string };
/** What came of setting a piece down: what it cost and the tiles it was laid on, or why not. */
export type Laid =
  | { readonly ok: true; readonly cost: number; readonly laid: readonly number[] }
  | { readonly ok: false; readonly why: string };

/** The four ways, east, south, west, north, as steps across and down. */
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;
export type Dir = 0 | 1 | 2 | 3;
export const isDir = (v: unknown): v is Dir => v === 0 || v === 1 || v === 2 || v === 3;
/** A quarter turn to the right of a way. */
export const right = (d: Dir): Dir => (d === 0 ? 1 : d === 1 ? 2 : d === 2 ? 3 : 0);
/** For each way, the way behind it and a quarter turn to its left and to its right. */
export const BACK = [2, 3, 0, 1] as const;
export const LEFT = [3, 0, 1, 2] as const;
export const RIGHT = [1, 2, 3, 0] as const;
const dx = (d: number): number => DX[d & 3] ?? 0;
const dy = (d: number): number => DY[d & 3] ?? 0;

/** The tile at (x, y) of a yard's land, or -1. */
export const at = (y: Yard, x: number, z: number): number => tileAt(y.land, x, z);
/** What stands at (x, y), or `NONE`. */
export const kindAt = (y: Yard, x: number, z: number): number => {
  const i = at(y, x, z);
  return i < 0 ? NONE : (y.kind[i] ?? NONE);
};

/** Why nothing can stand on a tile, whatever it is: off the map, not the yard's land, water, or a redwood. */
function ground(y: Yard, x: number, z: number): string | null {
  const i = at(y, x, z);
  if (i < 0) return "That is off the map";
  const plot = y.land.plots[y.land.plot[i] ?? NONE];
  if (!plot || !y.plots.includes(plot.plot)) return plot ? `${plot.name} is not the yard's yet` : "That is off the map";
  if (y.land.water[i] === 1) return "Nothing can be built on the stream";
  if (y.land.trunk[i] === 1) return "Nothing can be built on a tree";
  return null;
}

/**
 * How a piece is to be set down beyond its kind, tile and way: its grade (1 if not said), and a
 * tunnel's span (if not said, the nearest it can come up at; over a tunnel, if said, that tunnel's).
 */
export interface Lay {
  readonly grade?: number;
  readonly span?: number;
}

/** What it costs to stand one more of a kind at a grade: its price, less grade 1's while the yard has one to hand (`spare`). */
export const costOf = (y: Yard, k: Kind, g = 1, spare: Uint8Array = y.spare): number =>
  price(k, gradeOf(k, g)) - ((spare[k] ?? 0) > 0 ? price(k, gradeOf(k)) : 0);

/** What comes back for the piece on a tile taken away: what it cost at its grade, less grade 1's for one the yard had to hand. */
export function worthAt(y: Yard, i: number): number {
  const k = y.kind[i] ?? NONE;
  return price(k, y.grade[i] ?? 0) - (y.free[i] === 1 ? price(k, gradeOf(k)) : 0);
}

/** Whether a kind may be set down in the place of what stands: a splitter or a joiner on a belt, or on one another. */
export const replaces = (k: number, there: number): boolean =>
  (k === SPLITTER || k === JOINER) && there !== k && (there === BELT || there === SPLITTER || there === JOINER);

/**
 * What building a kind at a grade on a tile takes from the purse: over one of its kind, what its
 * grade costs more (or, lower, gives back); else its cost, less what a replaced piece gives back.
 */
export function priceAt(y: Yard, k: Kind, x: number, z: number, g = 1, spare: Uint8Array = y.spare): number {
  const i = at(y, x, z);
  const there = i < 0 ? NONE : (y.kind[i] ?? NONE);
  if (there === NONE) return costOf(y, k, g, spare);
  if (there === k) return price(k, gradeOf(k, g)) - price(k, y.grade[i] ?? 0);
  return costOf(y, k, g, spare) - worthAt(y, i);
}

/** The other mouth of the tunnel on a tile, or -1. */
export function otherMouth(y: Yard, i: number): number {
  const span = y.span[i] ?? 0;
  const d = y.dir[i] ?? 0;
  const far = (Math.abs(span) + 1) * Math.sign(span);
  const { w } = y.land;
  return span === 0 ? -1 : at(y, (i % w) + dx(d) * far, Math.floor(i / w) + dy(d) * far);
}

/** Whether a tunnel may pass under a tile: under anything but the depot. */
export const digsUnder = (y: Yard, x: number, z: number): boolean => kindAt(y, x, z) !== DEPOT;

/** Where a tunnel going in at a tile would come up: the nearest clear tile beyond one to three others, or the end of `span`. */
export function tunnelExit(
  y: Yard,
  x: number,
  z: number,
  d: number,
  span?: number,
): { x: number; y: number; span: number } | null {
  const most = span ?? y.open.span;
  if (most < 1 || most > y.open.span) return null;
  for (let s = 1; s <= most; s++) {
    if (!digsUnder(y, x + dx(d) * s, z + dy(d) * s)) return null;
    if (span !== undefined && s < span) continue;
    const ex = x + dx(d) * (s + 1);
    const ey = z + dy(d) * (s + 1);
    if (ground(y, ex, ey) === null && kindAt(y, ex, ey) === NONE) return { x: ex, y: ey, span: s };
  }
  return null;
}

function depotInTheWay(y: Yard, x: number, z: number, d: number, span?: number): boolean {
  for (let s = 1; s <= (span ?? y.open.span); s++) if (!digsUnder(y, x + dx(d) * s, z + dy(d) * s)) return true;
  return false;
}

/** Why a kind cannot be built here with `coins` in the purse, or nothing if it can. */
export function refusal(
  y: Yard,
  k: Kind,
  x: number,
  z: number,
  coins: number,
  d: number = 0,
  lay: Lay = {},
): string | null {
  const bad = ground(y, x, z);
  if (bad !== null) return bad;
  if (k === DEPOT) return "There is only one depot";
  const g = gradeOf(k, lay.grade);
  const lock = locked(y.open, { build: k, grade: g });
  if (lock !== null) return lock;
  const i = at(y, x, z);
  const there = y.kind[i] ?? NONE;
  if (there === DEPOT) return "The depot stands here";
  if (there === k) {
    // Laid over one of its kind, a piece turns it and raises or lowers it to its grade; a tunnel only
    // raises or lowers, and one asked for with its span (as a blueprint or a copy asks) only the
    // tunnel going in here, that way, that far.
    const other = (lay.span ?? 0) > 0 && (y.span[i] !== lay.span || y.dir[i] !== d);
    if (k === TUNNEL && (y.grade[i] === g || other)) return "Something is here already";
  } else {
    if (there !== NONE && !replaces(k, there)) return "Something is here already";
    if (k === GATHERER && y.land.deposit[i] === NONE) return "A gatherer must be placed on a deposit";
    if (k === WHEEL && !besideWater(y.land, i)) return "A waterwheel must be beside the stream";
    const most = k === STOP ? locked(y.open, { stops: stops(y) + 1 }) : null;
    if (most !== null) return most;
    if (k === TUNNEL && !tunnelExit(y, x, z, d, lay.span))
      return depotInTheWay(y, x, z, d, lay.span)
        ? "A tunnel cannot go under the depot"
        : `A tunnel needs a free tile to come up on, 1 to ${y.open.span} tiles ahead`;
  }
  if (coins < priceAt(y, k, x, z, g)) return "Not enough Coins";
  return null;
}

/**
 * Builds something and says what it cost: over one of its kind it turns it and raises or lowers it
 * to the grade asked for, keeping what it holds, its colour and its settings; a splitter or a joiner
 * set down on a belt takes its place, keeping what the belt carried and its colour; a tunnel is both
 * mouths at once. A new belt or tunnel takes the colour of the line it joins (`join`).
 */
export function build(y: Yard, k: Kind, x: number, z: number, d: Dir, coins: number, lay: Lay = {}): Spent {
  const did = setDown(y, k, x, z, d, coins, lay);
  if (!did.ok) return did;
  if (k === BELT || k === TUNNEL) join(y, did.laid);
  return { ok: true, cost: did.cost };
}

/** Sets a piece down as `build` does, leaving a new belt or tunnel uncoloured. Says what it cost and the tiles laid on. */
export function setDown(y: Yard, k: Kind, x: number, z: number, d: Dir, coins: number, lay: Lay = {}): Laid {
  const why = refusal(y, k, x, z, coins, d, lay);
  if (why !== null) return { ok: false, why };
  const i = at(y, x, z);
  const there = y.kind[i] ?? NONE;
  const g = gradeOf(k, lay.grade);
  const cost = priceAt(y, k, x, z, g);
  if (there === k) {
    const mouth = otherMouth(y, i);
    if (y.grade[i] !== g || (k !== TUNNEL && y.dir[i] !== d)) changed(y);
    if (k !== TUNNEL) y.dir[i] = d;
    y.grade[i] = g;
    if (mouth >= 0) y.grade[mouth] = g;
    return { ok: true, cost, laid: [] };
  }
  // A replaced belt goes back as if taken away; what it carried and its colour stay.
  const kept =
    there === NONE ? null : { item: y.item[i] ?? NONE, prog: y.prog[i] ?? 0, via: y.via[i] ?? 0, tint: y.tint[i] ?? 0 };
  if (there !== NONE && y.free[i] === 1) y.spare[there] = (y.spare[there] ?? 0) + 1;
  place(y, i, k, d, g);
  if ((y.spare[k] ?? 0) > 0) {
    // One of the pieces the yard has to hand.
    y.free[i] = 1;
    y.spare[k] = (y.spare[k] ?? 0) - 1;
  }
  if (kept) {
    y.item[i] = kept.item;
    y.prog[i] = kept.prog;
    y.via[i] = kept.via;
    y.tint[i] = kept.tint;
  }
  const laid = [i];
  if (k === TUNNEL) {
    const exit = tunnelExit(y, x, z, d, lay.span);
    if (exit) {
      y.span[i] = exit.span;
      y.row[i] = tunnelRow(y, i);
      const far = at(y, exit.x, exit.y);
      place(y, far, TUNNEL, d, g);
      y.span[far] = -exit.span;
      laid.push(far);
    }
  }
  changed(y);
  if (k === PYLON) y.powered = false;
  return { ok: true, cost, laid };
}

/** How many cart stops stand. */
export const stops = (y: Yard): number => y.kind.reduce((n, k) => (k === STOP ? n + 1 : n), 0);

/** Whether what stands on a tile can be turned: anything but the depot and a tunnel. */
export function turnable(y: Yard, x: number, z: number): boolean {
  const there = kindAt(y, x, z);
  return there !== NONE && there !== DEPOT && there !== TUNNEL;
}

/** Turns something to face another way. Costs nothing. */
export function turn(y: Yard, x: number, z: number, d: Dir): boolean {
  if (!turnable(y, x, z)) return false;
  const i = at(y, x, z);
  if (y.dir[i] !== d) {
    y.dir[i] = d;
    changed(y);
  }
  return true;
}

/** Takes something away and says what comes back. Whatever it was holding is lost. The depot stays. */
export function remove(y: Yard, x: number, z: number): Refund {
  const i = at(y, x, z);
  const there = i < 0 ? NONE : (y.kind[i] ?? NONE);
  if (there === NONE) return { ok: false, why: "There is nothing here" };
  if (there === DEPOT) return { ok: false, why: "The depot cannot be removed" };
  const refund = worthAt(y, i);
  const free = y.free[i] === 1;
  // Both mouths of a tunnel go together.
  const mouth = otherMouth(y, i);
  vacate(y, i);
  if (mouth >= 0) vacate(y, mouth);
  changed(y);
  if (there === PYLON) y.powered = false;
  if (free) y.spare[there] = (y.spare[there] ?? 0) + 1;
  return { ok: true, refund };
}

/** The recipes whose parts the machine on a tile keeps by it: the one it is told to make, or each it may make. */
export function keeps(y: Yard, i: number): readonly Recipe[] {
  const told = RECIPE[y.set[i] ?? NONE];
  return told ? [told] : recipesFor(y.open, y.kind[i] ?? NONE);
}

/**
 * Tells a machine to make one thing only, or with nothing to make whatever arrives. What it holds
 * beyond what it keeps for that (`keeps`, `holdsMost`) is tipped out. Says why it could not, or nothing.
 */
export function setRecipe(y: Yard, x: number, z: number, out: Item | null): string | null {
  const i = at(y, x, z);
  const there = i < 0 ? NONE : (y.kind[i] ?? NONE);
  if (!isMaker(there) || (out !== null && RECIPE[out]?.by !== there)) return "That cannot make it";
  const lock = out === null ? null : locked(y.open, { make: out });
  if (lock !== null) return lock;
  const h = y.holders;
  const r = y.row[i] ?? 0;
  y.set[i] = out ?? NONE;
  h.making[r] = NONE;
  h.work[r] = 0;
  h.idle[r] = 0;
  const kept = keeps(y, i);
  for (const n of ALL_ITEMS) take(h, r, n, held(h, r, n) - holdsMost(kept, n));
  changed(y);
  return null;
}

/** Sets the one thing a sorter sends to its left, or with nothing makes it a belt. Says whether there was a sorter. */
export function setSort(y: Yard, x: number, z: number, n: Item | null): boolean {
  const i = at(y, x, z);
  if (i < 0 || y.kind[i] !== SORTER) return false;
  y.set[i] = n ?? NONE;
  changed(y);
  return true;
}

/** Empties what a machine, crate or boiler holds, all of it or one kind of thing. Says how many went. */
export function tipOut(y: Yard, x: number, z: number, only: Item | null = null): number {
  const i = at(y, x, z);
  if (i < 0 || !holds(y.kind[i] ?? NONE)) return 0;
  const h = y.holders;
  const r = y.row[i] ?? 0;
  if (h.count[r] === 0) return 0;
  let gone = 0;
  for (const n of ALL_ITEMS) {
    if (only !== null && n !== only) continue;
    gone += held(h, r, n);
    take(h, r, n, held(h, r, n));
  }
  if (gone === 0) return 0;
  // Whatever it was part-way through may have lost a part: a recipe's, or the folio a Study works on.
  const making = h.making[r] ?? NONE;
  const recipe = RECIPE[making];
  const lost = y.kind[i] === STUDY ? making !== NONE && held(h, r, making) === 0 : !!recipe && !enough(h, r, recipe);
  if (lost) {
    h.making[r] = NONE;
    h.work[r] = 0;
  }
  h.idle[r] = 0;
  changed(y);
  return gone;
}

/** Opens or shuts a crate: shut, it takes things in and lets nothing out. Says whether there was a crate. */
export function setOpen(y: Yard, x: number, z: number, open: boolean): boolean {
  const i = at(y, x, z);
  if (i < 0 || y.kind[i] !== CRATE) return false;
  const r = y.row[i] ?? 0;
  if ((y.holders.open[r] === 1) !== open) {
    y.holders.open[r] = open ? 1 : 0;
    changed(y);
  }
  return true;
}

/** Shuts or opens one of a splitter's ways out: 0 for ahead, 1 for left, 2 for right. Says whether there was a splitter. */
export function setWay(y: Yard, x: number, z: number, way: number, open: boolean): boolean {
  const i = at(y, x, z);
  if (i < 0 || y.kind[i] !== SPLITTER || (way !== 0 && way !== 1 && way !== 2)) return false;
  const was = y.shut[i] ?? 0;
  const shut = open ? was & ~(1 << way) : was | (1 << way);
  if (was !== shut) {
    y.shut[i] = shut;
    changed(y);
  }
  return true;
}

// ---------- land ----------

const plotOf = (y: Yard, id: Plot): Plotted | null => y.land.plots.find((p) => p.plot === id) ?? null;

/** Where a plot stands: the yard's already, for sale now, or not yet (and why). */
export function plotState(y: Yard, id: Plot): { state: "owned" | "for sale" | "not yet"; why: string | null } {
  const plot = plotOf(y, id);
  if (!plot) return { state: "not yet", why: "There is no such plot" };
  if (y.plots.includes(id)) return { state: "owned", why: null };
  if (((y.open.plots >> id) & 1) === 0) return { state: "not yet", why: `${plot.name} is not for sale yet` };
  const reached = y.land.plots.some((p) => y.plots.includes(p.plot) && touching(p, plot));
  if (!reached) return { state: "not yet", why: `${plot.name} does not touch the yard's land yet` };
  return { state: "for sale", why: null };
}

/** Why a plot cannot be bought with `coins` in the purse, or nothing if it can. */
export function plotRefusal(y: Yard, id: Plot, coins: number): string | null {
  const { state, why } = plotState(y, id);
  if (state === "owned") return "You already own that plot";
  if (state === "not yet") return why;
  return coins < (plotOf(y, id)?.price ?? 0) ? "Not enough Coins" : null;
}

/** Buys a plot and says what it cost. */
export function buyPlot(y: Yard, id: Plot, coins: number): Spent {
  const why = plotRefusal(y, id, coins);
  if (why !== null) return { ok: false, why };
  y.plots.push(id);
  changed(y);
  return { ok: true, cost: plotOf(y, id)?.price ?? 0 };
}
