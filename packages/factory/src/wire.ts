import { keep } from "./kinds/holder.ts";
import type { Kit } from "./kinds/kit.ts";
import { anything, empty, lay } from "./kinds/line.ts";
import { RULES, TAKES_TURNS } from "./kinds/list.ts";
import { room as makerRoom, wants as makerWants } from "./kinds/maker.ts";
/**
 * The yard's plumbing: who hands to whom, and in what order, and the one rule by which a piece hands
 * a thing to another. Who hands to whom depends only on what stands where, so it is worked out once
 * after a change (`rewire`) and kept until the next. Each kind says for itself, in its module
 * (`kinds/`), which sides it takes things in from, the tile it hands to or its ways out, what it wants
 * and has room for, and its step in handing on; this asks each piece's kind, and so names none.
 * Ways are numbered east, south, west, north; a quarter turn right is one more.
 *
 * The kinds play with the kit made here (`KIT`): everything of the rules they may use, handed to
 * each of their hooks, since a kind's module imports nothing of the rules (`kinds/kind.ts`).
 */
import { besideWater, toward } from "./land.ts";
import { deliver, giveGoal } from "./orders.ts";
import { makes, MINUTE } from "./planner.ts";
import { litAt, litOf } from "./power.ts";
import { lit as litBig, outsOf, OWN, pieceOf, roomRound, takesAt } from "./sizes.ts";
import {
  ALL_ITEMS,
  ALL_KINDS,
  BURNS,
  CARRIES,
  DEADFALL,
  drawnAt,
  FIXED,
  FOLIOS,
  GOALS,
  GRADED,
  HALF,
  holdsMost,
  isFolio,
  isItem,
  isKind,
  isMaker,
  isRaw,
  ITEM_COUNT,
  ITEM_INFO,
  type Kind,
  locked,
  NONE,
  PACE,
  RECIPE,
  recipesFor,
  SPAN_MOST,
  SPANS,
  TINTED,
  TINTS,
  TOP,
  WAYS,
  WORK_OF,
} from "./tables.ts";
import {
  ahead,
  at,
  behind,
  DX,
  DY,
  farMouth,
  ground,
  kindAt,
  otherMouth,
  unpackWays,
  WAY_TURN,
  wayIn,
  wayTo,
} from "./tiles.ts";
import {
  changed,
  counts,
  enough,
  held,
  holderOf,
  insTo,
  place,
  put,
  take,
  tunnelOf,
  tunnelRow,
  type Wire,
  type Yard,
} from "./yard.ts";

export { sortWay } from "./kinds/sorter.ts";
export { ahead, behind, WAY_TURN, wayIn } from "./tiles.ts";
export { outsOf, pieceOf } from "./sizes.ts";

// ---------- who hands to whom ----------

/** The rules of the kind standing on a tile; none where nothing stands. */
const rulesAt = (y: Yard, i: number) => RULES[y.kind[i] ?? NONE];
/** Whether a tile is a piece's own: one of one tile, or the tile a piece of more than one stands on (`sizes.ts`). */
const isOwn = (y: Yard, i: number): boolean => y.part[i] === 0 || y.part[i] === OWN;

/** Whether a kind carries things across its tile. */
export const carries = (k: number): k is Kind => CARRIES[k] === 1;
/** How many ways out a piece with ways has: a splitter's and a sorter's are ahead, left and right; 0 for one that hands to one tile. */
export const waysOf = (k: number): number => WAYS[k] ?? 0;

/** The one tile a piece hands to, or -1: none for a piece with ways, nor for one that hands nothing on. */
export function nextOf(y: Yard, i: number): number {
  const r = rulesAt(y, i);
  return r ? r.next(KIT, y, pieceOf(y, i)) : -1;
}

/** The ways out a piece sends nothing by, a bit each (1 ahead, 2 left, 4 right). */
export function closedWays(y: Yard, i: number): number {
  const r = rulesAt(y, i);
  return r ? r.closed(KIT, y, i) : 0;
}

