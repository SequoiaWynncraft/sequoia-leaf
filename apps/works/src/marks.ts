/**
 * Marks drawn over the yard where something is pointed at: corners that breathe round a box (a tile,
 * or a piece of more than one tile's whole box), and a ring of pixels (a pylon's reach).
 */
import { R } from "@sequoia-leaf/kit/pix.ts";
import type { Ctx } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./art/belts.ts";
import type { Box } from "./big.ts";
import { S } from "./state.ts";

/** A ring of pixels round (x, y), `rx` across and `ry` down, every `gap`th pixel. */
export function pixelRing(g: Ctx, x: number, y: number, rx: number, ry: number, col: string, gap = 1): void {
  const n = Math.max(8, Math.round((rx + ry) * 1.6));
  g.fillStyle = col;
  for (let i = 0; i < n; i += gap) {
    const a = (i / n) * Math.PI * 2;
    g.fillRect(Math.round(x + Math.cos(a) * rx), Math.round(y + Math.sin(a) * ry), 1, 1);
  }
}

/** Gold (or coral) corners round a box in the picture: it is being pointed at. */
export function corners(g: Ctx, x: number, y: number, w: number, h: number, col: string, breathe: boolean): void {
  const k = breathe && Math.sin(S.t * 6) > 0 ? 1 : 0;
  const x0 = x - 1 + k;
  const y0 = y - 1 + k;
  const x1 = x + w - k;
  const y1 = y + h - k;
  for (const [px, py, dx, dy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ] as const) {
    R(g, dx > 0 ? px : px - 3, py, 4, 1, col);
    R(g, px, dy > 0 ? py : py - 3, 1, 4, col);
  }
}

/** Corners that breathe round a box of tiles, `cx`, `cy` the view's corner: a piece in hand, or one aimed at with the spade. */
export const boxCorners = (g: Ctx, b: Box, cx: number, cy: number, col: string): void =>
  corners(g, b.x * TILE - cx, b.y * TILE - cy, b.w * TILE, b.h * TILE, col, true);
