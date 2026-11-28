/**
 * The ways things can go between the pieces of a yard, as they stand now, for status alone: the tick
 * hands on by the plumbing's one order and reads none of this (`tick.ts`). A piece hands to the tile a
 * way out of it points at when that tile takes things from the side they come from, or under the
 * ground to a tunnel's far mouth, and takes something the piece may send that way (`realTo`); whether
 * it could hand what it holds that way now (`takesNow`); and the rings those ways make (`ringsNow`).
 * What of the rules this reads, `wire.ts` hands it (`Reads`), as `walk.ts` is handed the plumbing.
 */
import { anything } from "./kinds/line.ts";
import { RULES } from "./kinds/list.ts";
import { toward } from "./land.ts";
import type { Rings, Wire } from "./plumbing.ts";
import { NO_RINGS, ringsFound } from "./rings.ts";
import { outsOf, pieceOf, sendsThing } from "./sizes.ts";
import { ALL_ITEMS, CARRIES, GATHERING, GROW_OF, MIX_OF, NONE, RECIPE, SPAN_MOST, SPANS, WAYS } from "./tables.ts";
import { farMouth } from "./tiles.ts";
import { type Plumbing, walk } from "./walk.ts";
import { holderOf, tunnelOf, type Yard } from "./yard.ts";

/** What of the rules the ways are read through (`wire.ts`). */
export interface Reads {
  /** The tile a piece hands to by its way out, whatever stands there: -1 for none. */
  readonly tileTo: (y: Yard, i: number, c: number) => number;
  readonly takes: (y: Yard, to: number, from: number) => boolean;
  readonly wants: (y: Yard, to: number, n: number) => boolean;
  readonly sendsOf: (y: Yard, i: number, n: number) => number;
  readonly accepts: (y: Yard, to: number, n: number, side: number, wire: Wire) => boolean;
  readonly wireOf: (y: Yard) => Wire;
}

/** How many ways out a piece is walked by: its ways out (a piece of more than one tile), its ways (a splitter's), or 0 for one that hands to one tile. */
export const waysAt = (y: Yard, i: number): number =>
  (y.part[i] === 0 ? 0 : outsOf(y, i).length) || (WAYS[y.kind[i] ?? NONE] ?? 0);

/** The plumbing as a walk reads it (`Plumbing`): by every way a piece hands by, or with `real`, by only those things can go (`realTo`). */
export function plumbingOf(r: Reads, y: Yard, real: boolean): Plumbing {
  return {
    tiles: y.kind.length,
    own: (t) => (t < 0 ? t : pieceOf(y, t)),
    ways: (i) => waysAt(y, i),
    to: (i, c) => {
      if (real) return realTo(r, y, i, c);
      const t = r.tileTo(y, i, c);
      return t < 0 ? t : pieceOf(y, t);
    },
    hands: (i) => (RULES[y.kind[i] ?? NONE]?.hands ?? null) !== null,
  };
}

/**
 * The rings in the yard's plumbing (`Rings`), by the ways things can go (`realTo`): looked for only
 * where the plumbing comes back round by every way, which most yards' never does. Worked out when first
 * asked and kept with the plumbing (`Wire.rings`) until it changes.
 */
export function ringsNow(r: Reads, y: Yard): Rings {
  const wire = r.wireOf(y);
  if (wire.rings) return wire.rings;
  const back = walk(plumbingOf(r, y, false)).rings.length > 0;
  const walked = back ? walk(plumbingOf(r, y, true)) : null;
  wire.rings = walked && walked.rings.length > 0 ? ringsFound(walked.order, walked.rings) : NO_RINGS;
  return wire.rings;
}

/**
 * The own tile of what a piece (its own tile `i`) can hand a thing to by its way out `c`, as it stands
 * now: one that takes from the side it comes from, or under the ground a tunnel's far mouth, and takes
 * something the piece may send that way (`mayGive`); -1 for none. So a shut crate hands nothing on; a
 * splitter nothing by a shut way; a sorter by its side only while it is set to a thing, and only to one
 * that takes it; a machine only to one that takes what it makes. Every setting that changes this works
 * the plumbing out again (`changed`).
 */
export function realTo(r: Reads, y: Yard, i: number, c: number): number {
  const t = r.tileTo(y, i, c);
  if (t < 0 || !goesTo(r, y, i, c, t)) return -1;
  for (const n of mayGive(r, y, i, c)) if (r.wants(y, t, n)) return pieceOf(y, t);
  return -1;
}

