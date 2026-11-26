/**
 * The piece whose card is pinned, marked on the yard: every tile it covers (both mouths of a tunnel)
 * in the pointer's gold brackets, held steady and edged in ink, so that it can be found in a crowded
 * yard. For a moment after the view is brought to it (a walk of the Trouble list, a tap on the map:
 * `S.brought`), the brackets close in on it from further out.
 */

import { DEPOT, otherMouth, type Yard } from "@sequoia-leaf/factory";
import { GOLD, INK } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import type { Ctx } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./art/belts.ts";
import { S } from "./state.ts";

/** The tiles of the piece whose card is pinned: its own, and a tunnel's other mouth. None with no card pinned. */
export function pinnedTiles(): number[] {
  const i = S.picked;
  const far = i < 0 ? -1 : otherMouth(S.world, i);
  return i < 0 ? [] : far >= 0 ? [i, far] : [i];
}

/** Seconds each of the two times the brackets close in. */
const CLOSING = 0.45;
/**
 * How far out from its box the mark on the piece whose card is pinned stands, in the yard's pixels:
 * after the view is brought to that piece, it closes in from 6 out, twice; else 0.
 */
export function pinPulse(): number {
  const b = S.brought;
  const n = b !== null && pinnedTiles().includes(b.tile) ? (S.t - b.at) / CLOSING : 2;
  return n >= 0 && n < 2 ? Math.round(6 * (1 - (n % 1)) ** 2) : 0;
}

/**
 * The brackets round a box in the picture (a tile, or the depot's): gold, edged in ink, `t` pixels
 * thick (more when the view is zoomed far out, as the trouble marks grow), and `pinPulse` further out.
 */
function pinBox(g: Ctx, x: number, y: number, w: number, h: number, t: number): void {
  const out = pinPulse() * t;
  const arm = 4 * t;
  const x0 = x - 1 - out;
  const y0 = y - 1 - out;
  const x1 = x + w + out;
  const y1 = y + h + out;
  for (const [col, e] of [
    [INK, 1],
    [GOLD[2], 0],
  ] as const)
    for (const [px, py, dx, dy] of [
      [x0, y0, 1, 1],
      [x1, y0, -1, 1],
      [x0, y1, 1, -1],
      [x1, y1, -1, -1],
    ] as const) {
      R(g, (dx > 0 ? px : px - arm + 1) - e, (dy > 0 ? py : py - t + 1) - e, arm + 2 * e, t + 2 * e, col);
      R(g, (dx > 0 ? px : px - t + 1) - e, (dy > 0 ? py : py - arm + 1) - e, t + 2 * e, arm + 2 * e, col);
    }
}

/** The mark near: brackets round each tile of the piece, or the depot's box (its corner at `dx`, `dy`), `t` pixels thick. */
export function pinMark(g: Ctx, w: Yard, cx: number, cy: number, dx: number, dy: number, t: number): void {
  for (const i of pinnedTiles()) {
    if (w.kind[i] === DEPOT) pinBox(g, dx, dy, 48, 48, t);
    else pinBox(g, (i % w.land.w) * TILE - cx, Math.floor(i / w.land.w) * TILE - cy, TILE, TILE, t);
  }
}
