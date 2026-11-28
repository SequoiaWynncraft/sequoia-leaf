/**
 * The launch pad's picture (tier 8, the Star era: SPEC-2 section 7): a pale slab over its five tiles by
 * five, muted grey-lilac with thin seams, rounded at its corners, seen from above and a little in front.
 * A band of 20 pips round its edge fills with its charged cells, lit pale green-cream as a charged
 * cell's pips are, and falls back on each beat with them. A dark gantry stands at its back, its one
 * small lilac light lit while the pad holds all its rocket takes but its cells. The rocket stands on it
 * in stages as its hull sections and fuel fill: fins, then a quarter of it at a time, its nose last,
 * and for a rocket a cream light at its tip. A short spout on the middle of its front is its way out.
 *
 * At a launch the rocket rises (`launchRocket`) and leaves a pale trail (`launchTrail`) that fades over
 * 3 seconds. No glow wider than 2 pixels, nothing bright. Every picture is made once and never painted
 * on again, as the painter keeps it on its atlas: what changes (the lit pips, the trail's length) is
 * drawn as small pictures over it.
 */
import { CREAM, INK } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./belts.ts";
import { CELL, IRON, LILAC } from "./pal.ts";

/** How far the picture reaches past its box on each side, for its spout, and above it, for its rocket and gantry. */
export const PAD = 4;
export const TALL = 24;
const BOX = TILE * 5;
/** The middle of its slab in its box, where its rocket stands. */
const CX = 40;
const CY = 42;
/** Its slab, darkest first: its side in shadow, its top, the light along its top, and a thin pale seam. */
const SLAB = ["#3f3b4a", "#6b6779", "#7d788c", "#9a95aa"] as const;
/** A rocket's pale shell and its shade, muted to the town's dusk (the yard's letters `8` and `9`). */
const SHELL = ["#c4bfcc", "#8f899b"] as const;
/** The pips round its edge. */
export const PIPS = 20;

/** Where each of its 20 pips sits round the edge of its slab's top, from its box's corner: 6 along each top and bottom, 4 down each side. */
export const PIP_AT: readonly (readonly [number, number])[] = [
  ...Array.from({ length: 6 }, (_, k): [number, number] => [12 + k * 11, 6]),
  ...Array.from({ length: 4 }, (_, k): [number, number] => [BOX - 6, 17 + k * 13]),
  ...Array.from({ length: 6 }, (_, k): [number, number] => [BOX - 13 - k * 11, BOX - 8]),
  ...Array.from({ length: 4 }, (_, k): [number, number] => [5, BOX - 21 - k * 13]),
];

/** Its slab: its side in shadow along its front edge, its top with thin seams in a grid, its corners rounded. */
function slab(g: Ctx, x: number, y: number): void {
  R(g, x + 2, y + 3, BOX - 4, BOX - 2, SLAB[0]);
  R(g, x + 1, y + 2, BOX - 2, BOX - 6, SLAB[1]);
  R(g, x + 2, y + 1, BOX - 4, BOX - 4, SLAB[1]);
  R(g, x + 3, y + 2, BOX - 6, 2, SLAB[2]);
  for (let k = 16; k < BOX - 4; k += 16) {
    R(g, x + k, y + 3, 1, BOX - 9, SLAB[0]);
    R(g, x + 3, y + k, BOX - 6, 1, SLAB[0]);
  }
  // A thin pale seam round the ring the rocket stands in.
  for (let a = 0; a < 40; a++) {
    const t = (a / 40) * Math.PI * 2;
    R(g, x + CX + Math.round(Math.cos(t) * 13), y + CY + Math.round(Math.sin(t) * 8), 1, 1, SLAB[3]);
  }
}

/** The band of pips round its edge, every one unlit: those lit are drawn over it (`PIP_AT`, `litPip`). */
function pips(g: Ctx, x: number, y: number): void {
  for (const [px, py] of PIP_AT) {
    R(g, x + px - 1, y + py - 1, 3, 3, SLAB[0]);
    R(g, x + px, y + py, 1, 1, IRON[2]);
  }
}

