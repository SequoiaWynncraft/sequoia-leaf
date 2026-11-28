/**
 * The cracker's picture (tier 6): a riveted iron drum on its side over a brick firebox, over two tiles
 * by two, seen from above and a little in front as the breaker is. One copper pipe comes in at its
 * back and one goes out at its way out, the left tile of its front; a small iron stack stands at the
 * back corner away from it. While it makes, the fire in the box is lit. Grade II wears a brass band on
 * the firebox; grade III two copper hoops round the drum as well.
 */
import { kind, outsAs } from "@sequoia-leaf/factory";
import { GOLD, INK } from "@sequoia-leaf/kit/palette.ts";
import { ell, R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { bricks } from "./assembler.ts";
import { TILE } from "./belts.ts";
import { arch, fitted } from "./machines.ts";
import { CLAY, DARK, IRON } from "./pal.ts";

const CRACKER = kind("cracker");
/** How far the picture reaches past its box on each side, for its pipes, and above it, for its stack. */
export const PAD = 6;
export const TALL = 12;
const BOX = TILE * 2;

/** Its way out facing `d`: the tile of its box it leaves from, and the way. */
function outOf(d: number): readonly [number, number, number] {
  const o = outsAs(CRACKER, d)[0];
  return o ? [o.dx, o.dy, o.way] : [1, 0, d];
}

/** Where the top of its stack is in its box, facing `d`, for the puff of smog it lets go. */
export function stackTop(d: number): readonly [number, number] {
  const [tx] = outOf(d);
  return [tx === 0 ? 26 : 6, -10];
}

/** A short copper pipe on the box's tile (`tx`, `ty`) toward `way`, out past its edge, with a dark mouth. */
function pipe(g: Ctx, x: number, y: number, tx: number, ty: number, way: number): void {
  const ox = x + tx * TILE;
  const oy = y + ty * TILE;
  const [px, py, w, h] =
    way === 0
      ? [ox + 13, oy + 6, 8, 4]
      : way === 1
        ? [ox + 6, oy + 13, 4, 8]
        : way === 2
          ? [ox - 5, oy + 6, 8, 4]
          : [ox + 6, oy - 5, 4, 8];
  R(g, px, py, w, h, CLAY[0]);
  R(g, px, py, w, 1, CLAY[1]);
  // The flange at its end, and its mouth.
  const [fx, fy, fw, fh] =
    way === 0
      ? [px + w - 2, py - 1, 2, h + 2]
      : way === 1
        ? [px - 1, py + h - 2, w + 2, 2]
        : way === 2
          ? [px, py - 1, 2, h + 2]
          : [px - 1, py, w + 2, 2];
  R(g, fx, fy, fw, fh, CLAY[1]);
  R(g, fx + (fw > 2 ? 2 : 0), fy + (fh > 2 ? 2 : 0), fw > 2 ? fw - 4 : 1, fh > 2 ? fh - 4 : 1, DARK);
}

/** The firebox: an iron plate on top under the drum, a brick face in front with the fire's mouth. */
function firebox(g: Ctx, x: number, y: number, lit: number): void {
  R(g, x + 2, y + 4, BOX - 4, 18, IRON[1]);
  bricks(g, x + 2, y + 22, BOX - 4, 9, 81);
  R(g, x + 2, y + 22, BOX - 4, 1, CLAY[1]);
  arch(g, x + 12, y + 24, 8, 7, INK);
  if (lit === 0) {
    arch(g, x + 13, y + 25, 6, 6, DARK);
    return;
  }
  arch(g, x + 13, y + 25, 6, 6, CLAY[0]);
  R(g, x + 13, y + 28, 6, 3, GOLD[0]);
  R(g, x + (lit === 1 ? 14 : 16), y + 26, 2, 3, GOLD[1]);
}

/** The drum: riveted iron lying on its side, lit along its top, its ends round, a seam of rivets each side. */
function drum(g: Ctx, x: number, y: number, grade: number): void {
  R(g, x + 5, y + 4, BOX - 10, 15, IRON[2]);
  R(g, x + 5, y + 5, BOX - 10, 2, IRON[4]);
  R(g, x + 5, y + 7, BOX - 10, 2, IRON[3]);
  R(g, x + 5, y + 16, BOX - 10, 3, IRON[1]);
  ell(g, x + 5, y + 11.5, 2.5, 7.5, IRON[3]);
  ell(g, x + BOX - 5, y + 11.5, 2.5, 7.5, IRON[1]);
  for (const sx of [10, 21]) {
    R(g, x + sx, y + 4, 1, 15, IRON[1]);
    for (let ry = 6; ry < 18; ry += 3) R(g, x + sx + 1, y + ry, 1, 1, IRON[4]);
  }
  if (grade >= 3)
    for (const hx of [7, 24]) {
      R(g, x + hx, y + 4, 2, 15, CLAY[0]);
      R(g, x + hx, y + 4, 2, 2, CLAY[1]);
    }
}

/** The stack: a small iron pipe at the back corner away from its way out, a cap on top. */
function stack(g: Ctx, x: number, y: number, d: number): void {
  const [u, v] = stackTop(d);
  R(g, x + u - 2, y + v, 4, 16, IRON[2]);
  R(g, x + u - 2, y + v, 1, 16, IRON[4]);
  R(g, x + u + 1, y + v, 1, 16, IRON[1]);
  R(g, x + u - 3, y + v - 1, 6, 2, IRON[3]);
}

/** The cracker facing `d` at a grade, its box at (PAD, PAD + TALL), its fire out (0) or lit in one of two flickers (1, 2). */
function picture(grade: number, d: number, lit: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(BOX + PAD * 2, BOX + PAD * 2 + TALL);
  const x = PAD;
  const y = PAD + TALL;
  const [tx, ty, way] = outOf(d);
  stack(g, x, y, d);
  firebox(g, x, y, lit);
  fitted(g, grade, x + 3, y + 22, BOX - 6, x + 5, y + 26);
  drum(g, x, y, grade);
  // The pipe in, at its back's middle; the pipe out, at its way out.
  const back = (way + 2) & 3;
  const [bx, by] = back === 0 ? [1, 0] : back === 1 ? [0, 1] : [0, 0];
  pipe(g, x + (back % 2 === 1 ? TILE / 2 : 0), y + (back % 2 === 0 ? TILE / 2 : 0), bx, by, back);
  pipe(g, x, y, tx, ty, way);
  return c;
}

/** Each picture, made once: by grade, way and fire. */
const pictures = new Map<string, HTMLCanvasElement>();
export function crackerOf(grade: number, d: number, lit: number): HTMLCanvasElement {
  const key = `${grade}:${d & 3}:${lit}`;
  const had = pictures.get(key);
  if (had) return had;
  const made = picture(grade, d & 3, lit);
  pictures.set(key, made);
  return made;
}
