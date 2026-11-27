/**
 * What a figure holds, on the table: a row of small pictures centred under its base, up to three
 * in the order held. Each is the item at half size, a finished one with a gold edge. The row is as
 * narrow as a hex at most, so it never reaches a neighbour on the same row; it is drawn with its
 * figure, so a nearer figure stands in front of it rather than under it.
 */
import { INK } from "@sequoia-leaf/kit/palette.ts";
import type { RackItem } from "@sequoia-leaf/raid";

import { heldPic } from "./art/icons.ts";

/** One picture's place, measured from the board's corner. */
export interface HeldAt {
  item: RackItem;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far the pictures overlap their neighbours' edges, by how many there are: three share their edges. */
const OVERLAP = [0, 0, 0, 1] as const;

/** Where each held item's picture goes, for a row whose top edge is at `top`, centred on `x`. */
export function heldRow(items: readonly RackItem[], x: number, top: number): HeldAt[] {
  const shown = items.slice(0, 3);
  if (shown.length === 0) return [];
  const pics = shown.map((item) => heldPic(item));
  const step = (pics[0]?.width ?? 7) - (OVERLAP[shown.length] ?? 0);
  const width = step * (shown.length - 1) + (pics[0]?.width ?? 7);
  const left = Math.round(x - width / 2);
  return shown.map((item, i) => {
    const pic = pics[i];
    return { item, x: left + i * step, y: Math.round(top), w: pic?.width ?? 7, h: pic?.height ?? 7 };
  });
}

/**
 * Draws a figure's row, offset by the board's corner: each picture on a small dark tile, so the gold
 * edge of a finished item reads on the pale hexes as well as the dark bench.
 */
export function drawHeld(g: CanvasRenderingContext2D, row: readonly HeldAt[], ox: number, oy: number): void {
  const alpha = g.globalAlpha;
  for (const at of row) {
    g.globalAlpha = alpha * 0.8;
    g.fillStyle = INK;
    g.fillRect(ox + at.x + 1, oy + at.y + 1, at.w - 2, at.h - 2);
    g.globalAlpha = alpha;
    g.drawImage(heldPic(at.item), ox + at.x, oy + at.y);
  }
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