/** A piece's way out (0 ahead, 1 left, 2 right), or -1 where it is closed or off the map. */
export const wayOut = (y: Yard, i: number, way: number): number =>
  (closedWays(y, i) >> way) & 1 ? -1 : wayTo(y, i, way);

/** The ways out (a bit each, as `closedWays`) a piece with ways sends the thing `n` by. */
export function sendsOf(y: Yard, i: number, n: number): number {
  const r = rulesAt(y, i);
  return r ? r.sends(KIT, y, pieceOf(y, i), n) : 0;
}

/**
 * The sides a piece takes things in from, a bit for each way (east 1, south 2, west 4, north 8),
 * whatever it holds just now, as its kind says.
 */
export function sidesTaken(y: Yard, i: number): number {
  if (y.part[i] !== 0) return takesAt(y, i);
  const r = rulesAt(y, i);
  return r ? r.sides(KIT, y, i) : 0;
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

/**
 * Whether the piece on a tile takes the thing `n` at all, from whichever side it takes things by,
 * full or not, as its kind says. Whether it has room for it this tick is the tick's to ask, after this.
 */
export function wants(y: Yard, to: number, n: number): boolean {
  const r = rulesAt(y, to);
  return r ? r.wants(KIT, y, pieceOf(y, to), n) : false;
}

// ---------- the one rule by which a piece hands a thing to another ----------

/** Each kind's hooks for taking a thing in, by its number: whether it wants it, has room for it, and takes it. */
const WANTS = RULES.map((r) => r.wants);
const ROOM = RULES.map((r) => r.room);
const GIVE = RULES.map((r) => r.give);
/**
 * 1 for each kind that takes a thing as a belt does, by the carriers' own hooks (`kinds/line.ts`):
 * anything, onto its tile while nothing is on it. Most of what a tick hands on goes onto such a tile,
 * so it is asked here, before any hook: what the hooks would say, without the calls.
 */
const PLAIN = Uint8Array.from(RULES, (r) => (r.wants === anything && r.room === empty && r.give === lay ? 1 : 0));

/** Whether the tile at `i` has something finished that it means to hand to the tile at `to`. */
export function ready(y: Yard, i: number, to: number): boolean {
  if (i < 0) return false;
  const r = rulesAt(y, i);
  return r ? r.ready(KIT, y, pieceOf(y, i), to) : false;
}

/** Whether the tile at `to` lets things in by turns (a joiner, or a splitter with ways in): a thing it refuses does not wait. */
export function takesTurns(y: Yard, to: number): boolean {
  if (to < 0) return false;
  const k = y.kind[to] ?? NONE;
  if (TAKES_TURNS[k] !== 1) return false;
  return RULES[k]?.turns(KIT, y, to) ?? false;
}

/**
 * Whether it is the turn of the way in `slot` of a piece whose ways in take turns (`ways` of them,
 * the next being `turn`): it waits for whoever's turn it is, so long as they have something ready to
 * give, the tile each way in takes from being `from`. A slot of -1 is no way in, never its turn.
 */
export function onTurn(
  k: Kit,
  y: Yard,
  to: number,
  slot: number,
  ways: number,
  turn: number,
  from: (k: Kit, y: Yard, to: number, s: number) => number,
): boolean {
  if (slot < 0) return false;
  for (let s = turn % ways; s !== slot; s = (s + 1) % ways) if (ready(y, from(k, y, to, s), to)) return false;
  return true;
}

/**
 * Whether the tile at `to` will take the thing `n` handed to it from the tile beside it on its side
 * `side` (a way), asked in three steps the rules answer apart: whether it takes things from that side
 * (`Wire.taken`, which `takes` reads too), whether it takes that thing (`wants`), and whether it has
 * room for it this tick (its kind's `room`).
 */
export function accepts(y: Yard, to: number, n: number, side: number, wire: Wire): boolean {
  if (to < 0 || (((wire.taken[to] ?? 0) >> side) & 1) === 0) return false;
  const k = y.kind[to] ?? NONE;
  if (PLAIN[k] === 1) return y.item[to] === NONE;
  // A piece of more than one tile takes on the tile handed to, by its ports (`Wire.taken`), and as itself.
  const own = pieceOf(y, to);
  const takesIt = WANTS[k];
  const roomFor = ROOM[k];
  // A machine's, which most of what is not a belt is, by its own name (`tick.ts` says why).
  if (takesIt === makerWants && roomFor === makerRoom)
    return makerWants(KIT, y, own, n) && makerRoom(KIT, y, own, n, side, wire);
  return takesIt !== undefined && roomFor !== undefined && takesIt(KIT, y, own, n) && roomFor(KIT, y, own, n, side, wire);
}

/** Hands the thing `n` to the tile at `to` from its side `side`, `over` eighths past the edge of the tile it came from. */
function handTo(y: Yard, to: number, n: number, side: number, over: number, wire: Wire): void {
  const k = y.kind[to] ?? NONE;
  if (PLAIN[k] === 1) {
    y.item[to] = n;
    y.prog[to] = over;
    y.via[to] = 1 + side;
    return;
  }
  const own = pieceOf(y, to);
  const give = GIVE[k];
  if (give === keep) keep(KIT, y, own, n, side, over, wire);
  else if (give) give(KIT, y, own, n, side, over, wire);
}

/**
 * The tile at `i` may have room for more, or for another thing: the tiles that may hand to it stop
 * waiting. They are the tiles beside it, and for a tunnel's far mouth, its way-in mouth. Each side is
 * woken without asking first whether it is on the map, which every hand-off would pay for: past the
 * end of a row is a tile at the other end of the next, which at worst tries again for nothing, and
 * past the top or bottom row is outside the array, where writing does nothing.
 */
export function roomBeside(y: Yard, i: number, waiting: Uint8Array): void {
  const w = y.land.w;
  waiting[i + 1] = 0;
  waiting[i - 1] = 0;
  waiting[i + w] = 0;
  waiting[i - w] = 0;
  // A far mouth is the one tile with a span below 0. This stays this small so that every hand-off has
  // it inlined: with the far mouth's case in it, it was not, and a line of belts ran 40% slower.
  if ((y.span[i] ?? 0) < 0) mouthBehind(y, i, waiting);
}

/**
 * The piece on a tile that holds things may have room, as `roomBeside`: for a piece of more than one
 * tile, every tile round it (`roomRound`). What carries is one tile, and asks `roomBeside` itself, so
 * that stays as small as it must.
 */
export function roomAt(y: Yard, i: number, waiting: Uint8Array): void {
  if (y.part[i] !== 0) roomRound(y, i, waiting);
  else roomBeside(y, i, waiting);
}

/** A tunnel's far mouth may have room: its way-in mouth stops waiting. */
function mouthBehind(y: Yard, i: number, waiting: Uint8Array): void {
  if (SPANS[y.kind[i] ?? NONE] !== 1) return;
  const mouth = otherMouth(y, i);
  if (mouth >= 0) waiting[mouth] = 0;
}

/**
 * The tile at `i` could not hand on what it holds to the tile at `to`, which had no room for it: it
 * waits. Not at a tile whose ways in take turns, which may let it in once the thing whose turn it is
 * goes another way, with nothing beside that tile changed; there it tries again each tick.
 */
export function refused(y: Yard, i: number, to: number, wire: Wire): void {
  if (!takesTurns(y, to)) wire.waiting[i] = 1;
}

/**
 * Hands what the tile at `i` carries to the tile at `to`, which it comes into by its side `side`, if
 * that tile takes it, with how far past the edge it had come. Says whether it did.
 */
export function passTo(y: Yard, i: number, to: number, side: number, wire: Wire): boolean {
  const n = y.item[i] ?? NONE;
  if (!accepts(y, to, n, side, wire)) return false;
  handTo(y, to, n, side, (y.prog[i] ?? 8) - 8, wire);
  y.item[i] = NONE;
  y.prog[i] = 0;
  y.via[i] = 0;
  roomBeside(y, i, wire.waiting);
  return true;
}

/** Hands what a piece with ways carries to its way out `way`, if the tile there takes it. Says whether it did. */
export const passWay = (y: Yard, i: number, way: number, wire: Wire): boolean =>
  passTo(y, i, wayOut(y, i, way), ((y.dir[i] ?? 0) + (WAY_TURN[way] ?? 0) + 2) & 3, wire);

/** A holder hands on its finished piece (its row `r`), to the tile ahead. */
export function sendOut(y: Yard, i: number, r: number, wire: Wire): void {
  const h = y.holders;
  const n = h.out[r] ?? NONE;
  const to = ahead(y, i);
  const side = ((y.dir[i] ?? 0) + 2) & 3;
  if (!accepts(y, to, n, side, wire)) {
    refused(y, i, to, wire);
    return;
  }
  handTo(y, to, n, side, 0, wire);
  h.out[r] = NONE;
  roomAt(y, i, wire.waiting);
}

/**
 * A piece of more than one tile (its own tile `i`, its row `r`) hands what one of its ways out sends
 * (`port`: its finished thing, or its by-product) to the tile ahead of that way. Says whether it did.
 * One refused does not wait: its other way out may still send, so it tries again each tick.
 */
export function sendPort(y: Yard, i: number, r: number, port: number, wire: Wire): boolean {
  const o = outsOf(y, i)[port];
  const slot = o?.also ? y.holders.also : y.holders.out;
  const n = slot[r] ?? NONE;
  if (!o || n === NONE) return false;
  const w = y.land.w;
  const to = toward(y.land, i + o.dx + o.dy * w, o.way);
  const side = (o.way + 2) & 3;
  if (!accepts(y, to, n, side, wire)) return false;
  handTo(y, to, n, side, 0, wire);
  slot[r] = NONE;
  roomRound(y, i, wire.waiting);
  return true;
}

// ---------- the plumbing, worked out ----------

/** The yard's plumbing as it stands, worked out first if a change left it unknown. */
export const wireOf = (y: Yard): Wire => y.wire ?? rewire(y);

/** Works out the yard's plumbing from what stands where. */
export function rewire(y: Yard): Wire {
  const lit = litOf(y);
  const { kind } = y;
  const n = kind.length;
  const carry: number[] = [];
  const work: number[] = [];
  const burners: number[] = [];
  // Power in halves: a piece draws its kind's power once for each half its grade draws (`drawnAt`).
  let steady = y.open.depot * HALF;
  let demand = 0;
  for (let i = 0; i < n; i++) {
    const k = kind[i] ?? NONE;
    const r = RULES[k];
    // A piece of more than one tile is listed once, by its own tile, and has power if any of its tiles has.
    if (!r || !isOwn(y, i)) continue;
    if (carries(k)) carry.push(i);
    else if ((y.part[i] === 0 ? lit[i] : litBig(y, lit, i)) !== 1) continue;
    else if (r.work !== null) {
      work.push(i);
      demand += drawnAt(k, y.grade[i] ?? 0);
    } else if (r.steady !== null) steady += r.steady(KIT, y, i);
    else if (BURNS[k]) burners.push(i);
  }
  const taken = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (kind[i] !== NONE) taken[i] = sidesTaken(y, i);
  const wire: Wire = {
    order: handingOrder(y),
    taken,
    carry: Int32Array.from(carry),
    mouths: Int32Array.from(carry.filter((i) => tunnelOf(y, i) >= 0)),
    work: Int32Array.from(work),
    burners: Int32Array.from(burners),
    recipes: ALL_KINDS.map((k) => recipesFor(y.open, k)),
    steady,
    demand,
    waiting: new Uint8Array(n),
    waitingFrom: y.rev,
  };
  y.wire = wire;
  y.demand = demand;
  y.supply = steady + burningNow(y, burners);
  return wire;
}

/** The power what burns gives as it stands, in halves: each burning now, as its kind says (`KindDef.burns`). */
function burningNow(y: Yard, burners: readonly number[]): number {
  let burning = 0;
  for (const i of burners)
    if ((y.holders.fuel[holderOf(y, i)] ?? 0) > 0) burning += BURNS[y.kind[i] ?? NONE]?.halves ?? 0;
  return burning;
}

/** Whether a kind hands things on at all: those with a step in handing on. */
const hands = (k: number): boolean => (RULES[k]?.hands ?? null) !== null;

/**
 * The tiles that hand things on, each after the tiles it hands to, so that a full belt moves as
 * one: a walk from each tile in turn, a piece's ways in order, each tile once.
 */
function handingOrder(y: Yard): Int32Array {
  const n = y.kind.length;
  const seen = new Uint8Array(n);
  const child = new Uint8Array(n);
  const stack = new Int32Array(n);
  const order: number[] = [];
  let top = 0;
  // A piece of more than one tile hands on from its own tile, and is handed to on any.
  const enter = (t: number): void => {
    const i = t < 0 ? t : pieceOf(y, t);
    if (i < 0 || seen[i] === 1) return;
    seen[i] = 1;
    if (hands(y.kind[i] ?? NONE)) stack[top++] = i;
  };
  for (let s = 0; s < n; s++) {
    enter(s);
    while (top > 0) {
      const i = stack[top - 1] ?? 0;
      const c = child[i] ?? 0;
      const outs = y.part[i] === 0 ? 0 : outsOf(y, i).length;
      const ways = outs > 0 ? outs : waysOf(y.kind[i] ?? NONE);
      if (c >= Math.max(1, ways)) {
        top--;
        order.push(i);
        continue;
      }
      child[i] = c + 1;
      enter(outs > 0 ? portTo(y, i, c) : ways > 0 ? wayOut(y, i, c) : nextOf(y, i));
    }
  }
  return Int32Array.from(order);
}

/** The tile a piece of more than one tile's way out `port` sends to, or -1. */
export function portTo(y: Yard, i: number, port: number): number {
  const o = outsOf(y, i)[port];
  return o ? toward(y.land, i + o.dx + o.dy * y.land.w, o.way) : -1;
}

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

/** How many of each thing the piece on a tile may hold, as its kind says (`Hooks.most`). */
const mostHeld = (y: Yard, i: number, n: number): number => rulesAt(y, i)?.most(KIT, y, pieceOf(y, i), n) ?? 0;

/** A whole number from 0 to `most`, or null. */
const whole = (v: unknown, most: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most ? v : null;

/**
 * The kit: what of the rules each kind's hooks are given (`kinds/kind.ts`). A kind uses only this,
 * so whatever a kind can do to a yard is here to read.
 */
export const KIT: Kit = {
  // The tables.
  NONE,
  ITEM_COUNT,
  ALL_ITEMS,
  ITEM_INFO,
  RECIPE,
  GOALS,
  FOLIOS,
  DEADFALL,
  PACE,
  HALF,
  TOP,
  TINTS,
  SPAN_MOST,
  WORK_OF,
  FIXED,
  TINTED,
  GRADED,
  isItem,
  isKind,
  isRaw,
  isFolio,
  isMaker,
  drawnAt,
  holdsMost,
  locked,
  recipesFor,
  makes,
  MINUTE,
  BURNS,
  whole,
  // The yard's reads and writes.
  holderOf,
  tunnelOf,
  put,
  take,
  held,
  enough,
  counts,
  changed,
  place,
  tunnelRow,
  insTo,
  unpackWays,
  mostHeld,
  // The tiles about a piece.
  DX,
  DY,
  WAY_TURN,
  at,
  kindAt,
  ground,
  toward,
  besideWater,
  ahead,
  behind,
  wayIn,
  farMouth,
  otherMouth,
  // Who hands to whom, and the one rule of handing a thing on.
  nextOf,
  closedOf: closedWays,
  wayOut,
  waysOf,
  sendsOf,
  takes,
  wants,
  ready,
  takesTurns,
  onTurn,
  passTo,
  passWay,
  sendOut,
  sendPort,
  portTo,
  outsOf,
  refused,
  roomBeside: roomAt,
  wireOf,
  // What reaches the depot and the research; power.
  deliver,
  giveGoal,
  litOf,
  litAt,
  pace: (y: Yard): number => power(y).pace,
};
export type { Kit };
