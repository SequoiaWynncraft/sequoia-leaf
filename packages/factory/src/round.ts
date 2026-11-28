/**
 * Handing on in a yard with rings in its plumbing (`Rings`): parts of it where things handed on come
 * back round, so that no order puts each tile after the tile it hands to. Every tile off the rings
 * hands on in the plumbing's order as in any yard (`tick.ts`), and each ring takes its turn as one
 * where its last tile stood (`Wire.order`): after every tile it hands to off the ring, before every
 * tile that hands to it from off the ring.
 *
 * A ring's turn: what holds things on it tries first, then its tiles in the handing order, each after
 * the tiles it hands to have tried and made room (`rings.ts`), begun at a tile with room so that the
 * order's break round the ring costs nothing; then once more, the tiles not done, where something moved
 * after the first of them. Two times round at most, so a turn costs a few looks a tile however the
 * ring is built. A ring of belts
 * moves as one at the belt's pace while something takes things off it, wherever its free tiles are, as
 * a full line does; a full ring with no way off stays still. Where ways off and back onto a ring cross
 * it many times, a thing may move a tick late, the same on Leaf and on the page.
 *
 * Each thing moves at most once a tick, as anywhere. A thing handed onto what carries comes onto its
 * tile less than across it (a thing moves at most 4 eighths a tick, and comes on past the edge by what
 * it had over), and is not handed on until it has crossed it; under the ground the same. A holder (a
 * crate, a grower) hands on at most once a turn, and tries first, before anything on the ring moves:
 * it hands on only what it held when the tick began.
 */
import { handOut } from "./kinds/holder.ts";
import { carryOn } from "./kinds/line.ts";
import { RULES } from "./kinds/list.ts";
import { passUnder } from "./kinds/under.ts";
import type { Wire } from "./plumbing.ts";
import { CARRIES, NONE, SPAN_MOST } from "./tables.ts";
import { KIT } from "./wire.ts";
import { holderOf, tunnelOf, type Yard } from "./yard.ts";

const HANDS = RULES.map((r) => r.hands);

/** What a tile's try in a ring's turn did (`tryOn`): moved a thing; still holds one it means to hand on. */
const MOVED = 1;
const HELD = 2;

/**
 * Every tile hands on what it has finished with, each after the tiles it hands to, but a tile that
 * waits, as in a yard with no rings (`tick.ts`, whose loop this is), and each ring takes its turn where
 * the plumbing's order marks it (`turnRing`).
 */
export function handOnRings(y: Yard, wire: Wire, waiting: Uint8Array): void {
  const { kind, item, prog, span } = y;
  const order = wire.order;
  for (let o = 0; o < order.length; o++) {
    const i = order[o] ?? 0;
    if (i < 0) {
      turnRing(y, wire, -1 - i, waiting);
      continue;
    }
    if (waiting[i] === 1) continue;
    const k = kind[i] ?? NONE;
    if (CARRIES[k] === 1) {
      if ((span[i] ?? 0) > 0) {
        passUnder(KIT, y, i, waiting);
        continue;
      }
      if (item[i] === NONE || (prog[i] ?? 0) < 8) continue;
    }
    const hands = HANDS[k];
    if (hands === carryOn) carryOn(KIT, y, i, wire);
    else if (hands === handOut) handOut(KIT, y, i, wire);
    else if (hands) hands(KIT, y, i, wire);
  }
}

/**
 * Ring `k` takes its turn (as the module says): what holds things on it tries first, then every tile
 * in the order its turn tries them (`Rings.tiles`), begun at its first free tile (`beginAt`) and round
 * to it, then those not done once more if anything moved after the first of them; its turn notes
 * whether anything moved (`Rings.still`).
 */
