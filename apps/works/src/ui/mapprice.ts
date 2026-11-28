/**
 * A price on the map (`views.ts`): on every plot for sale that touches the yard's land, a small coin
 * and the price written beside it, centred on its plot, as far as the map's edges let it be; in gold
 * where the plot can be bought now, and in stone where it must be cleared first.
 */
import { plotPrice, plotState, readyToBuy, type Yard } from "@sequoia-leaf/factory";
import { CREAM, GOLD, INK, STONE } from "@sequoia-leaf/kit/palette.ts";
import { whole } from "@sequoia-leaf/kit/say.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";

/** A plot for sale as the map writes it: its price now, the middle of it, whether it is in an odd column of plots, and whether it can be bought now. */
export interface Sale {
  readonly price: string;
  readonly x: number;
  readonly y: number;
  readonly odd: boolean;
  readonly ready: boolean;
}

/** Every plot for sale that touches the yard's land, on a map of `scale` pixels to a tile: ready where it is cleared, or needs no clearing. */
export const salesOf = (y: Yard, scale: number): Sale[] =>
  y.land.plots.flatMap((plot) =>
    plotState(y, plot.plot).state === "for sale"
      ? [
          {
            price: whole(plotPrice(y, plot.plot)),
            x: (plot.x + plot.w / 2) * scale,
            y: (plot.y + plot.h / 2) * scale,
            odd: Math.floor(plot.x / plot.w) % 2 === 1,
            ready: readyToBuy(y, plot.plot),
          },
        ]
      : [],
  );

/** A coin's colours, its body, its face and its writing: gold to buy now, stone to clear first. */
const READY = [GOLD[1], CREAM, GOLD[2]] as const;
const TO_CLEAR = [STONE[2], STONE[3], STONE[3]] as const;

/** A small coin and a price, centred on a point of the map as far as the map's edges let it be. */
/**
 * Where a price's coin goes, for a price `wide` pixels written centred on `cx` of a map `mapW` wide:
 * within the map, its coin's dark edge a pixel to the left and the writing's a pixel to the right.
 */
export function labelLeft(cx: number, wide: number, mapW: number): number {
  return Math.max(1, Math.min(Math.round(cx - (wide + 7) / 2), mapW - wide - 8));
}

export function price(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, ready = true): void {
  const [body, face, ink] = ready ? READY : TO_CLEAR;
  const w = widthOf(g, text, 1);
  const left = labelLeft(cx, w, g.canvas.width);
  const top = Math.round(cy - 4);
  g.fillStyle = INK;
  g.fillRect(left - 1, top + 1, 7, 7);
  g.fillStyle = body;
  g.fillRect(left + 1, top + 2, 3, 5);
  g.fillRect(left, top + 3, 5, 3);
  g.fillStyle = face;
  g.fillRect(left + 1, top + 3, 1, 1);
  write(g, text, left + 7, top, { px: 1, colour: ink, edge: INK });
}
