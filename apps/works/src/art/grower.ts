/**
 * The grower's picture (tier 7, the Star era: SPEC-2 section 7): a dark round bed over its three tiles
 * by three, under a low dome of dull glass, seen from above and a little in front as the still is.
 * Inside, on a mound of dark rock, a cluster of lilac points, one for each star crystal it holds up to
 * four, and none when it holds none: a starved grower is an empty dome. Its one light, a small lilac
 * one on the front of its bed, is lit while it grows. A short spout on the middle of its front is its
 * way out. Dark iron with thin pale seams; grade II wears a second seam round its bed, grade III an
 * iron band with rivets as well. No glow, nothing bright.
 */
import { INK } from "@sequoia-leaf/kit/palette.ts";
import { ell, R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./belts.ts";
import { IRON, LILAC } from "./pal.ts";

/** How far the picture reaches past its box on each side, for its spout, and above it, for its dome. */
export const PAD = 3;
export const TALL = 8;
const BOX = TILE * 3;
/** The middle of its bed in its box, and of its dome. */
const CX = 24;
const CY = 27;
/** Its glass: the dark of the dome, its body, the light along its top, and the highlight. */
const GLASS = ["#24222e", "#302e3c", "#3d3a4b", "#8a86a0"] as const;
/** A thin pale seam. */
const SEAM = "#7b7688";

/** Where its points stand on the rock under the dome, from its middle: the first, then each more. */
const POINTS: readonly (readonly [number, number, number])[] = [
  [0, 0, 7],
  [-5, 2, 5],
  [5, 1, 6],
  [-1, 4, 4],
];

/** The spout of its way out, by the way it faces: the middle tile of its front, at the box's edge. */
function spout(g: Ctx, x: number, y: number, d: number): void {
  const [sx, sy, sw, sh] =
    d === 0 ? [BOX - 7, 21, 7, 6] : d === 1 ? [21, BOX - 7, 6, 7] : d === 2 ? [0, 21, 7, 6] : [21, 0, 6, 7];
  R(g, x + sx - 1, y + sy - 1, sw + 2, sh + 2, INK);
  R(g, x + sx, y + sy, sw, sh, IRON[2]);
  R(g, x + sx, y + sy, sw, 1, IRON[4]);
  const [mx, my] =
    d === 0 ? [sx + sw - 2, sy + 2] : d === 1 ? [sx + 2, sy + sh - 2] : d === 2 ? [sx, sy + 2] : [sx + 2, sy];
  R(g, x + mx, y + my, 2, 2, IRON[0]);
}

/** Its bed: a dark round slab, its side in shadow, a thin pale seam round its top, and its grade's bands. */
function bed(g: Ctx, x: number, y: number, grade: number): void {
  ell(g, x + CX, y + CY + 4, 22, 15, IRON[0]);
  ell(g, x + CX, y + CY + 1, 22, 14.5, IRON[1]);
  ell(g, x + CX, y + CY, 21, 13.5, SEAM);
  ell(g, x + CX, y + CY, 20, 12.5, IRON[2]);
  if (grade >= 2) {
    ell(g, x + CX, y + CY + 1, 17.5, 10.5, SEAM);
    ell(g, x + CX, y + CY + 1, 16.5, 9.5, IRON[2]);
  }
  if (grade >= 3) {
    R(g, x + CX - 18, y + CY + 12, 36, 2, IRON[3]);
    for (let rx = -15; rx <= 15; rx += 6) R(g, x + CX + rx, y + CY + 12, 1, 1, SEAM);
  }
}

/** The dome over the bed: dull glass, darker at its foot, a light along its top and one highlight. */
function dome(g: Ctx, x: number, y: number): void {
  ell(g, x + CX, y + CY - 3, 15, 13, GLASS[0]);
  ell(g, x + CX, y + CY - 4, 14, 12, GLASS[1]);
  ell(g, x + CX, y + CY - 8, 10, 6, GLASS[2]);
  // Its foot, where it sits on the bed: a ring of dark iron, and a seam on it.
  ell(g, x + CX, y + CY + 5, 15, 4, IRON[1]);
  R(g, x + CX - 13, y + CY + 5, 26, 1, SEAM);
}

/** The rock inside the dome, and on it a lilac point for each star crystal it holds, up to four. */
function crystals(g: Ctx, x: number, y: number, points: number): void {
  ell(g, x + CX, y + CY + 3, 8, 3, IRON[0]);
  for (let p = 0; p < Math.min(points, POINTS.length); p++) {
    const [dx, dy, tall] = POINTS[p] ?? [0, 0, 5];
    const px = x + CX + dx;
    const foot = y + CY + 3 + dy;
    R(g, px - 1, foot - tall, 3, tall, LILAC[2]);
    R(g, px - 1, foot - tall + 1, 1, tall - 2, LILAC[3]);
    R(g, px, foot - tall - 1, 1, 1, LILAC[3]);
    R(g, px - 1, foot - tall, 1, 1, LILAC[4]);
  }
}

/** The highlight on the dome's glass, over what is inside it. */
function shine(g: Ctx, x: number, y: number): void {
  for (let k = 0; k < 7; k++)
    R(g, x + CX - 10 + k, y + CY - 12 - Math.round(Math.sin((k / 6) * Math.PI) * 2), 1, 1, GLASS[3]);
}

/** Its one light, on the front of its bed: lilac while it grows, dark while it does not. */
function light(g: Ctx, x: number, y: number, lit: boolean): void {
  R(g, x + CX - 2, y + CY + 9, 4, 3, IRON[0]);
  R(g, x + CX - 1, y + CY + 10, 2, 1, lit ? LILAC[4] : LILAC[1]);
}

/** The grower facing `d` at a grade, its box at (PAD, PAD + TALL): `points` star crystals showing (0 to 4), its light `lit`. */
function picture(grade: number, d: number, points: number, lit: boolean): HTMLCanvasElement {
  const { c, g } = makeCanvas(BOX + PAD * 2, BOX + PAD * 2 + TALL);
  const x = PAD;
  const y = PAD + TALL;
  // Its spout behind it where it faces north, in front of the bed otherwise.
  if (d === 3) spout(g, x, y, d);
  bed(g, x, y, grade);
  dome(g, x, y);
  crystals(g, x, y, points);
  shine(g, x, y);
  light(g, x, y, lit);
  if (d !== 3) spout(g, x, y, d);
  return c;
}

/** The grower for a button or a card, small: its bed and dome with two lilac points inside, its light lit. */
export function growerIcon(grade: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(22, 22);
  ell(g, 11, 16, 10, 5, IRON[0]);
  ell(g, 11, 15, 10, 4.5, SEAM);
  ell(g, 11, 15, 9, 4, IRON[2]);
  if (grade >= 2) R(g, 3, 18, 16, 1, SEAM);
  ell(g, 11, 11, 7.5, 7, GLASS[0]);
  ell(g, 11, 10.5, 6.5, 6, GLASS[1]);
  ell(g, 11, 8, 4.5, 3, GLASS[2]);
  ell(g, 11, 15, 4, 1.5, IRON[0]);
  for (const [px, tall] of [
    [10, 6],
    [13, 4],
  ] as const) {
    R(g, px, 15 - tall, 2, tall, LILAC[2]);
    R(g, px, 15 - tall, 1, tall - 1, LILAC[3]);
    R(g, px, 15 - tall, 1, 1, LILAC[4]);
  }
  R(g, 6, 6, 3, 1, GLASS[3]);
  R(g, 10, 19, 2, 1, LILAC[4]);
  return c;
}

/** Each picture, made once: by grade, way, points showing and light. */
const pictures = new Map<string, HTMLCanvasElement>();
export function growerOf(grade: number, d: number, points: number, lit: boolean): HTMLCanvasElement {
  const key = `${grade}:${d & 3}:${points}:${lit ? 1 : 0}`;
  const had = pictures.get(key);
  if (had) return had;
  const made = picture(grade, d & 3, points, lit);
  pictures.set(key, made);
  return made;
}
