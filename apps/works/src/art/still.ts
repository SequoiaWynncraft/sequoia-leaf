/**
 * The still's picture (tier 6): a squat copper pot on a brick hearth, a tall swan-neck column behind
 * it, and three taps along its front, one on each tile of its front: the left drips black (pitch), the
 * middle brown (creosote), the right pale (spirit). It is seen from above and a little in front, as
 * the breaker is, so that its front can face any way: the column stands on the side away from its
 * taps. While it distils the fire under the pot is lit and the taps drip; stopped because one thing
 * cannot leave, that tap wears a dark plug and the fire dims. Grade II wears a brass band on its
 * hearth; grade III an iron jacket on its column as well.
 */
import { kind, outsAs } from "@sequoia-leaf/factory";
import { BARK, GOLD, INK } from "@sequoia-leaf/kit/palette.ts";
import { ell, R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { bricks } from "./assembler.ts";
import { TILE } from "./belts.ts";
import { arch, fitted } from "./machines.ts";
import { CLAY, DARK, IRON } from "./pal.ts";

const STILL = kind("still");
/** How far the picture reaches past its box on each side, for its taps, and above it, for its column. */
export const PAD = 6;
export const TALL = 22;
const BOX = TILE * 3;
/** How tall the column stands over its foot. */
const COL = 28;

/** What each tap drips, from the left as it faces: pitch black, creosote brown, spirit pale. */
const DRIPS = ["#2a2530", "#5a4636", "#c9b98a"] as const;

/** Where the column's foot is in its box, by the way it faces: on the side away from its taps. */
const FOOT: readonly (readonly [number, number])[] = [
  [7, 27],
  [14, 8],
  [41, 27],
  [38, 34],
];

/** Where the top of its column is in its box, facing `d`, for the puff of smog it lets go. */
export function columnTop(d: number): readonly [number, number] {
  const [u, v] = FOOT[d & 3] ?? [7, 27];
  return [u, v - COL - 2];
}

/**
 * The brick hearth: a dark iron plate on top for the pot, a brick face in front with the fire's mouth
 * in it, and the fire: out (0), dimmed (1), or lit in one of two flickers (2, 3).
 */
function hearth(g: Ctx, x: number, y: number, fire: number): void {
  R(g, x + 2, y + 4, BOX - 4, 32, IRON[2]);
  R(g, x + 3, y + 5, BOX - 6, 30, IRON[1]);
  bricks(g, x + 2, y + 36, BOX - 4, 10, 71);
  R(g, x + 2, y + 36, BOX - 4, 1, CLAY[1]);
  R(g, x + 2, y + 46, BOX - 4, 1, BARK[0]);
  // The fire's mouth, and the fire in it: out, embers, or lit.
  arch(g, x + 18, y + 38, 12, 8, INK);
  if (fire === 0) {
    arch(g, x + 19, y + 39, 10, 7, DARK);
    return;
  }
  if (fire === 1) {
    arch(g, x + 19, y + 39, 10, 7, DARK);
    R(g, x + 20, y + 44, 8, 2, CLAY[0]);
    R(g, x + 22, y + 44, 2, 1, CLAY[1]);
    return;
  }
  arch(g, x + 19, y + 39, 10, 7, CLAY[0]);
  R(g, x + 20, y + 42, 8, 4, GOLD[0]);
  const lick = fire === 2 ? [21, 25] : [23, 27];
  for (const fx of lick) R(g, x + fx, y + 40, 2, 3, GOLD[1]);
  R(g, x + 20, y + 45, 8, 1, CLAY[1]);
}

/** The pot: squat copper, a shadow under it, a domed lid with a knob on top. */
function pot(g: Ctx, x: number, y: number): void {
  ell(g, x + 24, y + 23, 15, 9, IRON[0]);
  ell(g, x + 24, y + 20, 14, 10, CLAY[0]);
  ell(g, x + 24, y + 19, 13, 9, CLAY[1]);
  ell(g, x + 19, y + 15, 5, 2.6, CLAY[2]);
  ell(g, x + 24, y + 14, 6, 3.4, CLAY[0]);
  ell(g, x + 24, y + 13.5, 5, 2.4, CLAY[1]);
  R(g, x + 23, y + 10, 2, 2, CLAY[0]);
  R(g, x + 23, y + 10, 1, 1, CLAY[3]);
}

/** The column: a tall copper pipe on an iron foot, its cap, and at grade III an iron jacket in rings. */
function column(g: Ctx, x: number, y: number, d: number, grade: number): void {
  const [u, v] = FOOT[d & 3] ?? [7, 27];
  const cx = x + u;
  const top = y + v - COL;
  R(g, cx - 4, y + v - 2, 8, 3, IRON[2]);
  R(g, cx - 4, y + v - 2, 8, 1, IRON[3]);
  R(g, cx - 3, top, 6, COL - 2, CLAY[1]);
  R(g, cx - 3, top, 1, COL - 2, CLAY[2]);
  R(g, cx + 2, top, 1, COL - 2, CLAY[0]);
  if (grade >= 3)
    for (let ry = top + 4; ry < y + v - 4; ry += 5) {
      R(g, cx - 3, ry, 6, 2, IRON[2]);
      R(g, cx - 3, ry, 6, 1, IRON[4]);
    }
  R(g, cx - 4, top - 2, 8, 3, CLAY[0]);
  R(g, cx - 4, top - 2, 8, 1, CLAY[1]);
}

/** The swan neck: a copper pipe from the top of the column, arching over and down to the pot's lid. */
function neck(g: Ctx, x: number, y: number, d: number): void {
  const [u, v] = FOOT[d & 3] ?? [7, 27];
  const [x0, y0] = [x + u, y + v - COL - 1];
  const [x2, y2] = [x + 24, y + 11];
  const [x1, y1] = [(x0 + x2) / 2, Math.min(y0, y2) - 6];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const px = Math.round((1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * x1 + t * t * x2);
    const py = Math.round((1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * y1 + t * t * y2);
    R(g, px - 1, py, 2, 2, CLAY[0]);
    R(g, px - 1, py, 2, 1, CLAY[1]);
  }
}

/**
 * A tap on the edge of the box's tile (`tx`, `ty`) toward `way`: a short copper spout with a valve on
 * it. Plugged, its mouth is stopped dark; else a drop of what it sends hangs from it, `drop` pixels
 * fallen.
 */
function tap(
  g: Ctx,
  x: number,
  y: number,
  at: readonly [number, number, number],
  col: string,
  plugged: boolean,
  drop: number,
): void {
  const [tx, ty, way] = at;
  const ox = x + tx * TILE;
  const oy = y + ty * TILE;
  // The spout (corner, width, height) and its mouth's pixel, by the way it points.
  const [sx, sy, sw, sh, mx, my] =
    way === 0
      ? [ox + 14, oy + 6, 6, 3, ox + 19, oy + 9]
      : way === 1
        ? [ox + 7, oy + 14, 3, 6, ox + 8, oy + 20]
        : way === 2
          ? [ox - 4, oy + 6, 6, 3, ox - 4, oy + 9]
          : [ox + 7, oy - 4, 3, 6, ox + 8, oy - 5];
  R(g, sx, sy, sw, sh, CLAY[0]);
  R(g, sx, sy, sw, 1, CLAY[1]);
  // The valve: a small iron wheel on the spout's root.
  const [vx, vy] = sw > sh ? [way === 0 ? sx : sx + sw - 2, sy - 1] : [sx - 1, way === 1 ? sy : sy + sh - 2];
  R(g, vx, vy, 2, 2, IRON[4]);
  if (plugged) {
    R(g, mx - 1, my - 2, 3, 3, INK);
    R(g, mx, my - 1, 1, 1, IRON[1]);
    return;
  }
  R(g, mx, my + drop, 1, 2, col);
  R(g, mx, my + drop, 1, 1, IRON[4]);
}

/** Its taps facing `d`: each way out's tile in its box and the way it leaves, from the left as it faces. */
function tapsOf(d: number): readonly (readonly [number, number, number])[] {
  return outsAs(STILL, d).map((o) => [o.dx + 1, o.dy + 1, o.way] as const);
}

/**
 * The still facing `d` at a grade, its box at (PAD, PAD + TALL): its fire as `fire` says, the tap
 * that is `plug` from the left stopped (-1 for none), and the others' drops `drop` pixels fallen.
 */
function picture(grade: number, d: number, plug: number, fire: number, drop: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(BOX + PAD * 2, BOX + PAD * 2 + TALL);
  const x = PAD;
  const y = PAD + TALL;
  hearth(g, x, y, fire);
  fitted(g, grade, x + 3, y + 36, BOX - 6, x + 8, y + 40);
  // The column stands behind the pot unless it faces north, when its back is toward the viewer.
  const behind = (d & 3) !== 3;
  if (behind) column(g, x, y, d, grade);
  pot(g, x, y);
  if (!behind) column(g, x, y, d, grade);
  neck(g, x, y, d);
  tapsOf(d).forEach((at, w) => tap(g, x, y, at, DRIPS[w] ?? DRIPS[0], w === plug, drop));
  return c;
}

/** Each picture, made once: by grade, way, tap stopped, fire and drop. */
const pictures = new Map<string, HTMLCanvasElement>();
export function stillOf(grade: number, d: number, plug: number, fire: number, drop: number): HTMLCanvasElement {
  const key = `${grade}:${d & 3}:${plug}:${fire}:${drop}`;
  const had = pictures.get(key);
  if (had) return had;
  const made = picture(grade, d & 3, plug, fire, drop);
  pictures.set(key, made);
  return made;
}
