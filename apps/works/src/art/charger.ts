/**
 * The charger's picture (tier 8, the Star era: SPEC-2 section 7): a dark round cradle over its two
 * tiles by two, seen from above and a little in front as the grower is, with a cell standing in it and
 * a ring of three pips on its lid. A pip is lit pale green-cream, as a charged cell's are on a belt.
 * Its one light, a small muted teal one on the front of its base, is lit while it charges. A short
 * spout at the left tile of its front is its way out. Dark iron with thin pale seams; grade II wears a
 * second seam round its cradle, grade III an iron band with rivets as well. No glow, nothing bright.
 */
import { INK } from "@sequoia-leaf/kit/palette.ts";
import { ell, R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./belts.ts";
import { CELL, IRON, TEAL } from "./pal.ts";

/** How far the picture reaches past its box on each side, for its spout, and above it, for its cell. */
export const PAD = 4;
export const TALL = 6;
const BOX = TILE * 2;
/** The middle of its cradle in its box. */
const CX = 16;
const CY = 18;
/** A thin pale seam. */
const SEAM = "#7b7688";
/** Where its three pips sit on its lid, from its middle: left, middle and right of the front of the ring. */
const PIPS: readonly (readonly [number, number])[] = [
  [-6, 5],
  [0, 7],
  [6, 5],
];

/** The spout of its way out, on its box's tile (`ox`, `oy`) toward `way`, at the box's edge. */
function spout(g: Ctx, x: number, y: number, ox: number, oy: number, way: number): void {
  const tx = x + ox * TILE;
  const ty = y + oy * TILE;
  const [sx, sy, sw, sh] =
    way === 0
      ? [tx + TILE - 4, ty + 5, 5, 6]
      : way === 1
        ? [tx + 5, ty + TILE - 4, 6, 5]
        : way === 2
          ? [tx - 1, ty + 5, 5, 6]
          : [tx + 5, ty - 1, 6, 5];
  R(g, sx - 1, sy - 1, sw + 2, sh + 2, INK);
  R(g, sx, sy, sw, sh, IRON[2]);
  R(g, sx, sy, sw, 1, IRON[4]);
}

/** Its cradle: a dark round base, a thin pale seam round its lid, and its grade's bands. */
function cradle(g: Ctx, x: number, y: number, grade: number): void {
  ell(g, x + CX, y + CY + 4, 14, 10, IRON[0]);
  ell(g, x + CX, y + CY + 1, 14, 9.5, IRON[1]);
  ell(g, x + CX, y + CY, 13, 8.5, SEAM);
  ell(g, x + CX, y + CY, 12, 7.5, IRON[2]);
  if (grade >= 2) {
    ell(g, x + CX, y + CY, 10, 6, SEAM);
    ell(g, x + CX, y + CY, 9, 5, IRON[2]);
  }
  if (grade >= 3) {
    R(g, x + CX - 11, y + CY + 9, 22, 2, IRON[3]);
    for (let rx = -9; rx <= 9; rx += 6) R(g, x + CX + rx, y + CY + 9, 1, 1, SEAM);
  }
  // The well the cell stands in.
  ell(g, x + CX, y + CY, 5, 3, IRON[0]);
}

/** The cell standing in its well: dark caps, a dull grey tube, pale inside while it holds a charge. */
function cell(g: Ctx, x: number, y: number, full: boolean): void {
  const left = x + CX - 3;
  const top = y + CY - 12;
  R(g, left - 1, top - 1, 8, 15, INK);
  R(g, left, top, 6, 13, CELL[0]);
  R(g, left + 1, top + 3, 3, 7, full ? CELL[1] : CELL[0]);
  R(g, left + 5, top, 1, 13, IRON[3]);
  R(g, left, top, 6, 2, IRON[1]);
  R(g, left, top + 11, 6, 2, IRON[1]);
}

/** The three pips on its lid, the first `lit` of them lit. */
function pips(g: Ctx, x: number, y: number, lit: number): void {
  PIPS.forEach(([dx, dy], p) => {
    R(g, x + CX + dx - 1, y + CY + dy - 1, 3, 3, IRON[0]);
    R(g, x + CX + dx, y + CY + dy, 1, 1, p < lit ? CELL[2] : IRON[3]);
  });
}

/** Its one light, on the front of its base: muted teal while it charges, dark while it does not. */
function light(g: Ctx, x: number, y: number, on: boolean): void {
  R(g, x + CX + 9, y + CY + 6, 3, 3, IRON[0]);
  R(g, x + CX + 10, y + CY + 7, 1, 1, on ? TEAL : IRON[2]);
}

/** The charger at a grade, its box at (PAD, PAD + TALL), its way out on tile (`ox`, `oy`) toward `way`: `lit` pips lit (0 to 3), its light `on`. */
function picture(grade: number, ox: number, oy: number, way: number, lit: number, on: boolean): HTMLCanvasElement {
  const { c, g } = makeCanvas(BOX + PAD * 2, BOX + PAD * 2 + TALL);
  const x = PAD;
  const y = PAD + TALL;
  // Its spout behind it where its way out is on its far side, in front of the cradle otherwise.
  const behind = way === 3;
  if (behind) spout(g, x, y, ox, oy, way);
  cradle(g, x, y, grade);
  cell(g, x, y, lit > 0);
  pips(g, x, y, lit);
  light(g, x, y, on);
  if (!behind) spout(g, x, y, ox, oy, way);
  return c;
}

/** The charger for a button or a card, small: its cradle with a cell in it, all three pips lit. */
export function chargerIcon(grade: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(22, 22);
  ell(g, 11, 16, 10, 5, IRON[0]);
  ell(g, 11, 15, 10, 4.5, SEAM);
  ell(g, 11, 15, 9, 4, IRON[2]);
  if (grade >= 2) R(g, 3, 18, 16, 1, SEAM);
  R(g, 8, 3, 6, 12, INK);
  R(g, 9, 4, 4, 10, CELL[0]);
  R(g, 10, 6, 2, 6, CELL[1]);
  R(g, 9, 4, 4, 1, IRON[1]);
  for (const px of [6, 11, 16]) R(g, px, 17, 1, 1, CELL[2]);
  return c;
}

/** Each picture, made once: by grade, way out, pips lit and light. */
const pictures = new Map<string, HTMLCanvasElement>();
export function chargerOf(
  grade: number,
  out: readonly [number, number, number],
  lit: number,
  on: boolean,
): HTMLCanvasElement {
  const [ox, oy, way] = out;
  const key = `${grade}:${ox}:${oy}:${way}:${lit}:${on ? 1 : 0}`;
  const had = pictures.get(key);
  if (had) return had;
  const made = picture(grade, ox, oy, way, lit, on);
  pictures.set(key, made);
  return made;
}