/**
 * The things a piece may hand on by its way out `c`, as it stands now: what carries, anything that goes
 * that way (`sendsOf`); one that takes anything (a crate), anything, while it is open; a grower, what it
 * grows; a gatherer, what lies under it; a machine, what its recipe makes, or with none set, what any it
 * may make makes; by a way out for some things only, those (`sendsThing`).
 */
function mayGive(r: Reads, y: Yard, i: number, c: number): readonly number[] {
  const k = y.kind[i] ?? NONE;
  if (CARRIES[k] === 1) return ALL_ITEMS.filter((n) => ((r.sendsOf(y, i, n) >> c) & 1) === 1);
  const h = holderOf(y, i);
  if (h >= 0 && y.holders.open[h] === 0) return [];
  const o = y.part[i] === 0 ? undefined : outsOf(y, i)[c];
  return made(r, y, i, k).filter((n) => !o || sendsThing(o, n));
}

/** What a piece that is not a line may hand on, by any way out (`mayGive`). */
function made(r: Reads, y: Yard, i: number, k: number): readonly number[] {
  if (RULES[k]?.wants === anything) return ALL_ITEMS;
  const grows = GROW_OF[k];
  if (grows) return [grows.gives];
  if (k === GATHERING) return [y.land.deposit[i] ?? NONE];
  const set = RECIPE[y.set[i] ?? NONE];
  const recipes = set ? [set] : (r.wireOf(y).recipes[k] ?? []);
  const outs = recipes.flatMap((rec) => [rec.out, rec.also]);
  return [...(MIX_OF[k]?.gives ?? []), ...outs].filter((n) => n !== NONE);
}

/** Whether a thing a piece (its own tile `i`) hands by its way `c` goes onto the tile `t`: taken from the tile it leaves by, or under the ground. */
function goesTo(r: Reads, y: Yard, i: number, c: number, t: number): boolean {
  if (mouth(y, i)) return farMouth(y, i) === t;
  return r.takes(y, t, giverTile(y, i, c));
}

/** Whether the piece on a tile is a tunnel's way-in mouth, which hands what it carries on under the ground. */
const mouth = (y: Yard, i: number): boolean => (y.span[i] ?? 0) > 0 && SPANS[y.kind[i] ?? NONE] === 1;

/** The tile a piece (its own tile `i`) hands from by its way out `c`: its way out's own tile, for a piece of more than one. */
function giverTile(y: Yard, i: number, c: number): number {
  const o = y.part[i] === 0 ? undefined : outsOf(y, i)[c];
  return o ? i + o.dx + o.dy * y.land.w : i;
}

/** What the piece on tile `i` would hand on by its way out `c` now: the thing on what carries, a holder's finished thing or by-product. */
export function heldFor(y: Yard, i: number, c: number): number {
  if (CARRIES[y.kind[i] ?? NONE] === 1) return y.item[i] ?? NONE;
  const o = y.part[i] === 0 ? undefined : outsOf(y, i)[c];
  return (o?.also ? y.holders.also : y.holders.out)[holderOf(y, i)] ?? NONE;
}

/** Whether the piece on tile `i` would send the thing `n` by its way out `c`: a sorter only the thing it is set to by its side, a way out for some things only those. */
export function sendsNow(r: Reads, y: Yard, i: number, c: number, n: number): boolean {
  if (n === NONE) return false;
  if ((WAYS[y.kind[i] ?? NONE] ?? 0) > 0) return ((r.sendsOf(y, i, n) >> c) & 1) === 1;
  const o = y.part[i] === 0 ? undefined : outsOf(y, i)[c];
  return !o || sendsThing(o, n);
}

/**
 * Whether the piece on tile `i` could hand what it holds by its way out `c` now (`heldFor`), if it
 * sends it that way (`sendsNow`), taken by the tile there from that side (`accepts`); a tunnel's way-in
 * mouth, while its first tile under the ground is empty.
 */
export function takesNow(r: Reads, y: Yard, i: number, c: number): boolean {
  const to = r.tileTo(y, i, c);
  if (to < 0) return false;
  if (mouth(y, i)) return y.tunnels.under[tunnelOf(y, i) * SPAN_MOST] === NONE;
  const n = heldFor(y, i, c);
  if (!sendsNow(r, y, i, c, n)) return false;
  const from = giverTile(y, i, c);
  for (let side = 0; side < 4; side++)
    if (toward(y.land, to, side) === from) return r.accepts(y, to, n, side, r.wireOf(y));
  return false;
}
