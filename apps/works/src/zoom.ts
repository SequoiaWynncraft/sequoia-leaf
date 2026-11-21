/**
 * How big the yard is drawn. The picture is a whole number of screen pixels to each of the yard's:
 * the size that suits the screen, and the steps over or under it the member has asked for. The
 * camera zooms within these steps, and the screen's record keeps them, so neither asks for a step
 * the other would not take.
 */

import { clamp } from "@sequoia-leaf/kit/util.ts";

/** The most steps the view may be zoomed in, and out, from the size that suits the screen. */
export const ZOOM = { in: 3, out: 16 } as const;

/** The size that suits the screen: the town's own scale, so a tile here is as big as a tile there. */
export const natural = (cw: number, ch: number): number => Math.max(1, Math.floor(Math.min(cw / 160, ch / 176)));

/**
 * The size drawn for so many steps from `base`: never under a third of it (nor under 1), and no
 * further in or out than `ZOOM` allows.
 */
export const zoomFor = (base: number, steps: number): number =>
  clamp(base + steps, Math.max(1, Math.ceil(base / 3), base - ZOOM.out), base + ZOOM.in);
