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

/** Ring `k` takes its turn (as the module says): its tiles hand on, time and again, until a time round in which nothing moved. */
function turnRing(y: Yard, wire: Wire, k: number, waiting: Uint8Array): void {
  const { tiles, starts, done } = wire.rings;
  const from = starts[k] ?? 0;
  const to = starts[k + 1] ?? 0;
  done.fill(0, from, to);
  for (let moved = true; moved;) {
    moved = false;
    for (let t = from; t < to; t++) {
      const i = tiles[t] ?? 0;
      if (done[t] === 1 || waiting[i] === 1) continue;
      const did = tryOn(y, wire, i, waiting);
      if ((did & MOVED) !== 0) moved = true;
      if ((did & HELD) === 0) done[t] = 1;
    }
  }
}

/**
 * A ring tile's try at handing on: what it did (`MOVED`, `HELD`). A holder that moved holds nothing it
 * may hand on this turn, so says only that it moved.
 */
function tryOn(y: Yard, wire: Wire, i: number, waiting: Uint8Array): number {
  const k = y.kind[i] ?? NONE;
  if (CARRIES[k] !== 1) {
    const had = heldIn(y, i);
    if (had === 0) return 0;
    const hands = HANDS[k];
    if (hands === handOut) handOut(KIT, y, i, wire);
    else hands?.(KIT, y, i, wire);
    if (heldIn(y, i) < had) return MOVED;
    return readyIn(y, i) ? HELD : 0;
  }
  const had = crossed(y, i);
  if (had === 0) return 0;
  if ((y.span[i] ?? 0) > 0) passUnder(KIT, y, i, waiting);
  else {
    const hands = HANDS[k];
    if (hands === carryOn) carryOn(KIT, y, i, wire);
    else hands?.(KIT, y, i, wire);
  }
  const left = crossed(y, i);
  return (left < had ? MOVED : 0) | (left > 0 ? HELD : 0);
}

/** How many things a carrier holds that have crossed its tile, or its tiles under the ground (a tunnel's way-in mouth). */
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
