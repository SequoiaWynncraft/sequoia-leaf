/**
 * The yard's plumbing: who hands to whom, and in what order. It depends only on what stands where,
 * so it is worked out once after a change (`rewire`) and kept until the next. A piece hands to the
 * tile ahead of it; a tunnel's way-in mouth to its other mouth; a splitter to the tiles ahead, to
 * its left and to its right, but for a way that is shut; a sorter ahead, or for the thing it is set
 * to, to its left. Ways are numbered east, south, west, north; a quarter turn right is one more.
 */
import { besideWater, toward } from "./land.ts";
import { litOf } from "./power.ts";
import {
  ALL_KINDS,
  BELT,
  BENCH,
  BOILER,
  CRATE,
  DEADFALL,
  DEPOT,
  DRAW,
  drawnAt,
  GATHERER,
  GIVES,
  HALF,
  isFolio,
  JOINER,
  type Kind,
  MILL,
  NONE,
  type Recipe,
  recipesFor,
  SORTER,
  SPLITTER,
  STOP,
  STUDY,
  TUNNEL,
  WHEEL,
  WORKSHOP,
} from "./tables.ts";
import { holderOf, tunnelOf, type Wire, type Yard } from "./yard.ts";

/** The tile ahead of a piece, behind it, and to its left and right; -1 off the map. */
export const ahead = (y: Yard, i: number): number => toward(y.land, i, y.dir[i] ?? 0);
export const behind = (y: Yard, i: number): number => toward(y.land, i, (y.dir[i] ?? 0) + 2);
const left = (y: Yard, i: number): number => toward(y.land, i, (y.dir[i] ?? 0) + 3);
const right = (y: Yard, i: number): number => toward(y.land, i, (y.dir[i] ?? 0) + 1);

/**
 * The way a sorter sends the thing it is set to: 1, to its left, or 2, to its right. It is kept as
 * a splitter keeps the way it puts first, 1 + the way, but only 3 is kept: 0 is the left, the way
 * every sorter sent before one could be set to the right.
 */
export const sortWay = (y: Yard, i: number): 1 | 2 => (y.first[i] === 3 ? 2 : 1);
/**
 * The ways out a piece sends nothing by, a bit each (1 ahead, 2 left, 4 right): a splitter's shut
 * ways and its ways turned to take things in, and a sorter's the side it does not send to.
 */
export const closedWays = (y: Yard, i: number): number =>
  y.kind[i] === SORTER ? (sortWay(y, i) === 1 ? 4 : 2) : (y.shut[i] ?? 0) | (y.ins[i] ?? 0);
/** A splitter's or a sorter's way out (0 ahead, 1 left, 2 right), or -1 where it is closed or off the map. */
export const wayOut = (y: Yard, i: number, way: number): number =>
  (closedWays(y, i) >> way) & 1 ? -1 : way === 0 ? ahead(y, i) : way === 1 ? left(y, i) : right(y, i);
/** How far round from the way a piece faces each of its ways out is, in quarter turns right: ahead, left, right. */
export const WAY_TURN = [0, 3, 1] as const;
/** The sides a splitter takes things in by besides behind, a bit each as `sidesTaken` has them: its ways in. */
function sidesIn(y: Yard, i: number): number {
  const ins = y.ins[i] ?? 0;
  const d = y.dir[i] ?? 0;
  let sides = 0;
  WAY_TURN.forEach((t, way) => {
    if ((ins >> way) & 1) sides |= 1 << ((d + t) & 3);
  });
  return sides;
}
/** A joiner's way in (0 behind, 1 left, 2 right), or -1 off the map. */
export const wayIn = (y: Yard, i: number, way: number): number =>
  way === 0 ? behind(y, i) : way === 1 ? left(y, i) : right(y, i);

/** The far mouth of a tunnel's way-in mouth, `span + 1` tiles ahead; -1 off the map. */
export function farMouth(y: Yard, i: number): number {
  const { w, h } = y.land;
  const d = y.dir[i] ?? 0;
  const s = (y.span[i] ?? 0) + 1;
  const x = (i % w) + (d === 0 ? s : d === 2 ? -s : 0);
  const z = Math.floor(i / w) + (d === 1 ? s : d === 3 ? -s : 0);
  return x < 0 || z < 0 || x >= w || z >= h ? -1 : z * w + x;
}

