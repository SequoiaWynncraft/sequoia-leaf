/**
 * Belts. A belt tile is a wooden bed of slats between two rails, made of arms: one from the middle
 * of the tile out to each side it joins. Slats march along every arm the way things travel on it,
 * and a chevron rides the main run, so a belt says which way it goes even when it is empty. Each
 * tile is drawn once for every step of the march and kept.
 */

import { BARK, GOLD, INK, STONE } from "@sequoia-leaf/kit/palette.ts";
import { paint } from "@sequoia-leaf/kit/pix.ts";

import type { Dir } from "../sim/index.ts";

export const TILE = 16;
/** How many steps the march has before it comes round: a chevron every tile, a slat every four pixels. */
export const STEPS = 16;

/** For each side of a tile (east, south, west, north): no arm, an arm things come in along, or one they leave by. */
export type Arm = 0 | 1 | 2;
export type Arms = readonly [Arm, Arm, Arm, Arm];

interface Wood {
  bed: string;
  slat: string;
  mark: string;
  rail: string;
  railLit: string;
}
/** Plain slats, waxed slats, and steel rollers: what the belt plans leave on the ground. */
const WOODS: readonly Wood[] = [
  { bed: BARK[0], slat: BARK[1], mark: BARK[3], rail: BARK[2], railLit: BARK[3] },
  { bed: BARK[0], slat: BARK[2], mark: GOLD[0], rail: BARK[3], railLit: BARK[4] },
  { bed: "#33303a", slat: STONE[1], mark: GOLD[1], rail: BARK[3], railLit: GOLD[0] },
];

const HALF = 5;

/** How far along its own run a pixel is, counted the way things travel there. */
const along = (x: number, y: number, way: number): number =>
  way === 0 ? x : way === 1 ? y : way === 2 ? 15 - x : 15 - y;
/** How far a point `k` of the way out to a side is from the middle of the tile, across and down. */
const edge = (side: number, k: number): number => (side === 0 ? 8 * k : side === 2 ? -8 * k : 0);
const edgeY = (side: number, k: number): number => (side === 1 ? 8 * k : side === 3 ? -8 * k : 0);
const cache = new Map<number, HTMLCanvasElement>();

/**
 * A belt tile. `main` is the way the middle of the tile carries things; `step` is how far the
 * march has come, 0 to 15; `tier` is 0, 1 or 2 for plain, waxed and roller belts.
 */
export function beltTile(arms: Arms, main: Dir, step: number, tier: number): HTMLCanvasElement {
  const key = ((((arms[0] * 3 + arms[1]) * 3 + arms[2]) * 3 + arms[3]) * 4 + main) * STEPS * 3 + step * 3 + tier;
  const had = cache.get(key);
  if (had) return had;
  const wood = WOODS[tier] ?? WOODS[0];
  if (!wood) throw new Error("no belt wood");
  // Which arm, if any, a pixel's bed belongs to: 0 to 3 for a side, 4 for the middle, -1 for none.
  const part = (x: number, y: number): number => {
    const u = x - 7.5;
    const v = y - 7.5;
    if (Math.abs(u) <= HALF && Math.abs(v) <= HALF) return 4;
    if (Math.abs(v) <= HALF) return u > 0 ? (arms[0] ? 0 : -1) : arms[2] ? 2 : -1;
    if (Math.abs(u) <= HALF) return v > 0 ? (arms[1] ? 1 : -1) : arms[3] ? 3 : -1;
    return -1;
  };
  const bed = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < TILE && y < TILE && part(x, y) >= 0;
  const near = (x: number, y: number, r: number): boolean => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (bed(x + dx, y + dy)) return true;
    return false;
  };
  const tile = paint(TILE, TILE, (x, y) => {
    const p = part(x, y);
    if (p < 0) {
      if (near(x, y, 1)) return x + y < 15 ? wood.railLit : wood.rail;
      return near(x, y, 2) ? INK : null;
    }
    // An arm that things come in along runs the other way from the side it is on.
    const way = p === 4 ? main : arms[p] === 1 ? (p + 2) % 4 : p;
    const s = along(x, y, way);
    if (p === 4 || way === main) {
      // The chevron: a small arrowhead, one to a tile, pointing the way of the run.
      const across = Math.abs((way === 0 || way === 2 ? y : x) - 7.5);
      const k = (((s - step) % STEPS) + STEPS) % STEPS;
      if (across < 3 && (k === 2 - Math.floor(across) || (across < 1 && k === 3))) return wood.mark;
    }
    return (((s - step) % 4) + 4) % 4 === 0 ? wood.slat : wood.bed;
  });
  cache.set(key, tile);
  return tile;
}

/** Where on a tile a carried thing is, in the tile's own pixels: in from one side to the middle, then out by another. */
export function ride(from: number, to: number, prog: number): readonly [number, number] {
  const p = prog < 0 ? 0 : prog > 1 ? 1 : prog;
  if (p < 0.5) {
    const k = 1 - p * 2;
    return [8 + edge(from, k), 8 + edgeY(from, k)];
  }
  const k = (p - 0.5) * 2;
  return [8 + edge(to, k), 8 + edgeY(to, k)];
}
