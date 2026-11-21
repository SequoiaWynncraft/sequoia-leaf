/**
 * The floor of a camp's clearing, painted a pixel at a time like the town's: grass with drifts
 * lying across it, shade under the trees that ring it, the far hedge, and earth trodden bare where
 * people walk (in off the trail, round the fire, up to the cabin door). The trodden earth follows
 * where things stand, so it is painted again when they are moved.
 */

import { EARTH, GREEN, STONE } from "@sequoia-leaf/kit/palette.ts";
import { paint } from "@sequoia-leaf/kit/pix.ts";
import { clamp, hash, type Pt, vnoise } from "@sequoia-leaf/kit/util.ts";

import { CGH, CGW, TRAIL, YARD } from "./camp.ts";
import { CELL } from "./grid.ts";

/** The clearing, in art pixels. */
export const CW = CGW * CELL;
export const CH = CGH * CELL;

/** Where the floor's picture sits in the world. */
export const CAMP_GROUND = { x: -72, y: 48, w: CW + 144, h: CH + 24 };

/** The middle of the trail, as it comes in from the east. */
export const TRAIL_Y = ((TRAIL.y0 + TRAIL.y1 + 1) * CELL) / 2;
/** Where somebody on the trail is out of sight among the trees, and where they stand once they are in. */
export const TRAIL_END: Pt = { x: CW + 14, y: TRAIL_Y + 2 };
export const TRAIL_IN: Pt = { x: (TRAIL.x0 + 1) * CELL, y: TRAIL_Y + 2 };

const DEEP = ["#141f1c", "#19291f", "#1e3324"] as const;
const at = (ramp: readonly string[], i: number): string => ramp[clamp(Math.round(i), 0, ramp.length - 1)] ?? "#000000";

/** A stretch of trodden earth: from one point to another, and half its width. */
export type Trodden = readonly [number, number, number, number, number];

function segD(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / len, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

/** How far outside trodden earth a point is (negative: on it), with a ragged edge. */
export function troddenD(paths: readonly Trodden[], x: number, y: number): number {
  let d = 999;
  for (const [x1, y1, x2, y2, hw] of paths) d = Math.min(d, segD(x, y, x1, y1, x2, y2) - hw);
  return d + (vnoise(x / 9, y / 9, 5) - 0.5) * 7;
}

/**
 * The earth a camp's comings and goings have worn: in off the trail to the fire, a ring round it,
 * and on to the cabin's door. `fire` and `door` are where those are, if the camp has them out.
 */
export function wornPaths(fire: Pt | null, door: Pt | null): Trodden[] {
  const paths: Trodden[] = [[CW + 40, TRAIL_Y, TRAIL_IN.x - 10, TRAIL_Y, 8]];
  const hub = fire ?? { x: CW / 2, y: TRAIL_Y };
  paths.push([TRAIL_IN.x - 10, TRAIL_Y, hub.x, hub.y, 6]);
  if (fire) paths.push([fire.x, fire.y, fire.x, fire.y, 30]);
  if (door) paths.push([hub.x, hub.y, door.x, door.y + 4, 5], [door.x, door.y + 2, door.x, door.y + 2, 9]);
  return paths;
}

/** Where the far hedge tops out; a camp's own number gives it a line of its own. */
export function campHedge(x: number, seed: number): number {
  return Math.round(58 + vnoise(x / 13, 0, 21 + seed) * 7 + vnoise(x / 5, 3, 22 + seed) * 3);
}

const YARD_X0 = YARD.x0 * CELL;
const YARD_X1 = (YARD.x1 + 1) * CELL;
const YARD_Y0 = YARD.y0 * CELL;
const YARD_Y1 = (YARD.y1 + 1) * CELL;

export function paintCampGround(seed: number, paths: readonly Trodden[]): HTMLCanvasElement {
  return paint(CAMP_GROUND.w, CAMP_GROUND.h, (px, py) => {
    const x = px + CAMP_GROUND.x;
    const y = py + CAMP_GROUND.y;
    const top = campHedge(x, seed);
    if (y < top) return null;
    if (y < top + 5) return at(DEEP, (y - top) / 3 + hash(x >> 1, y, 71) * 0.8);

    const td = troddenD(paths, x, y);
    // Beyond the clearing it is deep forest floor, but for the trail going off between the trees.
    if (x < 0 || x >= CW || y > CH + 10) {
      if (td < 0 && x >= CW) {
        const gone = (x - CW) / 46 + hash(x, y, 73) * 0.35;
        return gone > 1 ? DEEP[1] : gone > 0.55 ? "#3a2a22" : EARTH[0];
      }
      return at(DEEP, vnoise(x / 12, y / 9, 72 + seed) * 2.4);
    }
    if (td < 0) {
      if (td > -2.2) return EARTH[0];
      if (hash(x >> 1, y, 43) > 0.994) return STONE[1];
      if (hash(x, y >> 1, 44) > 0.985) return EARTH[0];
      return vnoise(x / 15, y / 8, 41 + seed) > 0.62 ? EARTH[2] : EARTH[1];
    }

    // Grass: one green, with lighter and darker drifts lying across it, and shade under the trees
    // that ring the clearing.
    const n = vnoise(x / 34, y / 13, 3 + seed);
    let idx = n > 0.7 ? 3 : n < 0.27 ? 1 : 2;
    const edge = Math.min(x - YARD_X0 + 10, YARD_X1 + 10 - x, (y - YARD_Y0 + 16) * 1.4, (YARD_Y1 + 12 - y) * 1.2);
    if (edge < 6 + vnoise(x / 26, y / 20, 8 + seed) * 40) idx -= 1;
    if (td < 1.6) idx -= 1;
    idx = clamp(idx, 0, 3);
    const gx = Math.floor(x / 13);
    const gy = Math.floor(y / 9);
    if (hash(gx, gy, 31 + seed) > 0.62) {
      const dx = x - (gx * 13 + 1 + Math.floor(hash(gx, gy, 32) * 9));
      const dy = y - (gy * 9 + 3 + Math.floor(hash(gx, gy, 33) * 5));
      if ((dx === 0 && dy === 0) || (dx === 2 && dy === 0)) return at(GREEN, idx - 1);
      if (dx === 1 && dy === -1) return at(GREEN, idx + 1);
    }
    return at(GREEN, idx);
  });
}
