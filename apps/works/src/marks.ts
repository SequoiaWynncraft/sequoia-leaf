/**
 * Marks drawn over the yard where something is pointed at: corners that breathe round a box (a tile,
 * or a piece of more than one tile's whole box), a ring of pixels (a pylon's reach), and dashes that
 * march round an area marked.
 */
import type { Pen } from "@sequoia-leaf/kit/pix.ts";

import { TILE } from "./art/belts.ts";
import type { Box } from "./big.ts";
import { S } from "./state.ts";

/** A ring of pixels round (x, y), `rx` across and `ry` down, every `gap`th pixel, `a` solid. */
export function pixelRing(g: Pen, x: number, y: number, rx: number, ry: number, col: string, gap = 1, a = 1): void {
  const n = Math.max(8, Math.round((rx + ry) * 1.6));
  for (let i = 0; i < n; i += gap) {
    const at = (i / n) * Math.PI * 2;
    g.rect(Math.round(x + Math.cos(at) * rx), Math.round(y + Math.sin(at) * ry), 1, 1, col, a);
  }
}

/** Gold (or coral) corners round a box in the picture: it is being pointed at. */
export function corners(g: Pen, x: number, y: number, w: number, h: number, col: string, breathe: boolean): void {
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
    g.rect(dx > 0 ? px : px - 3, py, 4, 1, col);
    g.rect(px, dy > 0 ? py : py - 3, 1, 4, col);
  }
}

/** Corners that breathe round a box of tiles, `cx`, `cy` the view's corner: a piece in hand, or one aimed at with the spade. */
export const boxCorners = (g: Pen, b: Box, cx: number, cy: number, col: string): void =>
  corners(g, b.x * TILE - cx, b.y * TILE - cy, b.w * TILE, b.h * TILE, col, true);

/** Whether the dashes are on at a whole number of pixels along their way: three on, three off. */
const dashed = (at: number): boolean => ((at % 6) + 6) % 6 < 3;

/**
 * A line of dashes a pixel wide round a box of the picture, its corner pixels at (`x`, `y`) and
 * (`x + w`, `y + h`): three pixels on and three off, starting `march` pixels along from the top-left
 * corner and going round with the clock. A dash's ends lie on the middles of pixels, so each end
 * pixel is half as solid, as a canvas strokes a dashed line.
 */
export function dashes(g: Pen, x: number, y: number, w: number, h: number, col: string, march: number): void {
  const round = 2 * (w + h);
  for (let s = 0; s < round; s++) {
    // The half of the pixel before its middle, and the half after: the first pixel's first half is the line's end.
    const a = (dashed((s === 0 ? round : s) - 1 - march) ? 0.5 : 0) + (dashed(s - march) ? 0.5 : 0);
    if (a === 0) continue;
    if (s < w) g.rect(x + s, y, 1, 1, col, a);
    else if (s < w + h) g.rect(x + w, y + s - w, 1, 1, col, a);
    else if (s < 2 * w + h) g.rect(x + w - (s - w - h), y + h, 1, 1, col, a);
    else g.rect(x, y + h - (s - 2 * w - h), 1, 1, col, a);
  }
}