/** The one tile a piece hands to, or -1: none for a splitter or sorter (they have ways), a pylon, wheel, boiler, Study, stop or the depot. */
export function nextOf(y: Yard, i: number): number {
  const k = y.kind[i] ?? NONE;
  if (k === TUNNEL && (y.span[i] ?? 0) > 0) return farMouth(y, i);
  return k === BELT || k === JOINER || k === TUNNEL || k === CRATE || k === GATHERER || isWorker(k) ? ahead(y, i) : -1;
}

/** Whether a kind carries things across its tile, and whether it is a machine that makes things. */
export const carries = (k: number): k is Kind =>
  k === BELT || k === SPLITTER || k === JOINER || k === TUNNEL || k === SORTER;
/** How many ways out a piece with ways has: a splitter's and a sorter's are ahead, left and right (a sorter's other side shut). */
export const waysOf = (k: number): number => (k === SPLITTER || k === SORTER ? 3 : 0);
const isWorker = (k: number): boolean => k === MILL || k === BENCH || k === WORKSHOP;

/**
 * The sides a piece takes things in from, a bit for each way (east 1, south 2, west 4, north 8),
 * whatever it holds just now: a belt, crate or joiner from all but the side it faces (two belts
 * facing each other pass nothing), a splitter, a sorter and a tunnel's way-in mouth only from behind
 * (a splitter by its ways in too), the depot, a stop, mills, benches, workshops, boilers and Studies from every side, the rest from none.
 */
export function sidesTaken(y: Yard, i: number): number {
  const k = y.kind[i] ?? NONE;
  const d = y.dir[i] ?? 0;
  if (k === BELT || k === CRATE || k === JOINER) return 15 & ~(1 << d);
  if (k === SPLITTER || k === SORTER || (k === TUNNEL && (y.span[i] ?? 0) > 0))
    return (1 << ((d + 2) & 3)) | sidesIn(y, i);
  return k === DEPOT || k === STOP || k === BOILER || k === STUDY || isWorker(k) ? 15 : 0;
}

/**
 * Whether the tile at `to` takes things from the tile beside it at `from`: the one answer to which
 * sides connect, read by the plumbing (`Wire.taken`), the tick, a piece's status and the router. A
 * full piece still takes from that side. A splitter passes a way by when this says no.
 */
export function takes(y: Yard, to: number, from: number): boolean {
  if (to < 0) return false;
  for (let way = 0; way < 4; way++) if (toward(y.land, to, way) === from) return ((sidesTaken(y, to) >> way) & 1) === 1;
  return false;
}

const NO_RECIPES: readonly Recipe[] = [];

/**
 * Whether the piece on a tile takes the thing `n` at all, from whichever side it takes things by,
 * full or not: anything that carries, a crate, the depot and a stop take anything; a machine a part
 * of a recipe it may make, the one it is told to if it is told one; a boiler deadfall; a Study folios.
 * Whether it has room for it this tick is the tick's to ask, after this.
 */
export function wants(y: Yard, to: number, n: number): boolean {
  const k = y.kind[to] ?? NONE;
  if (carries(k) || k === CRATE || k === DEPOT || k === STOP) return true;
  if (k === BOILER) return n === DEADFALL;
  if (k === STUDY) return isFolio(n);
  return isWorker(k) && partOf(y, k, y.set[to] ?? NONE, n);
}

/** Whether the thing `n` goes into a recipe a kind of machine may make: the one it is told to (`only`), or any. */
function partOf(y: Yard, k: number, only: number, n: number): boolean {
  const recipes = (y.wire ?? rewire(y)).recipes[k] ?? NO_RECIPES;
  for (let c = 0; c < recipes.length; c++) {
    const recipe = recipes[c];
    if (!recipe || (only !== NONE && recipe.out !== only)) continue;
    for (let p = 0; p < recipe.from.length; p++) if (recipe.from[p] === n) return true;
  }
  return false;
}

