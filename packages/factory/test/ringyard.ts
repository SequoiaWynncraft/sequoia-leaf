/**
 * Yards with rings of belts, for the tests of rings (`beltrings.test.ts`, `parity.test.ts`): a bare
 * yard, a ring round a box, and a drain off it.
 */
import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

export const PLANK = F.item("plank");

/** A bare yard with tier 7 done, the depot far to the east. */
export const bare = (): F.Yard => F.create({ land: bareLand(40, 30, [], [35, 5]), tier: 8, seed: 1 });

/** A ring of belts round a box `w` by `h` with its corner at (x0, z0), clockwise from that corner: its tiles in order. */
export function ring(y: F.Yard, x0: number, z0: number, w: number, h: number, grade = 1): number[] {
  const tiles: number[] = [];
  const lay = (x: number, z: number, dir: number): void => {
    must(y, { do: "build", kind: "belt", x, y: z, dir, ...(grade > 1 ? { grade } : {}) });
    tiles.push(F.at(y, x, z));
  };
  for (let x = x0; x < x0 + w - 1; x++) lay(x, z0, 0);
  for (let z = z0; z < z0 + h - 1; z++) lay(x0 + w - 1, z, 1);
  for (let x = x0 + w - 1; x > x0; x--) lay(x, z0 + h - 1, 2);
  for (let z = z0 + h - 1; z > z0; z--) lay(x0, z, 3);
  return tiles;
}

/** Ways east, south, west and north, as tiles across and down. */
export const DX = [1, 0, -1, 0];
export const DZ = [0, 1, 0, -1];

/**
 * A splitter at (x, z), facing `dir`, that sends what it can to its left first, onto a belt into a
 * shut crate: the crate's row, which counts what the drain took.
 */
export function drain(y: F.Yard, x: number, z: number, dir: number, grade = 1): number {
  const left = (dir + 3) & 3;
  const [bx, bz] = [x + (DX[left] ?? 0), z + (DZ[left] ?? 0)];
  const [cx, cz] = [bx + (DX[left] ?? 0), bz + (DZ[left] ?? 0)];
  must(y, { do: "build", kind: "splitter", x, y: z, dir, grade });
  must(y, { do: "build", kind: "belt", x: bx, y: bz, dir: left, grade });
  must(y, { do: "build", kind: "crate", x: cx, y: cz, dir: left });
  must(y, { do: "crate", x: cx, y: cz, open: false });
  must(y, { do: "first", x, y: z, way: 1 });
  return F.holderOf(y, F.at(y, cx, cz));
}

/** Puts `n` planks into the crate on a tile. */
export function stock(y: F.Yard, i: number, n: number): void {
  for (let k = 0; k < n; k++) F.put(y.holders, F.holderOf(y, i), PLANK);
}

/** How many planks the drain's crate (its row) has taken between second `from` and second `to`. */
export function drained(y: F.Yard, bin: number, from: number, to: number): number {
  while (y.tick < from * 10) F.step(y);
  const was = F.held(y.holders, bin, PLANK);
  while (y.tick < to * 10) F.step(y);
  return F.held(y.holders, bin, PLANK) - was;
}

/** Puts a plank on every tile, at the end of its tile, as a ring that has filled stands. */
export function fill(y: F.Yard, tiles: readonly number[]): void {
  for (const i of tiles) {
    y.item[i] = PLANK;
    y.prog[i] = 8;
  }
  F.changed(y);
}
