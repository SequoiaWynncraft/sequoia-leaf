/**
 * What a figure holds, on the table: a row of small boxes, up to three in the order held, each the
 * item's own picture (`heldPic`), each box sharing its ink edge with the next. Three are 19 wide, a
 * pixel short of a hex, so a row never reaches a neighbour's on the same row; it is drawn with its
 * figure, so a nearer figure stands in front of it rather than under it.
 */
import type { RackItem } from "@sequoia-leaf/raid";

import { HELD_BOX, heldPic } from "./art/icons.ts";

/** One picture's place, measured from the board's corner. */
export interface HeldAt {
  item: RackItem;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far one box is from the next: they share an edge. */
const STEP = HELD_BOX - 1;
/** How many boxes a row shows at most. */
const MOST = 3;

/** How wide a row holding `n` items is, edges and all. */
export const heldWide = (n: number): number => (n > 0 ? STEP * Math.min(n, MOST) + 1 : 0);

/** Where each held item's box goes, for a row whose top edge is at `top` and left edge at `left`. */
export function heldFrom(items: readonly RackItem[], left: number, top: number): HeldAt[] {
  const x = Math.round(left);
  const y = Math.round(top);
  return items.slice(0, MOST).map((item, i) => ({ item, x: x + i * STEP, y, w: HELD_BOX, h: HELD_BOX }));
}

/** Where each held item's box goes, for a row whose top edge is at `top`, centred on `x`. */
export const heldRow = (items: readonly RackItem[], x: number, top: number): HeldAt[] =>
  heldFrom(items, Math.round(x - heldWide(items.length) / 2), top);

/** Draws a figure's row, offset by the board's corner: each box on its own dark ground, so it reads on any ground. */
export function drawHeld(g: CanvasRenderingContext2D, row: readonly HeldAt[], ox: number, oy: number): void {
  for (const at of row) g.drawImage(heldPic(at.item), ox + at.x, oy + at.y);
}

/** The picture in a row under a point, if any. */
export function heldAt(row: readonly HeldAt[], x: number, y: number): HeldAt | null {
  for (let i = row.length - 1; i >= 0; i--) {
    const at = row[i];
    if (at && x >= at.x && x < at.x + at.w && y >= at.y && y < at.y + at.h) return at;
  }
  return null;
}

/** Where the row's top goes under a figure standing with its feet at `y`: under the base, or under the health bar in a fight. */
export const heldTop = (y: number, fighting: boolean): number => y + (fighting ? 8 : 2);
