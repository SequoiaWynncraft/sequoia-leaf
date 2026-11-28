/**
 * The Works' pictures of the Star era (tiers 7 and 8, SPEC-2 section 7): domes, rings and rounded
 * shells in the dark iron ramp with thin pale seams, the same dusk as the rest, darker and rounder than
 * Spark, not brighter. The depot gone over in them: it loses its chimney and its wheel, and its roof
 * becomes a low dome of dull glass with a ring turning slowly under it, a thin mast with one cream
 * light that blinks on the beat (every 20 seconds), and a small dish. Its windows are lit cream, as
 * Spark's are.
 */
import { CREAM, INK } from "@sequoia-leaf/kit/palette.ts";
import { ell, R } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { IRON, type Sprite } from "./pal.ts";

/** The dome's glass, darkest first, and a thin pale seam on it. */
const GLASS = ["#24222e", "#302e3c", "#3b3848", "#8a86a0"] as const;
const SEAM = "#6f6a7d";
/** Cream light through glass, as Spark lights its windows. */
const LIT = ["#8a7c6c", "#d8cfb4", "#ece3c8"] as const;
/** Where the roof ends, the dome's middle at its foot, and its size. */
const EAVE = 37;
const DOME = { x: 26, rx: 24, ry: 23 } as const;
/** The mast's light, in the picture: what blinks on the beat. */
export const MAST = { x: 35, y: 1 } as const;
/** Where the ring under the dome turns, in the picture: the corner of its frames (`starRing`). */
export const RING = { x: 3, y: 32, w: 46, h: 3 } as const;

/** A point on the dome, `along` of the way round its foot (-1 to 1) and `up` of the way to its top (0 to 1). */
function onDome(along: number, up: number): [number, number] {
  const t = (up * Math.PI) / 2;
  return [Math.round(DOME.x + DOME.rx * along * Math.cos(t)), Math.round(EAVE - DOME.ry * Math.sin(t))];
}

/** The dome over the eave: dull glass, its seams up it and round it, one highlight, on a canvas of the roof's height. */
function dome(): HTMLCanvasElement {
  const { c, g } = makeCanvas(52, EAVE);
  ell(g, DOME.x, EAVE, DOME.rx + 1, DOME.ry + 1, INK);
  ell(g, DOME.x, EAVE, DOME.rx, DOME.ry, GLASS[0]);
  ell(g, DOME.x, EAVE, DOME.rx - 1, DOME.ry - 1, GLASS[1]);
  ell(g, DOME.x, EAVE - 4, DOME.rx - 8, DOME.ry - 9, GLASS[2]);
  for (const along of [-0.62, -0.25, 0.25, 0.62])
    for (let k = 0; k <= 24; k++) {
      const [px, py] = onDome(along, k / 24);
      R(g, px, py, 1, 1, SEAM);
    }
  for (let k = -24; k <= 24; k++) {
    const [px, py] = onDome(k / 24, 0.45);
    R(g, px, py, 1, 1, SEAM);
  }
  for (let k = 0; k < 8; k++) {
    const [px, py] = onDome(-0.55 + k * 0.03, 0.72 + k * 0.02);
    R(g, px, py, 1, 1, GLASS[3]);
  }
  return c;
}

/** The ring under the dome, still: a band of dark iron with pale ticks round it. */
function ring(g: Ctx, step: number): void {
  R(g, 0, 0, RING.w, RING.h, IRON[1]);
  R(g, 0, 0, RING.w, 1, IRON[3]);
  for (let x = (step * 2) % 6; x < RING.w; x += 6) R(g, x, 1, 1, 2, SEAM);
}

/** The thin mast and its light, unlit, and the small dish on its short stalk. */
function mastAndDish(g: Ctx): void {
  R(g, MAST.x, MAST.y + 2, 1, 15, IRON[3]);
  R(g, MAST.x - 1, MAST.y + 15, 3, 2, IRON[2]);
  R(g, MAST.x, MAST.y, 1, 2, IRON[2]);
  // The dish, tilted up to the left, on its stalk.
  R(g, 14, 16, 1, 5, IRON[3]);
  for (let k = 0; k < 6; k++) R(g, 9 + k, 12 + Math.round((k - 2.5) ** 2 / 4), 1, 1, "#c9c5d2");
  R(g, 10, 13, 4, 1, "#9b97a8");
  R(g, 13, 15, 2, 1, IRON[2]);
}

/**
 * The depot of the Star era (tiers 7 and 8): the same workshop (`s`, drawn afresh for it), its roof,
 * chimney and wheel taken off and a dome put in their place, with its ring, mast and dish, and its
 * windows lit cream.
 */
export function starDepot(s: Sprite): Sprite {
  const g = s.c.getContext("2d");
  if (!g) return s;
  // The window and the floor inside the door, lit cream.
  R(g, 7, 44, 5, 6, LIT[1]);
  R(g, 7, 44, 5, 3, LIT[2]);
  R(g, 7, 44, 2, 1, CREAM);
  R(g, 19, 58, 14, 6, LIT[0]);
  R(g, 20, 61, 12, 3, LIT[1]);
  R(g, 22, 63, 8, 1, LIT[2]);
  g.clearRect(0, 0, 52, EAVE);
  R(g, 0, EAVE, 52, 1, IRON[0]);
  g.drawImage(dome(), 0, 0);
  const band = makeCanvas(RING.w, RING.h);
  ring(band.g, 0);
  g.drawImage(band.c, RING.x, RING.y);
  mastAndDish(g);
  return s;
}

/** The ring under the Star depot's dome, turning, a frame of four: drawn over the still one while the depot gives more. */
export function starRing(step: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(RING.w, RING.h);
  ring(g, step);
  return c;
}

/** The mast's light, lit: a cream point two pixels tall, with no glow. */
export function mastLight(): HTMLCanvasElement {
  const { c, g } = makeCanvas(1, 2);
  R(g, 0, 0, 1, 2, CREAM);
  return c;
}