/** Works out the yard's plumbing from what stands where. */
export function rewire(y: Yard): Wire {
  const lit = litOf(y);
  const { kind, land } = y;
  const n = kind.length;
  const carry: number[] = [];
  const work: number[] = [];
  const boilers: number[] = [];
  // Power in halves: a piece draws its kind's power once for each half its grade draws (`drawnAt`).
  let steady = y.open.depot * HALF;
  let demand = 0;
  for (let i = 0; i < n; i++) {
    const k = kind[i] ?? NONE;
    if (carries(k)) carry.push(i);
    else if (k === GATHERER || k === STUDY || isWorker(k)) {
      if (lit[i] === 1) {
        work.push(i);
        demand += drawnAt(k, y.grade[i] ?? 0);
      }
    } else if (k === WHEEL) {
      if (lit[i] === 1 && besideWater(land, i)) steady += (GIVES[WHEEL] ?? 0) * HALF;
    } else if (k === BOILER && lit[i] === 1) boilers.push(i);
  }
  const taken = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (kind[i] !== NONE) taken[i] = sidesTaken(y, i);
  const wire: Wire = {
    order: handingOrder(y),
    taken,
    carry: Int32Array.from(carry),
    mouths: Int32Array.from(carry.filter((i) => tunnelOf(y, i) >= 0)),
    work: Int32Array.from(work),
    boilers: Int32Array.from(boilers),
    recipes: ALL_KINDS.map((k) => recipesFor(y.open, k)),
    steady,
    demand,
    waiting: new Uint8Array(n),
    waitingFrom: y.rev,
  };
  y.wire = wire;
  y.demand = demand;
  let burning = 0;
  for (const i of boilers) if ((y.holders.fuel[holderOf(y, i)] ?? 0) > 0) burning++;
  y.supply = steady + burning * (GIVES[BOILER] ?? 0) * HALF;
  return wire;
}

/**
 * The tiles that hand things on, each after the tiles it hands to, so that a full belt moves as
 * one: a walk from each tile in turn, a splitter's ways in order, each tile once.
 */
function handingOrder(y: Yard): Int32Array {
  const n = y.kind.length;
  const seen = new Uint8Array(n);
  const child = new Uint8Array(n);
  const stack = new Int32Array(n);
  const order: number[] = [];
  let top = 0;
  const enter = (i: number): void => {
    if (i < 0 || seen[i] === 1) return;
    seen[i] = 1;
    const k = y.kind[i] ?? NONE;
    if (hands(k)) stack[top++] = i;
  };
  for (let s = 0; s < n; s++) {
    enter(s);
    while (top > 0) {
      const i = stack[top - 1] ?? 0;
      const c = child[i] ?? 0;
      const ways = waysOf(y.kind[i] ?? NONE);
      if (c >= Math.max(1, ways)) {
        top--;
        order.push(i);
        continue;
      }
      child[i] = c + 1;
      enter(ways > 0 ? wayOut(y, i, c) : nextOf(y, i));
    }
  }
  return Int32Array.from(order);
}
/** Whether a kind hands things on at all: everything but pylons, wheels, boilers and the depot. */
const hands = (k: number): boolean => carries(k) || k === CRATE || k === GATHERER || isWorker(k);

/** The power there is and the power drawn; the share of ticks the machines work on (`pace`), and as every screen says it (`speed`). */
export interface Power {
  readonly supply: number;
  readonly demand: number;
  readonly pace: number;
  /**
   * The whole per cent of ticks they work, rounded down, so a yard a little short is at 99%, never
   * at 100%: worked out in whole halves of power, which no rounding of a fraction moves.
   */
  readonly speed: number;
}

export function power(y: Yard): Power {
  if (!y.wire) rewire(y);
  const short = y.demand > y.supply;
  return {
    supply: y.supply / HALF,
    demand: y.demand / HALF,
    pace: short ? y.supply / y.demand : 1,
    speed: short ? Math.floor((y.supply * 100) / y.demand) : 100,
  };
}

