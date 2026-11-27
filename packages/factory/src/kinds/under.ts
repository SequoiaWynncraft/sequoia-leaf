import type { Yard } from "../yard.ts";
/**
 * Carrying under the ground, shared by every kind that runs under tiles (a tunnel; deeper ones
 * later): its way-in mouth moves what is under it along a tile at a time, brings it up at its far
 * mouth, and takes in what has crossed its own tile. The tick does this for every way-in mouth by
 * name (`tick.ts`), as a carrier's own step.
 */
import type { Kit } from "./kit.ts";

/**
 * Whether it is full under the ground, everything across its tile, behind its own far mouth: nothing
 * in it moved, as the far mouth had no room, and nothing will until that mouth hands on
 * (`roomBeside`), whatever comes in at the way-in mouth meanwhile.
 */
function jammed(k: Kit, y: Yard, i: number, at: number, last: number): boolean {
  const { under, along } = y.tunnels;
  for (let t = at; t <= last; t++) if (under[t] === k.NONE || (along[t] ?? 0) < 8) return false;
  return k.otherMouth(y, k.farMouth(y, i)) === i;
}

/**
 * The way-in mouth moves what is under it along: each thing that has crossed its tile under the
 * ground goes on to the next, or from the last comes up at the far mouth if that has room; then it
 * takes in what has crossed its own tile. It waits while it is full under the ground behind its far
 * mouth (`jammed`). The loop runs every tick, so it is here whole; what moves a thing is apart.
 */
export function passUnder(k: Kit, y: Yard, i: number, waiting: Uint8Array): void {
  const { under, along } = y.tunnels;
  const at = k.tunnelOf(y, i) * k.SPAN_MOST;
  const last = at + (y.span[i] ?? 0) - 1;
  for (let t = last; t >= at; t--)
    if (under[t] !== k.NONE && (along[t] ?? 0) >= 8 && (t === last ? surface(k, y, i, t) : onward(k, y, t))) {
      under[t] = k.NONE;
      along[t] = 0;
    }
  if (y.item[i] !== k.NONE && (y.prog[i] ?? 0) >= 8 && under[at] === k.NONE) takeIn(k, y, i, at, waiting);
  // Full under the ground needs its first tile full: most ticks of a tunnel with room ask no more.
  if (under[at] !== k.NONE && jammed(k, y, i, at, last)) waiting[i] = 1;
}

/** What has crossed the last tile under the ground (row `t`) comes up at the far mouth, if that has room. Says whether it did. */
function surface(k: Kit, y: Yard, i: number, t: number): boolean {
  const mouth = k.farMouth(y, i);
  if (mouth < 0 || y.kind[mouth] === k.NONE || y.item[mouth] !== k.NONE) return false;
  y.item[mouth] = y.tunnels.under[t] ?? k.NONE;
  y.prog[mouth] = (y.tunnels.along[t] ?? 8) - 8;
  y.via[mouth] = 0;
  return true;
}

/** What has crossed a tile under the ground (row `t`) goes on to the next, if that is empty. Says whether it did. */
function onward(k: Kit, y: Yard, t: number): boolean {
  const { under, along } = y.tunnels;
  if (under[t + 1] !== k.NONE) return false;
  under[t + 1] = under[t] ?? k.NONE;
  along[t + 1] = (along[t] ?? 8) - 8;
  return true;
}

/** The way-in mouth takes in what has crossed its own tile, to its first tile under the ground (row `at`). */
function takeIn(k: Kit, y: Yard, i: number, at: number, waiting: Uint8Array): void {
  y.tunnels.under[at] = y.item[i] ?? k.NONE;
  y.tunnels.along[at] = (y.prog[i] ?? 8) - 8;
  y.item[i] = k.NONE;
  y.prog[i] = 0;
  y.via[i] = 0;
  k.roomBeside(y, i, waiting);
}
