/**
 * The tiles about a piece: the four ways, the tile ahead of a piece, behind it and to its sides by the
 * way it faces, a tunnel's other mouth, and whether anything may stand on a tile at all (`ground`).
 */
import { tileAt, toward } from "./land.ts";
import { NONE } from "./tables.ts";
import { redwoodAt, type Yard } from "./yard.ts";

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
/** How far round from the way a piece faces each of its ways out is, in quarter turns right: ahead, left, right. */
export const WAY_TURN = [0, 3, 1] as const;

/** The tile at (x, y) of a yard's land, or -1. */
export const at = (y: Yard, x: number, z: number): number => tileAt(y.land, x, z);
/** What stands at (x, y), or `NONE`. */
export function kindAt(y: Yard, x: number, z: number): number {
  const i = at(y, x, z);
  return i < 0 ? NONE : (y.kind[i] ?? NONE);
}

/** Why nothing can stand on a tile, whatever it is: off the map, not the yard's land, water, or a redwood. */
export function ground(y: Yard, x: number, z: number): string | null {
  const i = at(y, x, z);
  if (i < 0) return "That is off the map";
  const plot = y.land.plots[y.land.plot[i] ?? NONE];
  if (!plot || !y.plots.includes(plot.plot)) return plot ? `${plot.name} is not the yard's yet` : "That is off the map";
  if (y.land.water[i] === 1) return "Nothing can be built on the stream";
  if (redwoodAt(y, i)) return "Nothing can be built on a tree";
  return null;
}

/** The tile ahead of a piece, behind it, and to its left and right; -1 off the map. */
export const ahead = (y: Yard, i: number): number => toward(y.land, i, y.dir[i] ?? 0);
export const behind = (y: Yard, i: number): number => toward(y.land, i, (y.dir[i] ?? 0) + 2);
export const leftOf = (y: Yard, i: number): number => toward(y.land, i, (y.dir[i] ?? 0) + 3);
export const rightOf = (y: Yard, i: number): number => toward(y.land, i, (y.dir[i] ?? 0) + 1);
/** The tile a piece's way out leads to (0 ahead, 1 left, 2 right), whether or not anything goes that way; -1 off the map. */
export const wayTo = (y: Yard, i: number, way: number): number =>
  way === 0 ? ahead(y, i) : way === 1 ? leftOf(y, i) : rightOf(y, i);
/** A joiner's way in (0 behind, 1 left, 2 right), or -1 off the map. */
export const wayIn = (y: Yard, i: number, way: number): number =>
  way === 0 ? behind(y, i) : way === 1 ? leftOf(y, i) : rightOf(y, i);

/** The far mouth of a tunnel's way-in mouth, `span + 1` tiles ahead; -1 off the map. */
export function farMouth(y: Yard, i: number): number {
  const { w, h } = y.land;
  const d = y.dir[i] ?? 0;
  const s = (y.span[i] ?? 0) + 1;
  const x = (i % w) + (d === 0 ? s : d === 2 ? -s : 0);
  const z = Math.floor(i / w) + (d === 1 ? s : d === 3 ? -s : 0);
  return x < 0 || z < 0 || x >= w || z >= h ? -1 : z * w + x;
}

/** The other mouth of the tunnel on a tile, or -1. */
export function otherMouth(y: Yard, i: number): number {
  const span = y.span[i] ?? 0;
  const d = y.dir[i] ?? 0;
  const far = (Math.abs(span) + 1) * Math.sign(span);
  const { w } = y.land;
  return span === 0 ? -1 : at(y, (i % w) + (DX[d & 3] ?? 0) * far, Math.floor(i / w) + (DY[d & 3] ?? 0) * far);
}

/**
 * A splitter's ways as one byte, as a blueprint and a kept yard hold them: its shut ways a bit each,
 * 8 times what it puts first (1 + the way, or 0 for none), and 32 times its ways in, a bit each. A
 * sorter's side is kept as the way put first.
 */
export const packWays = (shut: number, first: number, ins = 0): number => shut | (first << 3) | (ins << 5);
/** A splitter's ways read back from their byte, as `keptOf` reads them: the shut ways, the way put first or -1, and the ways in. */
export const unpackWays = (b: number): { shut: number; first: number; ins: number } => ({
  shut: b & 7,
  first: ((b >> 3) & 3) - 1,
  ins: b >> 5,
});
