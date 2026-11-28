/**
 * The powerhouse's picture (tier 6): a brick block over two tiles by two, a tall brick stack at its
 * back with an iron cowl, and one arched window in its front. Burning, the window is warm with the
 * fire behind it; cold, it is dark glass. Its smoke is the frame's (`kinds/powerhouse.ts`), thicker on
 * pitch than on spirit. It faces no way: it takes in on every side and sends nothing.
 */
import { GOLD, INK } from "@sequoia-leaf/kit/palette.ts";
import { R, shingles } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { bricks, TAR, UNLIT } from "./assembler.ts";
import { TILE } from "./belts.ts";
import { arch, PURPLE } from "./machines.ts";
import { CLAY, IRON } from "./pal.ts";

/** How far the picture reaches past its box on each side, and above it, for its stack. */
export const PAD = 2;
export const TALL = 22;
const BOX = TILE * 2;
/** Where its wall begins under its roof, in its box. */
const WALL = 9;

/** Where the top of its stack is in its box, for its smoke. */
export const STACK_TOP: readonly [number, number] = [25, -20];

/** The window: an arched frame of dark brick, small panes, warm and flickering while it burns (`lit` 1 or 2), dark glass cold. */
function window(g: Ctx, x: number, y: number, lit: number): void {
  arch(g, x - 1, y - 1, 12, 15, CLAY[0]);
  arch(g, x, y, 10, 13, INK);
  const [glass, shine] = lit === 0 ? UNLIT : [GOLD[0], GOLD[1]];
  arch(g, x + 1, y + 1, 8, 11, glass);
  if (lit > 0) {
    R(g, x + 2, y + 6, 6, 5, shine);
    R(g, x + (lit === 1 ? 3 : 5), y + 4, 2, 2, shine);
    R(g, x + 1, y + 11, 8, 1, CLAY[1]);
  } else R(g, x + 2, y + 2, 2, 1, UNLIT[1]);
  // The bars between its panes.
  R(g, x + 5, y + 1, 1, 11, TAR[0]);
  R(g, x + 1, y + 6, 8, 1, TAR[0]);
  R(g, x - 1, y + 13, 12, 1, IRON[3]);
}

/** The powerhouse, its box at (PAD, PAD + TALL), cold (`lit` 0) or burning in one of two flickers (1, 2). */
function picture(lit: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(BOX + PAD * 2, BOX + PAD * 2 + TALL);
  const x = PAD;
  const y = PAD + TALL;
  // The stack at its back, brick, with an iron cowl.
  const [su, sv] = STACK_TOP;
  bricks(g, x + su - 3, y + sv, 7, WALL - sv + 2, 91);
  R(g, x + su - 4, y + sv - 2, 9, 3, IRON[2]);
  R(g, x + su - 4, y + sv - 2, 9, 1, IRON[4]);
  // The roof: the town's slate, a brick parapet along its front.
  shingles(g, x, y, BOX, WALL, (r) => Math.round((WALL - r) * 0.2), PURPLE, 92);
  bricks(g, x + su - 3, y, 7, 4, 93);
  R(g, x, y + WALL - 2, BOX, 2, CLAY[0]);
  R(g, x, y + WALL - 2, BOX, 1, CLAY[1]);
  // The wall, brick on a darker foot, the window in its middle.
  bricks(g, x, y + WALL, BOX, BOX - WALL - 2, 94);
  R(g, x, y + BOX - 2, BOX, 2, TAR[0]);
  R(g, x, y + BOX - 2, BOX, 1, TAR[1]);
  window(g, x + 11, y + WALL + 5, lit);
  return c;
}

/** Each picture, made once: cold, and burning in two flickers. */
const pictures = new Map<number, HTMLCanvasElement>();
export function powerhouseOf(lit: number): HTMLCanvasElement {
  const had = pictures.get(lit);
  if (had) return had;
  const made = picture(lit);
  pictures.set(lit, made);
  return made;
}
