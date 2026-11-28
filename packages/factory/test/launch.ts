/**
 * Tier 8's yards for the tests (`thelaunch.test.ts`, `parity.test.ts`): bare land with tier 8's
 * research known or not, pieces set down by commands off the wire, and pylons over every tile left
 * free, so that what stands has power. A test drops charged cells onto the first tile of a belt as a
 * crate of them would hand them on (`drop`), so that they come into a pad exactly so old.
 */
import * as F from "../src/index.ts";
import { learn } from "./goals.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

export type At = readonly [number, number];

export const CELL = F.item("cell");
export const ONE = F.item("charged1");
export const TWO = F.item("charged2");
export const THREE = F.item("charged3");
export const HULL = F.item("hull");
export const FUEL = F.item("fuel");
export const PAD = F.kind("launchpad");
export const CHARGER = F.kind("charger");

/** A bare yard `w` by `h`, the depot's middle at `depot`, with every goal below `tier` done: 9 knows all of tier 8, 8 none of it. */
export function bareYard(w: number, h: number, depot: At, tier = 9, seed = 1): F.Yard {
  return F.create({ land: bareLand(w, h, [], depot), tier, seed });
}

/** A bare yard at tier 8's opening with the given research learned (and what each needs), and the nodes before the commission done but those named. */
export function tier8Yard(w: number, h: number, depot: At, research: readonly string[], seed = 1): F.Yard {
  const y = bareYard(w, h, depot, 8, seed);
  for (const id of research) learn(y, F.goal(id));
  return y;
}

/** Sets a piece down, with its own tile on `at` (a big piece's middle, or its middle's top left), at a grade where it has one. */
export function put(y: F.Yard, kind: F.KindName, at: At, dir: number, grade = 1): number {
  const graded = F.isGraded(F.kind(kind)) && grade > 1;
  must(y, { do: "build", kind, x: at[0], y: at[1], dir, ...(graded ? { grade } : {}) });
  return F.at(y, at[0], at[1]);
}

/** A straight run of belt from a tile, `count` tiles toward `dir`, at a grade. */
export function run(y: F.Yard, from: At, dir: number, count: number, grade = 3): void {
  const [dx, dy] = [F.DX[dir] ?? 0, F.DY[dir] ?? 0];
  for (let k = 0; k < count; k++) put(y, "belt", [from[0] + dx * k, from[1] + dy * k], dir, grade);
}

/** Puts `count` of a thing into the holder of the piece on a tile, as a line would have handed them in. */
export function fill(y: F.Yard, i: number, n: F.Item, count: number): void {
  const r = F.holderOf(y, i);
  for (let k = 0; k < count; k++) F.put(y.holders, r, n);
}

/** A crate on a tile handing on toward `dir`, holding `count` of a thing; shut with `shut`. Its tile. */
export function crate(y: F.Yard, at: At, dir: number, n: F.Item, count: number, shut = false): number {
  const i = put(y, "crate", at, dir);
  if (shut) must(y, { do: "crate", x: at[0], y: at[1], open: false });
  fill(y, i, n, count);
  return i;
}

/** Pylons on every fifth tile across and down where nothing stands, each within reach of the next. */
export function pylons(y: F.Yard): void {
  const { w, h } = y.land;
  for (let z = 1; z < h; z += 4)
    for (let x = 1; x < w; x += 4) if (y.kind[F.at(y, x, z)] === F.NONE) F.build(y, F.PYLON, x, z, 0, Infinity);
}

/** Drops a charged cell with 3 bars onto a belt's tile where none is, as a crate would hand one on: a door fed as fast as its belt carries. */
export function drop(y: F.Yard, i: number): void {
  if (y.item[i] !== F.NONE) return;
  y.item[i] = THREE;
  y.prog[i] = 0;
  y.via[i] = 0;
}

/** How many of each thing the holder on a tile holds, for those named. */
export const holding = (y: F.Yard, i: number, things: readonly F.Item[]): number[] =>
  things.map((n) => F.held(y.holders, F.holderOf(y, i), n));

/** The charged cells the holder on a tile holds, of every bars. */
export const chargedIn = (y: F.Yard, i: number): number =>
  F.CHARGED.bars.reduce((sum, b) => sum + F.held(y.holders, F.holderOf(y, i), b), 0);

/** Runs a yard on to a tick. */
export function until(y: F.Yard, tick: number): void {
  while (y.tick < tick) F.step(y);
}
