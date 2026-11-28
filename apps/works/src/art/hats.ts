/** The gnomes' hats: each gatherer's by its grade, the gate's visitors', Pipwick's. */
import { GOLD, GREEN, SKY, WATER } from "@sequoia-leaf/kit/palette.ts";

import { CLAY, IRON, LILAC } from "./pal.ts";

/** A hat's colours: where the light falls on it, its brim in shade, and the pixel at its tip. */
export type Hat = readonly [lit: string, shade: string, tip: string];

/**
 * The gnome's hats: a gatherer's by its grade (`gathererHat`), five for the gnomes who come to the
 * gate (the fifth, blue, is Pipwick's, as in town), and the fourth grade's: iron, with the Star
 * era's lilac along its brim and, where it shows, a lilac light at its tip.
 */
export const HATS: readonly Hat[] = [
  [CLAY[2], CLAY[1], CLAY[2]],
  [GOLD[1], GOLD[0], GOLD[1]],
  [SKY[4], SKY[3], SKY[4]],
  [GREEN[4], GREEN[3], GREEN[4]],
  [WATER[3], WATER[2], WATER[3]],
  [IRON[4], LILAC[2], LILAC[4]],
];
/** Which of `HATS` is Pipwick's. */
export const PIPWICK_HAT = 4;
/** Which of `HATS` a gatherer wears at each grade, the first first: clay red, then green, then gold, then dark iron. */
const GATHERER_HATS = [0, 3, 1, 5] as const;
/** The hat a gatherer of a grade wears, so that each grade can be told at a glance. */
export const gathererHat = (grade: number): number => GATHERER_HATS[Math.max(0, grade - 1)] ?? GATHERER_HATS[0];