/** What stands of a kind that draws power: how many where power reaches and where it does not, the power those in reach draw, and the least and most one of them draws at its grade where power reaches it. */
export interface KindPower {
  readonly kind: Kind;
  readonly lit: number;
  readonly dark: number;
  readonly drawn: number;
  readonly each: readonly [number, number];
}

/**
 * Where a yard's power comes from and goes, counted once from what stands, as every screen says it:
 * what the depot gives; the waterwheels turning and those out of reach; the boilers in reach
 * burning and cold, and those out of reach; and each kind that draws, as `KindPower`
 * says, for each kind of which something stands. The kinds' power drawn adds up to `demand`, and
 * what the depot, the wheels and the boilers burning give to `supply`.
 */
export interface PowerSummary extends Power {
  readonly depot: number;
  readonly wheels: { readonly turning: number; readonly away: number };
  readonly boilers: { readonly burning: number; readonly cold: number; readonly dark: number };
  readonly draws: readonly KindPower[];
}

/** The kinds that draw power, in the tables' order. */
const DRAWS: readonly Kind[] = ALL_KINDS.filter((k) => (DRAW[k] ?? 0) > 0);

export function powerSummary(y: Yard): PowerSummary {
  const p = power(y);
  const t = tally(y);
  const boilers = of(t.lit, BOILER);
  const burns = (GIVES[BOILER] ?? 0) * HALF;
  // The boilers that burned at the last tick are what the supply has beyond what is always there.
  const beyond = y.supply - (y.wire ?? rewire(y)).steady;
  const burning = burns > 0 ? Math.min(boilers, Math.max(0, Math.round(beyond / burns))) : 0;
  return {
    ...p,
    depot: y.open.depot,
    wheels: { turning: t.turning, away: of(t.lit, WHEEL) + of(t.dark, WHEEL) - t.turning },
    boilers: { burning, cold: boilers - burning, dark: of(t.dark, BOILER) },
    draws: DRAWS.filter((k) => of(t.lit, k) + of(t.dark, k) > 0).map((k) => ({
      kind: k,
      lit: of(t.lit, k),
      dark: of(t.dark, k),
      drawn: of(t.drawn, k) / HALF,
      each: [of(t.least, k) / HALF, of(t.most, k) / HALF],
    })),
  };
}

/** A kind's count in a tally. */
const of = (a: Int32Array, k: number): number => a[k] ?? 0;

/** One walk over what stands: of each kind (by its number), how many in reach of power and not, what those in reach draw and the least and most one draws, in halves; and the wheels that turn. */
interface Tally {
  readonly lit: Int32Array;
  readonly dark: Int32Array;
  readonly drawn: Int32Array;
  readonly least: Int32Array;
  readonly most: Int32Array;
  turning: number;
}

function tally(y: Yard): Tally {
  const lit = litOf(y);
  const n = ALL_KINDS.length;
  const t: Tally = {
    lit: new Int32Array(n),
    dark: new Int32Array(n),
    drawn: new Int32Array(n),
    least: new Int32Array(n),
    most: new Int32Array(n),
    turning: 0,
  };
  for (let i = 0; i < y.kind.length; i++) {
    const k = y.kind[i] ?? NONE;
    if (k === NONE) continue;
    const reached = lit[i] === 1;
    const counts = reached ? t.lit : t.dark;
    counts[k] = of(counts, k) + 1;
    if (k === WHEEL && reached && besideWater(y.land, i)) t.turning++;
    const d = drawnAt(k, y.grade[i] ?? 0);
    if (!reached) continue;
    t.drawn[k] = of(t.drawn, k) + d;
    if (d > 0) widen(t, k, d);
  }
  return t;
}

/** Takes in what one piece of a kind draws: the least and the most one of the kind draws. */
function widen(t: Tally, k: number, d: number): void {
  if (of(t.least, k) === 0 || d < of(t.least, k)) t.least[k] = d;
  if (d > of(t.most, k)) t.most[k] = d;
}
