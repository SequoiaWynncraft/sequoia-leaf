/**
 * What the piece on a tile says of the things it carries, as the picture draws them: which way it
 * faces, the side a thing came in by, and whether a thing is under a tunnel's hood.
 */
import { BACK, type Dir, TUNNEL, type Yard } from "@sequoia-leaf/factory";

/** The way the piece on a tile faces. */
export const dirAt = (y: Yard, i: number): Dir => {
  const d = y.dir[i] ?? 0;
  return d === 1 ? 1 : d === 2 ? 2 : d === 3 ? 3 : 0;
};

/** The side a thing on a tile came in by: the side it was handed over on, else the tile's back. */
export const cameFrom = (y: Yard, i: number): number => {
  const via = y.via[i] ?? 0;
  return via > 0 ? (via - 1) & 3 : (BACK[dirAt(y, i)] ?? 2);
};

/**
 * Whether a thing on a tunnel's mouth, so far across its tile (`prog`), is under the mouth's hood:
 * the half of the tile toward the other mouth, where it goes in or comes up. Drawn there, it would
 * show past the hood, between the mouths.
 */
export const hooded = (y: Yard, i: number, prog: number): boolean =>
  y.kind[i] === TUNNEL && ((y.span[i] ?? 0) > 0 ? prog > 0.5 : prog < 0.5);
