/**
 * The mark of the town's own. Whoever lives in the game and is not a member (a cat, a gnome, a
 * glorp, the keeper of the Treasury, a regular at the battler's table) has its name written in
 * leaf green with the small acorn before it, wherever it is named. A member's name never has it:
 * theirs is cream, with their rank.
 */

import { el, icon } from "./dom.ts";
import { BARK, GOLD, INK, LEAF } from "./palette.ts";
import { bitmap, outlined } from "./pix.ts";

/** The kit's acorn, as rows of letters; `tools/frames.ts` draws the same one into the stylesheet. */
export const ACORN: readonly string[] = [
  ".....bb.....",
  ".....b......",
  "..BBBBBBBB..",
  ".BnBnBnBnBB.",
  ".BBnBnBnBnB.",
  "..oyyyyyyo..",
  "..oyYyyyyo..",
  "..oyYyyyyo..",
  "..oyyyyyyo..",
  "...oyyyyo...",
  "....oyyo....",
  ".....oo.....",
];
const ACORN_PAL = { b: BARK[1], B: BARK[2], n: BARK[3], o: GOLD[0], y: GOLD[1], Y: GOLD[2] } as const;

/** The colour a townsperson's name is written in. */
export const FOLK_COLOUR = LEAF;

/** A townsperson's name as a page shows it: the acorn, then the name, in leaf green. */
export function folkName(name: string, classes = ""): HTMLElement {
  return el("span", classes ? `k-folk ${classes}` : "k-folk", {}, icon("acorn"), name);
}

let acorn: HTMLCanvasElement | null = null;
/** The acorn as a small picture with its dark edge, for a name written on a canvas. Made once. */
export function acornPicture(): HTMLCanvasElement {
  acorn ??= outlined(bitmap(ACORN, ACORN_PAL), INK);
  return acorn;
}

/** How many canvas pixels to each of the acorn's, beside letters drawn `px` canvas pixels to each of the font's. */
export const acornScale = (px: number): number => Math.max(1, Math.round(px * 0.6));
