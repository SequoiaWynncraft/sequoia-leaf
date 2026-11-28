/**
 * The fourth grade's look, for lines and gatherers alone (tier 7's research): the Star era's dark
 * iron and its one small lilac light, darker than the third grade and never brighter. A belt's is
 * its own wood (`belts.ts`); a tunnel's hood and a gatherer's barrow are the third grade's gone over
 * here, the hood's brass turned lilac and its iron a step darker, the barrow turned to dark iron with
 * a lilac lamp on its front.
 */
import { BARK, GOLD, INK, STONE } from "@sequoia-leaf/kit/palette.ts";
import { R, rgb } from "@sequoia-leaf/kit/pix.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { IRON, LILAC } from "./pal.ts";

/** Every pixel of one colour turned to another, over the whole picture drawn so far: each pair once. */
function recolour(g: Ctx, pairs: readonly (readonly [string, string])[]): void {
  const from = pairs.map(([f]) => rgb(f));
  const to = pairs.map(([, t]) => rgb(t));
  const { width: w, height: h } = g.canvas;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const k = from.findIndex(([r, gg, b]) => d[i] === r && d[i + 1] === gg && d[i + 2] === b);
    const [r, gg, b] = to[k] ?? [];
    if (r === undefined || gg === undefined || b === undefined) continue;
    d[i] = r;
    d[i + 1] = gg;
    d[i + 2] = b;
  }
  g.putImageData(img, 0, 0);
}

/** Brass to lilac, step for step, and dark iron a step darker: a third-grade piece made a fourth. */
const STAR: readonly (readonly [string, string])[] = [
  [GOLD[0], LILAC[1]],
  [GOLD[1], LILAC[2]],
  [GOLD[2], LILAC[3]],
  [IRON[1], IRON[0]],
  [IRON[2], IRON[1]],
  [IRON[3], IRON[2]],
  [IRON[4], IRON[3]],
];

/** A piece of the fourth grade, drawn as the third (`ironClad`), gone over in the Star era's dark iron and lilac. */
export function starClad(g: Ctx, grade: number): void {
  if (grade >= 4) recolour(g, STAR);
}

/** The barrow's wood and its wheel's stone as dark iron, darkest first as the wood's ramp is. */
const CART: readonly (readonly [string, string])[] = [
  [BARK[1], IRON[0]],
  [BARK[2], IRON[1]],
  [BARK[3], IRON[1]],
  [BARK[4], IRON[2]],
  [STONE[1], IRON[2]],
  [STONE[2], IRON[3]],
];
const carts = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/**
 * A fourth-grade gatherer's cart: his barrow (`barrow`, as either way it faces) in dark iron, with a
 * lamp of lilac on its front edge and its dark edge kept. Made once for each barrow.
 */
export function cart(barrow: HTMLCanvasElement, left: boolean): HTMLCanvasElement {
  const had = carts.get(barrow);
  if (had) return had;
  const { c, g } = makeCanvas(barrow.width, barrow.height);
  g.drawImage(barrow, 0, 0);
  recolour(g, CART);
  // The lamp: on the rim at the cart's far end from its handles, lit at its top.
  const x = left ? 1 : barrow.width - 3;
  R(g, x, 0, 2, 1, INK);
  R(g, x, 1, 2, 1, LILAC[3]);
  R(g, x + (left ? 0 : 1), 1, 1, 1, LILAC[4]);
  carts.set(barrow, c);
  return c;
}
