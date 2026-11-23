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
  DEPOT,
  DRAW,
  DRAWN,
  GATHERER,
  GIVES,
  HALF,
  JOINER,
  type Kind,
  MILL,
  NONE,
  recipesFor,
  SORTER,
  SPLITTER,
  STOP,
  STUDY,
  TUNNEL,
  WHEEL,
  WORKSHOP,
} from "./tables.ts";
import { holderOf, type Wire, type Yard } from "./yard.ts";

/** The tile ahead of a piece, behind it, and to its left and right; -1 off the map. */
export const ahead = (y: Yard, i: number): number => toward(y.land, i, y.dir[i] ?? 0);
export const behind = (y: Yard, i: number): number => toward(y.land, i, (y.dir[i] ?? 0) + 2);
const left = (y: Yard, i: number): number => toward(y.land, i, (y.dir[i] ?? 0) + 3);
const right = (y: Yard, i: number): number => toward(y.land, i, (y.dir[i] ?? 0) + 1);

/** A splitter's or a sorter's way out (0 ahead, 1 left, 2 right), or -1 where it is shut or off the map. */
export const wayOut = (y: Yard, i: number, way: number): number =>
  ((y.shut[i] ?? 0) >> way) & 1 ? -1 : way === 0 ? ahead(y, i) : way === 1 ? left(y, i) : right(y, i);
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
/** How many ways out a piece with ways has: a splitter 3, a sorter 2 (ahead and left). */
export const waysOf = (k: number): number => (k === SPLITTER ? 3 : k === SORTER ? 2 : 0);
const isWorker = (k: number): boolean => k === MILL || k === BENCH || k === WORKSHOP;

/**
 * The sides a piece takes things in from, a bit for each way (east 1, south 2, west 4, north 8),
 * whatever it holds just now: a belt, crate or joiner from all but the side it faces (two belts
 * facing each other pass nothing), a splitter, a sorter and a tunnel's way-in mouth only from behind,
 * the depot, a stop, mills, benches, workshops, boilers and Studies from every side, the rest from none.
 */
export function sidesTaken(y: Yard, i: number): number {
  const k = y.kind[i] ?? NONE;
  const d = y.dir[i] ?? 0;
  if (k === BELT || k === CRATE || k === JOINER) return 15 & ~(1 << d);
  if (k === SPLITTER || k === SORTER || (k === TUNNEL && (y.span[i] ?? 0) > 0)) return 1 << ((d + 2) & 3);
  return k === DEPOT || k === STOP || k === BOILER || k === STUDY || isWorker(k) ? 15 : 0;
}

/** Whether the tile at `to` takes things from the tile beside it at `from`. A splitter passes a way by when this says no. */
export function takes(y: Yard, to: number, from: number): boolean {
  if (to < 0) return false;
  for (let way = 0; way < 4; way++) if (toward(y.land, to, way) === from) return ((sidesTaken(y, to) >> way) & 1) === 1;
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
  // Power in halves: a piece draws its kind's power once for each half its grade draws (`DRAWN`).
  let steady = y.open.depot * HALF;
  let demand = 0;
  for (let i = 0; i < n; i++) {
    const k = kind[i] ?? NONE;
    if (carries(k)) carry.push(i);
    else if (k === GATHERER || k === STUDY || isWorker(k)) {
      if (lit[i] === 1) {
        work.push(i);
        demand += (DRAW[k] ?? 0) * (DRAWN[y.grade[i] ?? 0] ?? HALF);
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
    work: Int32Array.from(work),
    boilers: Int32Array.from(boilers),
    recipes: ALL_KINDS.map((k) => recipesFor(y.open, k)),
    steady,
    demand,
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

/** The power there is, the power drawn, and the share of ticks the machines work on. */
export function power(y: Yard): { supply: number; demand: number; pace: number } {
  if (!y.wire) rewire(y);
  return { supply: y.supply / HALF, demand: y.demand / HALF, pace: y.demand > y.supply ? y.supply / y.demand : 1 };
}
