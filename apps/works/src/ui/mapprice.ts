/**
 * A price on the map (`views.ts`): a small coin and the price written beside it, centred on its
 * plot, as far as the map's edges let it be.
 */
import { CREAM, GOLD, INK } from "@sequoia-leaf/kit/palette.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";

/** A small coin and a price, centred on a point of the map as far as the map's edges let it be. */
/**
 * Where a price's coin goes, for a price `wide` pixels written centred on `cx` of a map `mapW` wide:
 * within the map, its coin's dark edge a pixel to the left and the writing's a pixel to the right.
 */
export function labelLeft(cx: number, wide: number, mapW: number): number {
  return Math.max(1, Math.min(Math.round(cx - (wide + 7) / 2), mapW - wide - 8));
}

export function price(g: CanvasRenderingContext2D, text: string, cx: number, cy: number): void {
  const w = widthOf(g, text, 1);
  const left = labelLeft(cx, w, g.canvas.width);
  const top = Math.round(cy - 4);
  g.fillStyle = INK;
  g.fillRect(left - 1, top + 1, 7, 7);
  g.fillStyle = GOLD[1];
  g.fillRect(left + 1, top + 2, 3, 5);
  g.fillRect(left, top + 3, 5, 3);
  g.fillStyle = CREAM;
  g.fillRect(left + 1, top + 3, 1, 1);
  write(g, text, left + 7, top, { px: 1, colour: GOLD[2], edge: INK });
}
