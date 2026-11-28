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
/**
 * Star's lilac (tiers 7 and 8), darkest first: star crystal, and the one small light a Star piece may
 * wear. Dusk-muted, as SPEC-2's star crystal is (`#b9a6d9`): the town's sky ramp turns pink at its
 * pale end, and nothing of the Star era is pink, magenta or bright.
 */
export const LILAC = ["#2c2836", "#3e3650", "#5e5276", "#8f82ad", "#b9a6d9"] as const;
/**
 * A cell's charge (tier 8), darkest first: the dull grey of a plain cell's tube, the pale middle of a
 * full one, and a lit pip, pale green-cream, which is how a charged cell's bars are read on a belt.
 */
export const CELL = ["#7f8a8c", "#b3c6b8", "#dbe6cb"] as const;
/** The muted teal a lattice is crossed with, the Star era's other small light (never both on one piece). */
export const TEAL = "#8fb5ad";
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
  Z: SKY[0],
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
  // Blackened iron, for tier 5's scrap, slag and windings.
  K: IRON[0],
  I: IRON[1],
  i: IRON[2],
  j: IRON[3],
  J: IRON[4],
  // Tar and what is distilled from it, for tier 6: tar the darkest, creosote and sleepers the bark
  // browns, spirit the straw of old glass, varnish amber.
  T: "#1f1b24",
  f: "#5a4636",
  F: "#6b5040",
  L: "#c9b98a",
  M: "#b8873f",
  // Star crystal's lilac, darkest first, and a lattice's teal, for tier 7.
  X: LILAC[1],
  H: LILAC[2],
  O: LILAC[3],
  P: LILAC[4],
  W: TEAL,
  // A cell and its charge, for tier 8: the dull grey of its tube, a lit pip pale green-cream and the
  // pale middle of a full one; a hull section's pale plate and its shade; rocket fuel's dull red and
  // its shade; a rocket's pale shell and its shade.
  "3": CELL[0],
  "1": CELL[2],
  "2": CELL[1],
  "4": "#c3c1cc",
  "5": "#8f8c9c",
  "6": "#a8664f",
  "7": "#6e3f33",
  "8": "#c4bfcc",
  "9": "#8f899b",
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
