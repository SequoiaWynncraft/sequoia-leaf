/**
 * Places on the guild's land as the tests name them: from the depot's middle, so many tiles east
 * (`dx`) and south (`dy`), below nothing west and north. The land grows by rings of plots round the
 * yard and the depot stays where it is among them, so a test that names its places this way is the
 * same test on any size of land. A test on a land of its own (`land.ts`) names its own tiles.
 */
import * as F from "../src/index.ts";

/** A place from the depot, as a command names one: `{ x, y }`. */
export const near = (dx: number, dy: number): { x: number; y: number } => ({
  x: F.LAND.depot[0] + dx,
  y: F.LAND.depot[1] + dy,
});

/** A place from the depot as a pair, `[x, y]`. */
export const xy = (dx: number, dy: number): [number, number] => [F.LAND.depot[0] + dx, F.LAND.depot[1] + dy];

/** The tile of a place from the depot. */
export const tileNear = (dx: number, dy: number): number => (F.LAND.depot[1] + dy) * F.LAND.w + F.LAND.depot[0] + dx;
