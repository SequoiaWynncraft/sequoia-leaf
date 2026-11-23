/**
 * How big the yard is drawn. The picture is a whole number of screen pixels to each of the yard's:
 * the size that suits the screen, and the steps over or under it the member has asked for. Past one
 * screen pixel for each of the yard's there are two steps more, where the yard is drawn as a plan
 * (`plan.ts`) at a whole number of screen pixels to a tile. The camera zooms within these steps,
 * and the screen's record keeps them, so neither asks for a step the other would not take.
 */

import { clamp } from "@sequoia-leaf/kit/util.ts";

/** The most steps the view may be zoomed in, and out, from the size that suits the screen. */
export const ZOOM = { in: 3, out: 32 } as const;

/** The size that suits the screen: the town's own scale, so a tile here is as big as a tile there. */
export const natural = (cw: number, ch: number): number => Math.max(1, Math.floor(Math.min(cw / 160, ch / 176)));

/**
 * The steps of the plan, further out than one screen pixel for each of the yard's: how many screen
 * pixels a tile is at each. A tile of the picture is sixteen of the yard's pixels.
 */
export const FAR = [8, 4] as const;

/**
 * The step drawn for so many steps from `base`: a whole number of screen pixels to each of the
 * yard's, out as far as one; then as many steps of the plan as `far` allows (0, then -1); and no
 * further in or out than `ZOOM` allows.
 */
export const zoomFor = (base: number, steps: number, far = 0): number =>
  clamp(base + steps, Math.max(1 - Math.min(far, FAR.length), base - ZOOM.out), base + ZOOM.in);

/** How many screen pixels to a tile a step is drawn at. */
export const tilePx = (step: number): number => (step >= 1 ? step * 16 : (FAR[-step] ?? 4));

/**
 * How many steps of the plan a window lets the view go out to, for a yard whose plots reach so many
 * tiles across and down: one more for as long as the yard is not whole in view at the step before,
 * in the part of the window the interface leaves clear (in screen pixels). So a window that shows
 * the whole yard at a step goes no further out than that, and a yard of one plot has none.
 */
export function farSteps(tilesAcross: number, tilesDown: number, clearW: number, clearH: number): number {
  let steps = 0;
  for (let px = 16; steps < FAR.length && (tilesAcross * px > clearW || tilesDown * px > clearH); steps++)
    px = FAR[steps] ?? px;
  return steps;
}

/**
 * How many times a trouble mark is enlarged at a size drawn. The view used to stop at a third of
 * `base`: down to there a mark is its own size, and further out it grows so that it is at least as
 * big on the screen as it was at that third.
 */
export const markSize = (base: number, z: number): number => Math.ceil(Math.ceil(base / 3) / z);