function turnRing(y: Yard, wire: Wire, k: number, waiting: Uint8Array): void {
  const { starts, still } = wire.rings;
  const from = starts[k] ?? 0;
  const end = starts[k + 1] ?? 0;
  const held = holdersFirst(y, wire, k, waiting);
  const at = beginAt(y, wire, k);
  const head = sweep(y, wire, at, end, waiting);
  const tail = sweep(y, wire, from, at, waiting);
  // The first tile not done and the last that moved, in the order begun at `at`: the tail comes after the head.
  const open = openOf(head) >= 0 ? openOf(head) - at : openOf(tail) - from + (end - at);
  const last = lastOf(tail) >= 0 ? lastOf(tail) - from + (end - at) : lastOf(head) - at;
  if (openOf(head) < 0 && openOf(tail) < 0) {
    if (!held && last < 0) still[k] = y.tick;
    return;
  }
  if (open < last) {
    if (openOf(head) >= 0) {
      sweep(y, wire, openOf(head), end, waiting);
      sweep(y, wire, from, at, waiting);
    } else sweep(y, wire, openOf(tail), at, waiting);
  }
  if (!held && last < 0) still[k] = y.tick;
}

/** The place in `Rings.tiles` of the first tile a sweep left not done, or -1 (`sweep`). */
const openOf = (swept: number): number => Math.floor(swept / SPAN) - 1;
/** The place in `Rings.tiles` of the last tile a sweep saw move, or -1 (`sweep`). */
const lastOf = (swept: number): number => (swept % SPAN) - 1;
/** More places than any yard has ring tiles: a sweep's two places are kept in one number by it. */
const SPAN = 2 ** 24;

/**
 * Where ring `k`'s turn begins (a place in `Rings.tiles`): at a tile of it that carries nothing, which
 * needs nothing of the ring to have room, so the tiles behind it all move in the turn; looked for from
 * where the last turn began, round the ring, as a free tile goes on round it as the ring moves. With
 * none, at the first that holds things, else where its order begins.
 */
function beginAt(y: Yard, wire: Wire, k: number): number {
  const { tiles, starts, begin, looked } = wire.rings;
  const from = starts[k] ?? 0;
  const len = (starts[k + 1] ?? 0) - from;
  const was = begin[k] ?? from;
  for (let n = 0; n < len; n++) {
    const t = was + n < from + len ? was + n : was + n - len;
    const i = tiles[t] ?? 0;
    if (y.item[i] === NONE && CARRIES[y.kind[i] ?? NONE] === 1) {
      looked[0] = (looked[0] ?? 0) + n + 1;
      begin[k] = t;
      return t;
    }
  }
  looked[0] = (looked[0] ?? 0) + len;
  return firstHolder(wire, k);
}

/** Where ring `k`'s first holder is (a place in `Rings.tiles`), or where its order begins. */
function firstHolder(wire: Wire, k: number): number {
  const { holders, holderStarts, starts } = wire.rings;
  const h = holderStarts[k] ?? 0;
  return h < (holderStarts[k + 1] ?? 0) ? (holders[h] ?? 0) : (starts[k] ?? 0);
}

/**
 * Each holder on ring `k` tries to hand on what it holds, before anything on the ring has moved: so it
 * hands on only what it held when the tick began, and one that held nothing is done for the tick,
 * whatever comes into it. Says whether one did.
 */
function holdersFirst(y: Yard, wire: Wire, k: number, waiting: Uint8Array): boolean {
  const { tiles, holders, holderStarts, done, looked } = wire.rings;
  const from = holderStarts[k] ?? 0;
  const to = holderStarts[k + 1] ?? 0;
  let moved = false;
  for (let h = from; h < to; h++) {
    const t = holders[h] ?? 0;
    const i = tiles[t] ?? 0;
    // One that waits holds a thing it could not hand on: it may yet, once it is woken.
    if (waiting[i] === 1) continue;
    const did = tryHolder(y, wire, i, y.kind[i] ?? NONE);
    if ((did & MOVED) !== 0) moved = true;
    if ((did & HELD) === 0) done[t] = y.tick;
  }
  looked[0] = (looked[0] ?? 0) + (to - from);
  return moved;
}

/**
 * Ring tiles from `from` to `to` (places in `Rings.tiles`), each not done trying to hand on: where the
 * first left not done is and where the last that moved is, each plus 1 (0 for none), the first over
 * the second, as `openOf` and `lastOf` read them.
 */
