/**
 * Smog over the yard (SPEC-2 section 5.2), in the town's muted look: a flat wash of dusk grey-violet
 * over each of the yard's plots at step 1 or more (10, 18 and 26%), eased in over 2 seconds as its
 * step changes, with four to six soft blots over it that drift east and wrap at the plot's edge. From
 * a level of 400 below step 1, the blots alone at half strength: smog coming is seen before it costs
 * anything. It lies on the ground: every piece and every redwood stands over it. The edge of the haze
 * is the edge of the plot, which is the rule. With motion reduced, the blots do not drift.
 */
import { stepOf, type Yard } from "@sequoia-leaf/factory";
import { lessMotion } from "@sequoia-leaf/kit/dom.ts";
import type { Painter } from "@sequoia-leaf/kit/painter.ts";
import type { Pen } from "@sequoia-leaf/kit/pix.ts";
import { hash } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./art/belts.ts";
import type { Art } from "./art/index.ts";
import { IRON } from "./art/pal.ts";
import { drawShades } from "./trees.ts";

/** The wash at each step. */
const WASH = [0, 0.1, 0.18, 0.26] as const;
/** The level from which a plot below step 1 shows its blots, at half strength. */
const BLOTS_FROM = 400;
/** How long the wash takes to reach its new step's, in seconds, once the step changes. */
const EASE = 2;
/** How fast the blots drift east, in the yard's pixels a second. */
const DRIFT = 0.5;

/**
 * By plot, by its place in the land's list: the wash it eases from and to, and when its step last
 * changed on the screen's clock. A plot first seen shows its step's wash at once.
 */
const eased = {
  from: new Float32Array(256),
  to: new Float32Array(256),
  at: new Float64Array(256),
  seen: new Uint8Array(256),
};

/** The soft blots over a plot: `n` of them, each by where it sits in the plot and how wide, from the plot's place. */
function blots(g: Painter, n: number, x: number, y: number, w: number, h: number, t: number, strength: number): void {
  const count = 4 + Math.floor(hash(n, 0, 70) * 3);
  const drift = lessMotion() ? 0 : t * DRIFT;
  for (let b = 0; b < count; b++) {
    const r = (5 + hash(n, b, 71) * 4) / 2;
    const bx = (hash(n, b, 72) * w + drift) % w;
    const by = r + hash(n, b, 73) * (h - r * 2);
    // Drifting past the plot's east edge, it comes back in at its west.
    for (const at of bx + r > w ? [bx, bx - w] : [bx]) {
      // A round blot, as much of it as lies on the plot.
      const x0 = Math.max(x, Math.floor(x + at - r - 1));
      const x1 = Math.min(x + w, Math.ceil(x + at + r + 1));
      g.disc(x + at, y + by, r);
      g.rect(x0, Math.floor(y + by - r - 1), x1 - x0, Math.ceil(r * 2 + 3), IRON[0], 0.06 * strength);
    }
  }
  g.disc();
}

/** The wash a plot shows at `t`: its step's, eased in over `EASE` seconds since the step last changed. */
function plotWash(y: Yard, n: number, t: number): number {
  const to = WASH[stepOf(y.smog.level[n] ?? 0)] ?? 0;
  const shown = (): number => {
    const from = eased.from[n] ?? 0;
    return from + ((eased.to[n] ?? 0) - from) * Math.min(1, Math.max(0, (t - (eased.at[n] ?? 0)) / EASE));
  };
  if (eased.seen[n] !== 1) {
    eased.seen[n] = 1;
    eased.from[n] = to;
    eased.to[n] = to;
  } else if (eased.to[n] !== Math.fround(to)) {
    eased.from[n] = shown();
    eased.to[n] = to;
    eased.at[n] = t;
  }
  return shown();
}

/** How strong a plot's blots are: full at step 1 or more, half from a level of 400 below it, else none. */
const blotStrength = (level: number): number => (stepOf(level) >= 1 ? 1 : level >= BLOTS_FROM ? 0.5 : 0);

/** Lays the haze over the ground of the view, its corner at (`cx`, `cy`) in the yard's pixels, `W` by `H`. */
export function haze(g: Painter, y: Yard, cx: number, cy: number, W: number, H: number, t: number): void {
  const { land } = y;
  for (let n = 0; n < land.plots.length; n++) {
    const plot = land.plots[n];
    if (!plot || !y.plots.includes(plot.plot)) continue;
    const level = y.smog.level[n] ?? 0;
    const now = plotWash(y, n, t);
    const strength = blotStrength(level);
    const [x, top, w, h] = [plot.x * TILE - cx, plot.y * TILE - cy, plot.w * TILE, plot.h * TILE];
    if ((now <= 0.002 && strength === 0) || x > W || top > H || x + w < 0 || top + h < 0) continue;
    if (now > 0.002) g.rect(x, top, w, h, IRON[2], now);
    if (strength > 0) blots(g, n, x, top, w, h, t, strength);
  }
}

/** What lies over the ground of the view before anything flat: the trees' shade (`trees.ts`), and the smog. */
export function onGround(g: Painter, art: Art, y: Yard, cx: number, cy: number, W: number, H: number, t: number): void {
  drawShades(g, art, cx, cy, W, H);
  haze(g, y, cx, cy, W, H, t);
}

/** A plot's wash on the map, at step 1 or more: 20, 35 and 50%. */
const MAP_WASH = [0, 0.2, 0.35, 0.5] as const;

/**
 * Lays the smog on a plan laid at (`dx`, `dy`), `px` pixels to a tile: each of the yard's plots at step
 * 1 or more washed grey-violet, with its step as one, two or three short bars in its corner. No number.
 */
export function hazeOnPlan(g: Pen, y: Yard, dx: number, dy: number, px: number): void {
  const { land } = y;
  const bar = Math.max(1, Math.round(px / 2));
  for (let n = 0; n < land.plots.length; n++) {
    const plot = land.plots[n];
    const s = stepOf(y.smog.level[n] ?? 0);
    if (!plot || s === 0 || !y.plots.includes(plot.plot)) continue;
    const x = dx + plot.x * px;
    const top = dy + plot.y * px;
    g.rect(x, top, plot.w * px, plot.h * px, IRON[2], MAP_WASH[s] ?? 0);
    for (let b = 0; b < s; b++) g.rect(x + px + b * bar * 2, top + px, bar, Math.max(3, bar * 3), IRON[4]);
  }
}
