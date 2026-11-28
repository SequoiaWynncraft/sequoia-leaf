/**
 * The Works' pictures of the Spark era (tiers 5 and 6, SPEC-2 section 7): brick, copper, tarred timber
 * and a cold cream light. The depot gone over in them, and the copper drum it wears.
 */
import type { Yard } from "@sequoia-leaf/factory";
import { BARK, CREAM, INK } from "@sequoia-leaf/kit/palette.ts";
import { ell, outlined, R } from "@sequoia-leaf/kit/pix.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { isSpark } from "../era.ts";
import type { Machines } from "./machines.ts";
import { CLAY, DARK, IRON, type Sprite } from "./pal.ts";

/** Cream light, where every light before tier 5 was gold: the Spark era's lit glass, warm and pale. */
const SPARK_GLASS = ["#8a7c6c", "#d8cfb4", "#ece3c8"] as const;

/**
 * The depot of the Spark era (tiers 5 and 6): the same workshop (`s`, drawn afresh for it), gone over in brick and copper. A brick
 * chimney stack, a strip of glass along the roof ridge, a string of lights along the gable, a copper
 * drum between iron cheeks where the brass wheel was, and its light cream.
 */
export function sparkDepot(s: Sprite): Sprite {
  const g = s.c.getContext("2d");
  if (!g) return s;
  // The window and the floor inside the door, lit cream.
  R(g, 7, 44, 5, 6, SPARK_GLASS[1]);
  R(g, 7, 44, 5, 3, SPARK_GLASS[2]);
  R(g, 7, 44, 2, 1, CREAM);
  R(g, 9, 44, 1, 6, BARK[1]);
  R(g, 19, 58, 14, 6, SPARK_GLASS[0]);
  R(g, 20, 61, 12, 3, SPARK_GLASS[1]);
  R(g, 22, 63, 8, 1, SPARK_GLASS[2]);
  // Glass along the ridge, in panes.
  R(g, 9, 7, 34, 2, "#9a9488");
  R(g, 9, 7, 34, 1, "#c9c2ae");
  for (let x = 13; x < 43; x += 6) R(g, x, 7, 1, 2, BARK[1]);
  // The copper drum between iron cheeks on the roof.
  ell(g, 24, 23, 8, 8, BARK[0]);
  ell(g, 24, 23, 6.8, 6.8, BARK[2]);
  R(g, 19, 19, 10, 8, CLAY[1]);
  R(g, 19, 19, 10, 1, CLAY[3]);
  for (const y of [22, 25]) R(g, 19, y, 10, 1, CLAY[0]);
  for (const x of [17, 29]) {
    R(g, x, 18, 2, 10, IRON[3]);
    R(g, x, 18, 2, 1, IRON[4]);
  }
  // The chimney, in brick: courses with their joints staggered, an iron cap.
  R(g, 38, 2, 8, 22, CLAY[1]);
  for (let y = 4, n = 0; y < 24; y += 3, n++) {
    R(g, 38, y, 8, 1, CLAY[0]);
    R(g, 39 + (n % 2) * 3, y - 2, 1, 2, CLAY[0]);
  }
  R(g, 44, 2, 2, 22, CLAY[0]);
  R(g, 37, 0, 10, 3, IRON[2]);
  R(g, 37, 0, 10, 1, IRON[4]);
  R(g, 39, 1, 6, 1, DARK);
  // A string of small lights along the gable, sagging between its three hooks.
  for (let x = 1; x < 51; x++) {
    const sag = Math.round(Math.sin(((x - 1) / 25) * Math.PI) ** 2);
    R(g, x, 36 + sag, 1, 1, IRON[1]);
    if (x % 5 === 3) R(g, x, 37 + sag, 1, 1, CREAM);
  }
  return s;
}

/** The Spark depot's drum turning between its cheeks, for when the depot gives more: in place of the brass flywheel. */
export function sparkFly(step: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(12, 12);
  R(g, 2, 2, 8, 8, CLAY[1]);
  R(g, 2, 2 + ((step * 2) % 8), 8, 1, CLAY[3]);
  R(g, 2, 2 + ((step * 2 + 4) % 8), 8, 1, CLAY[0]);
  for (const x of [0, 10]) {
    R(g, x, 1, 2, 10, IRON[3]);
    R(g, x, 1, 2, 1, IRON[4]);
  }
  return outlined(c, INK);
}

/** A picture of its own to draw on, as `s` is. */
function copied(s: Sprite): Sprite {
  const { c, g } = makeCanvas(s.c.width, s.c.height);
  g.drawImage(s.c, 0, 0);
  return { c, ax: s.ax, ay: s.ay };
}

/** The Spark era's depot and drum, made once for each set of the yard's pictures. */
const made = new WeakMap<Machines, { depot: Sprite; fly: readonly HTMLCanvasElement[] }>();

/** The depot as a yard's era draws it (SPEC-2 section 7), and the wheel it wears: from tier 5, Spark's brick and copper. */
export function depotOf(m: Machines, y: Yard): { depot: Sprite; fly: readonly HTMLCanvasElement[] } {
  if (!isSpark(y)) return { depot: m.depot, fly: m.fly };
  const had = made.get(m);
  if (had) return had;
  const now = { depot: sparkDepot(copied(m.depot)), fly: [0, 1, 2, 3].map(sparkFly) };
  made.set(m, now);
  return now;
}