/** The small pictures drawn over a pad, each made the first time it is asked for: a lit pip, and a piece of trail. */
const small = new Map<"pip" | "trail", HTMLCanvasElement>();

/** A lit pip, pale green-cream, one pixel: drawn over the slab at each of `PIP_AT` that is lit, so the slab's picture does not change with them. */
export function litPip(): HTMLCanvasElement {
  const had = small.get("pip");
  if (had) return had;
  const { c, g } = makeCanvas(1, 1);
  R(g, 0, 0, 1, 1, CELL[2]);
  small.set("pip", c);
  return c;
}

/** The spout of its way out, on its box's tile (`ox`, `oy`) toward `way`, at the box's edge. */
function spout(g: Ctx, x: number, y: number, ox: number, oy: number, way: number): void {
  const tx = x + ox * TILE;
  const ty = y + oy * TILE;
  const [sx, sy, sw, sh] =
    way === 0
      ? [tx + TILE - 3, ty + 5, 5, 6]
      : way === 1
        ? [tx + 5, ty + TILE - 3, 6, 5]
        : way === 2
          ? [tx - 2, ty + 5, 5, 6]
          : [tx + 5, ty - 2, 6, 5];
  R(g, sx - 1, sy - 1, sw + 2, sh + 2, INK);
  R(g, sx, sy, sw, sh, IRON[2]);
  R(g, sx, sy, sw, 1, IRON[4]);
}

/** Its gantry, a dark lattice tower beside where its rocket stands, at `(gx, foot)`; its lilac light at its top `on`. */
function gantry(g: Ctx, gx: number, foot: number, on: boolean): void {
  const top = foot - 40;
  R(g, gx - 1, top - 1, 7, 42, INK);
  R(g, gx, top, 5, 40, IRON[1]);
  for (let k = top + 3; k < foot; k += 5) R(g, gx, k, 5, 1, IRON[3]);
  R(g, gx + 2, top, 1, 40, IRON[2]);
  R(g, gx + 1, top - 3, 3, 3, IRON[0]);
  R(g, gx + 2, top - 2, 1, 1, on ? LILAC[4] : IRON[3]);
}

/** A rocket standing, its foot's middle at `(rx, foot)`: tall `h` (a test rocket short), its first `stage` quarters built (0 to 4), and its tip light where it has one. */
function rocket(g: Ctx, rx: number, foot: number, h: number, stage: number, tip: boolean): void {
  if (stage <= 0) return;
  const w = h > 24 ? 8 : 6;
  const left = rx - w / 2;
  // Its three fins, built first.
  R(g, left - 3, foot - 6, w + 6, 6, INK);
  R(g, left - 2, foot - 5, 2, 5, IRON[3]);
  R(g, left + w, foot - 5, 2, 5, IRON[3]);
  R(g, rx - 1, foot - 4, 2, 4, IRON[2]);
  const built = Math.round((h * Math.min(stage, 4)) / 4);
  R(g, left - 1, foot - built - 1, w + 2, built + 1, INK);
  R(g, left, foot - built, w, built, SHELL[0]);
  R(g, left + w - 2, foot - built, 2, built, SHELL[1]);
  for (let k = foot - 8; k > foot - built; k -= 9) R(g, left, k, w, 1, SHELL[1]);
  if (stage < 4) return;
  // Its nose, narrowing to its tip, and the cream light there.
  for (let k = 1; k <= w / 2; k++) R(g, rx - w / 2 + k, foot - h - k, w - k * 2, 1, k === w / 2 ? INK : SHELL[0]);
  if (tip) R(g, rx - 1, foot - h - w / 2 - 1, 1, 2, CREAM);
}

