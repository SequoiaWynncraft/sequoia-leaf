/**
 * The tunnel: a belt that runs under 1 to 3 tiles (more, as goals raise `span`) and comes up on the
 * other side. It is two pieces set down and taken up together: the way-in mouth, which takes things
 * in from behind and holds what is under the ground in a row of `tunnels` (`span` positive, how many
 * tiles it passes under), and the far mouth (`span` negative), which hands them on ahead as a belt.
 * Neither can be turned; laid over one of its kind, a tunnel is only raised or lowered.
 */
import type { Lay } from "../build.ts";
import type { Wire, Yard } from "../yard.ts";
import { kind } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { anything, behindOnly, carrierCondition, carrierWords, carryOn, empty, lay, readyAhead } from "./line.ts";

/** Where a tunnel going in at (x, y) facing `d` would come up: the nearest clear tile beyond one to as many as it may run under, or the end of `span`. */
export function exitOf(
  k: Kit,
  y: Yard,
  x: number,
  z: number,
  d: number,
  span?: number,
): { x: number; y: number; span: number } | null {
  const most = span ?? y.open.span;
  if (most < 1 || most > y.open.span) return null;
  for (let s = 1; s <= most; s++) {
    if (!digs(k, y, x + (k.DX[d & 3] ?? 0) * s, z + (k.DY[d & 3] ?? 0) * s)) return null;
    if (span !== undefined && s < span) continue;
    const ex = x + (k.DX[d & 3] ?? 0) * (s + 1);
    const ey = z + (k.DY[d & 3] ?? 0) * (s + 1);
    if (k.ground(y, ex, ey) === null && k.kindAt(y, ex, ey) === k.NONE) return { x: ex, y: ey, span: s };
  }
  return null;
}

/** Whether a tunnel may pass under a tile: under anything but the depot. */
export const digs = (k: Kit, y: Yard, x: number, z: number): boolean => k.FIXED[k.kindAt(y, x, z)] !== 1;

function underDepot(k: Kit, y: Yard, x: number, z: number, d: number, span?: number): boolean {
  for (let s = 1; s <= (span ?? y.open.span); s++)
    if (!digs(k, y, x + (k.DX[d & 3] ?? 0) * s, z + (k.DY[d & 3] ?? 0) * s)) return true;
  return false;
}

/** Why a tunnel cannot go in here facing `d`: nowhere to come up, or the depot in the way. */
function refusal(k: Kit, y: Yard, i: number, d: number, l: Lay): string | null {
  const x = i % y.land.w;
  const z = Math.floor(i / y.land.w);
  if (exitOf(k, y, x, z, d, l.span)) return null;
  return underDepot(k, y, x, z, d, l.span)
    ? "A tunnel cannot go under the depot"
    : `A tunnel needs a free tile to come up on, 1 to ${y.open.span} tiles ahead`;
}

/**
 * Laid over one of its kind, a tunnel only raises or lowers; and one asked for with its span (as a
 * blueprint or a copy asks) only the tunnel going in here, that way, that far.
 */
function relaid(_k: Kit, y: Yard, i: number, d: number, grade: number, l: Lay): string | null {
  const other = (l.span ?? 0) > 0 && (y.span[i] !== l.span || y.dir[i] !== d);
  return y.grade[i] === grade || other ? "Something is here already" : null;
}

/** Set down as its way-in mouth on the tile `i`: its row for what is under the ground, and the far mouth where it comes up. */
function lays(k: Kit, y: Yard, i: number, d: number, grade: number, l: Lay): readonly number[] {
  const exit = exitOf(k, y, i % y.land.w, Math.floor(i / y.land.w), d, l.span);
  const own = y.kind[i] ?? k.NONE;
  if (!exit || !k.isKind(own)) return [];
  y.span[i] = exit.span;
  k.tunnelRow(y, i);
  const far = k.at(y, exit.x, exit.y);
  k.place(y, far, own, d, grade);
  y.span[far] = -exit.span;
  return [far];
}

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

/** The way-in mouth moves what is under it along, brings it up at the far mouth, and takes in what has crossed its own tile. */
function passUnder(k: Kit, y: Yard, i: number, waiting: Uint8Array): void {
  const under = y.tunnels.under;
  const along = y.tunnels.along;
  const at = k.tunnelOf(y, i) * k.SPAN_MOST;
  const last = at + (y.span[i] ?? 0) - 1;
  bringUp(k, y, i, at, last);
  if (y.item[i] !== k.NONE && (y.prog[i] ?? 0) >= 8 && under[at] === k.NONE) {
    under[at] = y.item[i] ?? k.NONE;
    along[at] = (y.prog[i] ?? 8) - 8;
    y.item[i] = k.NONE;
    y.prog[i] = 0;
    y.via[i] = 0;
    k.roomBeside(y, i, waiting);
  }
  if (jammed(k, y, i, at, last)) waiting[i] = 1;
}

/** What has crossed each tile under the ground (rows `at` to `last`) moves on to the next, and from the last comes up at the far mouth if it has room. */
function bringUp(k: Kit, y: Yard, i: number, at: number, last: number): void {
  const under = y.tunnels.under;
  const along = y.tunnels.along;
  const mouth = k.farMouth(y, i);
  for (let t = last; t >= at; t--) {
    const n = under[t] ?? k.NONE;
    const over = (along[t] ?? 0) - 8;
    if (n === k.NONE || over < 0) continue;
    if (t === last) {
      if (mouth < 0 || y.kind[mouth] === k.NONE || y.item[mouth] !== k.NONE) continue;
      y.item[mouth] = n;
      y.prog[mouth] = over;
      y.via[mouth] = 0;
    } else {
      if (under[t + 1] !== k.NONE) continue;
      under[t + 1] = n;
      along[t + 1] = over;
    }
    under[t] = k.NONE;
    along[t] = 0;
  }
}

/** A way-in mouth passes what is under the ground along; a far mouth hands on what has crossed it, ahead. */
function hands(k: Kit, y: Yard, i: number, wire: Wire): void {
  if ((y.span[i] ?? 0) > 0) passUnder(k, y, i, wire.waiting);
  else carryOn(k, y, i, wire);
}

export const tunnel = kind({
  name: "tunnel",
  info: {
    name: "Tunnel",
    cost: 12,
    draw: 0,
    gives: 0,
    what: "A belt that runs under 1 to 3 tiles and comes up on the other side.",
  },
  graded: true,
  carries: true,
  tint: "line",
  fast: true,
  spans: true,
  owns: ["span"],
  rules: {
    sides: (k, y, i) => ((y.span[i] ?? 0) > 0 ? behindOnly(k, y, i) : 0),
    next: (k, y, i) => ((y.span[i] ?? 0) > 0 ? k.farMouth(y, i) : k.ahead(y, i)),
    wants: anything,
    room: empty,
    give: lay,
    hands,
    ready: readyAhead,
    refusal,
    over: relaid,
    lays,
    condition: carrierCondition,
    words: carrierWords,
  },
});
