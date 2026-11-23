/** The letters the yard's pictures are typed in, and the few small tools every picture here uses. */

import { BARK, CREAM, EARTH, GOLD, GREEN, INK, PAPER, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, outlined } from "@sequoia-leaf/kit/pix.ts";
import { clamp } from "@sequoia-leaf/kit/util.ts";

/** A picture and the pixel of it that goes on its spot in the yard. */
export interface Sprite {
  c: HTMLCanvasElement;
  ax: number;
  ay: number;
}

/** Fired clay and copper: the one warm red the town already uses for pots and mushrooms. */
export const CLAY = ["#7a2f2a", "#b0483a", SKY[5], "#f4a08c"] as const;
/**
 * Blackened iron, darkest first: what the third grade is made of where the first two are wood (as
 * many steps as the wood's ramp, `BARK`) or stone. A muted, dusk-lit grey with the sky's purple in it.
 */
export const IRON = ["#221d27", "#2e2a35", "#403b47", "#55505c", "#6c6672"] as const;
/** The dark inside of a doorway or a tunnel. */
export const DARK = "#24121a";
/** Deep forest floor, where the yard has not been cleared. */
export const DEEP = ["#141f1c", "#19291f", "#1e3324"] as const;

/** Letters for pictures typed out in rows: the town's, and a few more for the yard. */
export const PAL: Readonly<Record<string, string>> = {
  k: INK,
  w: CREAM,
  y: GOLD[1],
  Y: GOLD[2],
  o: GOLD[0],
  r: CLAY[2],
  R: CLAY[1],
  q: CLAY[3],
  Q: CLAY[0],
  p: SKY[4],
  v: SKY[3],
  V: SKY[2],
  z: SKY[1],
  g: GREEN[2],
  G: GREEN[3],
  l: GREEN[4],
  d: GREEN[0],
  x: BARK[0],
  b: BARK[1],
  B: BARK[2],
  n: BARK[3],
  N: BARK[4],
  h: STONE[0],
  s: STONE[1],
  S: STONE[2],
  t: STONE[3],
  c: "#e9d8b8",
  C: "#cbb894",
  a: PAPER[1],
  A: PAPER[0],
  e: EARTH[1],
  E: EARTH[2],
  m: WATER[1],
  u: WATER[2],
  U: WATER[3],
  D: DARK,
};

/** A picture with the dark edge every sprite has; `ax`, `ay` are counted before the edge is added. */
export const spr = (c: HTMLCanvasElement, ax: number, ay: number): Sprite => ({
  c: outlined(c, INK),
  ax: ax + 1,
  ay: ay + 1,
});

/** A typed picture with its edge. */
export const bm = (rows: readonly string[], ax: number, ay: number): Sprite => spr(bitmap(rows, PAL), ax, ay);

/** A colour from a ramp, by a number that may fall between or beyond its steps. */
export const tone = (ramp: readonly string[], i: number): string =>
  ramp[clamp(Math.round(i), 0, ramp.length - 1)] ?? "#000000";