/** The pad, its box at (PAD, PAD + TALL): its way out on tile (`ox`, `oy`) toward `way`; its rocket tall `h` and built to `stage`; its light `on`. */
function picture(out: readonly [number, number, number], h: number, stage: number, on: boolean): HTMLCanvasElement {
  const [ox, oy, way] = out;
  const { c, g } = makeCanvas(BOX + PAD * 2, BOX + PAD * 2 + TALL);
  const x = PAD;
  const y = PAD + TALL;
  if (way === 3) spout(g, x, y, ox, oy, way);
  slab(g, x, y);
  pips(g, x, y);
  // Its gantry at its back: beside the rocket opposite its way out, or behind it.
  const [gx, gy] = way === 0 ? [CX - 22, CY + 6] : way === 2 ? [CX + 17, CY + 6] : [CX - 22, CY + 6];
  gantry(g, x + gx, y + gy, on);
  rocket(g, x + CX, y + CY + 6, h, stage, h > 24);
  if (way !== 3) spout(g, x, y, ox, oy, way);
  return c;
}

/** The pad for a button or a card, small: a pale slab, its gantry, and a rocket standing on it. */
export function launchpadIcon(): HTMLCanvasElement {
  const { c, g } = makeCanvas(22, 22);
  R(g, 1, 14, 20, 7, SLAB[0]);
  R(g, 1, 13, 20, 6, SLAB[1]);
  R(g, 2, 13, 18, 1, SLAB[2]);
  for (const px of [3, 7, 11, 15, 19]) R(g, px, 18, 1, 1, CELL[2]);
  R(g, 3, 2, 3, 13, IRON[1]);
  R(g, 4, 1, 1, 1, LILAC[4]);
  R(g, 10, 4, 5, 11, INK);
  R(g, 11, 5, 3, 10, SHELL[0]);
  R(g, 13, 5, 1, 10, SHELL[1]);
  R(g, 12, 3, 1, 2, SHELL[0]);
  R(g, 9, 12, 1, 3, IRON[3]);
  R(g, 15, 12, 1, 3, IRON[3]);
  return c;
}

/** How tall each rocket stands on the pad: a test rocket short. */
export const rocketTall = (test: boolean): number => (test ? 22 : 34);

/** Each picture, made once and never painted on again (the painter keeps it): by way out, rocket, stage and light. */
const pictures = new Map<string, HTMLCanvasElement>();
export function launchpadOf(
  out: readonly [number, number, number],
  test: boolean,
  stage: number,
  on: boolean,
): HTMLCanvasElement {
  const key = `${out.join(":")}:${test ? 1 : 0}:${stage}:${on ? 1 : 0}`;
  const had = pictures.get(key);
  if (had) return had;
  const made = picture(out, rocketTall(test), stage, on);
  pictures.set(key, made);
  return made;
}

/** Where the rocket's foot stands, from the pad's box's corner: what rises at a launch rises from there. */
export const ROCKET_FOOT = { x: CX, y: CY + 6 } as const;

/** A rocket rising, whole, with a short pale flame below it: its picture, its foot's middle at (`w / 2`, its height less the flame). */
const rising = new Map<boolean, HTMLCanvasElement>();
export function launchRocket(test: boolean): HTMLCanvasElement {
  const had = rising.get(test);
  if (had) return had;
  const h = rocketTall(test);
  const { c, g } = makeCanvas(16, h + 12);
  rocket(g, 8, h + 6, h, 4, !test);
  R(g, 7, h + 6, 2, 4, CREAM);
  R(g, 7, h + 10, 2, 2, SHELL[1]);
  rising.set(test, c);
  return c;
}

/** How long one piece of a rocket's pale trail is: a trail is drawn as so many, each fainter toward the pad. */
export const TRAIL_PIECE = 16;
/** A piece of the pale trail a rocket leaves: two pixels wide, one picture for every trail, never painted on again. */
export function launchTrail(): HTMLCanvasElement {
  const had = small.get("trail");
  if (had) return had;
  const { c, g } = makeCanvas(2, TRAIL_PIECE);
  R(g, 0, 0, 2, TRAIL_PIECE, SHELL[0]);
  small.set("trail", c);
  return c;
}
