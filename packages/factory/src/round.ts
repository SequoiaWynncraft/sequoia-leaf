/**
 * Handing on in a yard with rings in its plumbing (`Rings`): parts of it where things handed on come
 * back round, so that no order puts each tile after the tile it hands to. Every tile off the rings
 * hands on in the plumbing's order as in any yard (`tick.ts`), and each ring takes its turn as one
 * where its last tile stood (`Wire.order`): after every tile it hands to off the ring, before every
 * tile that hands to it from off the ring.
 *
 * A ring's turn: its tiles in turn, in the handing order, hand on, and then again, as long as one of
 * them moved a thing. So every tile freed lets the one behind it move in the same turn, whatever
 * stands on the ring and wherever the order breaks round it, and a ring moves as one at the belt's
 * pace while something takes things off it, as a full line does. A full ring with no way off stays
 * still: nothing on it moves, and its turn ends after the first time round.
 *
 * Each thing moves at most once a tick, as anywhere. A thing handed onto what carries comes onto its
 * tile less than across it, and is not handed on until it has crossed it; under the ground the same.
 * A holder (a crate, a grower) hands on once a turn, and only what it held ready before anything came
 * into it: one with nothing to hand on when it tried is done, whatever comes into it after.
 *
 * So the turn ends: each time round in which something moves, a carrier holds one fewer thing that
 * has crossed its tile, or a holder hands on, which it does once; neither comes back in a turn.
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
 * Ring `k` takes its turn (as the module says): its tiles hand on, time and again, until a time round
 * in which nothing moved. Another time round is needed only where something moved after a tile that
 * was not done, which may have room now, and begins there: every tile before it is done.
 */
function turnRing(y: Yard, wire: Wire, k: number, waiting: Uint8Array): void {
  const to = wire.rings.starts[k + 1] ?? 0;
  for (let t = wire.rings.starts[k] ?? 0; t >= 0;) t = roundOnce(y, wire, t, to, waiting);
}

/**
 * One time round a ring, from its tile `from` (in `Rings.tiles`) to `to`: where the next must begin,
 * the first tile not done if something moved after it, or -1.
 */
function roundOnce(y: Yard, wire: Wire, from: number, to: number, waiting: Uint8Array): number {
  const { tick, prog } = y;
  const { tiles, done, plain } = wire.rings;
  let open = to;
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
    else if (t < open) open = t;
  }
  return open < last ? open : -1;
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