function sweep(y: Yard, wire: Wire, from: number, to: number, waiting: Uint8Array): number {
  const { tick, prog } = y;
  const { tiles, done, plain, looked } = wire.rings;
  let open = -1;
  let last = -1;
  for (let t = from; t < to; t++) {
    if (done[t] === tick) continue;
    const i = tiles[t] ?? 0;
    // What carries on its own tile alone holds at most one thing, which stays this turn till it has
    // crossed it: most of a ring's tiles most ticks, so asked here, without a call.
    let did = HELD;
    if (waiting[i] !== 1)
      did = plain[t] !== 1 ? tryOn(y, wire, i, waiting) : (prog[i] ?? 0) < 8 ? 0 : tryPlain(y, wire, i);
    if ((did & MOVED) !== 0) last = t;
    if ((did & HELD) === 0) done[t] = tick;
    else if (open < 0) open = t;
  }
  looked[0] = (looked[0] ?? 0) + (to - from);
  return (open + 1) * SPAN + (last + 1);
}

/** A ring tile's try at handing on but a plain carrier's (`tryPlain`): what it did (`MOVED`, `HELD`). */
function tryOn(y: Yard, wire: Wire, i: number, waiting: Uint8Array): number {
  const k = y.kind[i] ?? NONE;
  return CARRIES[k] === 1 ? tryMouth(y, i, waiting) : tryHolder(y, wire, i, k);
}

/**
 * What carries on its own tile alone, its thing across it, tries to hand it on: it does, or waits. A
 * belt's step (most of a ring's tiles) is called by its own name, as the tick calls it (`tick.ts`).
 */
function tryPlain(y: Yard, wire: Wire, i: number): number {
  if (y.item[i] === NONE) return 0;
  const hands = HANDS[y.kind[i] ?? NONE];
  if (hands === carryOn) carryOn(KIT, y, i, wire);
  else hands?.(KIT, y, i, wire);
  return y.item[i] !== NONE && (y.prog[i] ?? 0) >= 8 ? HELD : MOVED;
}

/** A tunnel's way-in mouth's try: it moves what is under it and takes in what has crossed its tile, as it can. */
function tryMouth(y: Yard, i: number, waiting: Uint8Array): number {
  const had = crossed(y, i);
  if (had === 0) return 0;
  passUnder(KIT, y, i, waiting);
  const left = crossed(y, i);
  return (left < had ? MOVED : 0) | (left > 0 ? HELD : 0);
}

/** A holder's try (a crate, a grower): one that moved holds nothing it may hand on this turn, so says only that it moved. */
function tryHolder(y: Yard, wire: Wire, i: number, k: number): number {
  const had = heldIn(y, i);
  if (had === 0) return 0;
  const hands = HANDS[k];
  if (hands === handOut) handOut(KIT, y, i, wire);
  else hands?.(KIT, y, i, wire);
  if (heldIn(y, i) < had) return MOVED;
  return readyIn(y, i) ? HELD : 0;
}

/** How many things a tunnel's way-in mouth holds that have crossed its tile, or its tiles under the ground. */
function crossed(y: Yard, i: number): number {
  let n = y.item[i] !== NONE && (y.prog[i] ?? 0) >= 8 ? 1 : 0;
  const span = y.span[i] ?? 0;
  if (span <= 0) return n;
  const { under, along } = y.tunnels;
  const at = tunnelOf(y, i) * SPAN_MOST;
  for (let t = at; t < at + span; t++) if (under[t] !== NONE && (along[t] ?? 0) >= 8) n++;
  return n;
}

/** How many things a holder holds, those it has finished and holds ready among them: fewer once it has handed one on. */
function heldIn(y: Yard, i: number): number {
  const h = y.holders;
  const r = holderOf(y, i);
  return (h.count[r] ?? 0) + (h.out[r] === NONE ? 0 : 1 + (h.more[r] ?? 0)) + (h.also[r] === NONE ? 0 : 1);
}

/** Whether a holder holds a finished thing ready to hand on. */
function readyIn(y: Yard, i: number): boolean {
  const r = holderOf(y, i);
  return y.holders.out[r] !== NONE || y.holders.also[r] !== NONE;
}
