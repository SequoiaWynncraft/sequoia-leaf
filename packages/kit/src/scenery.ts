/**
 * The town's painted scenery, copied into the kit (from `apps/town/src/ground.ts` and
 * `sprites.ts`) so pictures outside the town can stand in the same clearing: the sunset behind
 * the far trees, the forest floor and grass, the enormous redwood trunks, ferns, the lantern tree
 * and paper lanterns. Each is worked out a pixel at a time from the palette.
 */

import { BARK, CREAM, GOLD, GREEN, INK, SKY } from "./palette.ts";
import { outlined, paint, R } from "./pix.ts";
import { clamp, type Ctx, hash, makeCanvas, vnoise } from "./util.ts";

export const at = (ramp: readonly string[], i: number): string =>
  ramp[clamp(Math.round(i), 0, ramp.length - 1)] ?? "#000000";

/** Deep forest floor, where nobody walks. */
export const DEEP = ["#141f1c", "#19291f", "#1e3324"] as const;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** An ordered-dither threshold in [0, 1) for a pixel, for blending two colours without smoothing. */
export const dither = (x: number, y: number): number => ((BAYER[(y & 3) * 4 + (x & 3)] ?? 0) + 0.5) / 16;

// ---------- the sunset ----------

const SKY_STOPS = [0, 0.3, 0.47, 0.6, 0.73, 0.85, 0.94, 1.2];

/** Whether a far trunk stands at this column: trunks are spaced unevenly, never in ranks. */
function farTrunk(
  x: number,
  y: number,
  horizon: number,
  spacing: number,
  thin: number,
  wide: number,
  seed: number,
): boolean {
  const flare = Math.max(0, y - (horizon - 8)) * 0.4;
  for (let k = Math.floor(x / spacing) - 1; k <= Math.floor(x / spacing) + 1; k++) {
    if (hash(k, seed, 61) < 0.18) continue;
    const cx = k * spacing + hash(k, seed, 62) * spacing * 0.6;
    const half = (thin + hash(k, seed, 63) * (wide - thin)) / 2 + flare;
    if (Math.abs(x - cx) < half) return true;
  }
  return false;
}

/**
 * The town's backdrop at another size: the canopy hanging in from above, far trunks (nearest
 * darkest), the sun low between them where the trees part, a few long clouds, and the sky in
 * dithered bands from plum to gold. Rows from `horizon` down are the forest floor's darkest green.
 */
export function paintSunset(w: number, h: number, horizon: number, sunX: number): HTMLCanvasElement {
  const clouds = [0, 1, 2, 3].map((i) => ({
    x: w * (0.12 + i * 0.26) + (hash(i, 1, 90) - 0.5) * w * 0.12,
    y: horizon * (0.5 + hash(i, 2, 90) * 0.32),
    rx: 14 + hash(i, 3, 90) * 22,
    ry: 1 + hash(i, 4, 90) * 1.4,
    col: 3 + Math.floor(hash(i, 5, 90) * 3),
  }));
  return paint(w, h, (x, y) => {
    if (y >= horizon) return DEEP[0];
    const canopy =
      horizon * 0.2 + vnoise(x / 18, 0, 64) * horizon * 0.22 + vnoise(x / 5, 1, 65) * 6 + vnoise(x / 2, y / 2, 66) * 2;
    if (y < canopy) return SKY[0];
    const open = Math.abs(x - sunX) < 14;
    if (!open && farTrunk(x, y, horizon, 44, 8, 14, 2)) return SKY[0];
    if (y < canopy + 6 + vnoise(x / 4, 2, 67) * 5) return SKY[1];
    if (!open && y > horizon - 3 - vnoise(x / 24, 4, 68) * 5) return SKY[1];
    if (!open && farTrunk(x, y, horizon, 27, 3, 6, 1)) return SKY[1];

    const sun = Math.hypot(x - sunX, (y - horizon) * 1.05);
    if (sun < 7) return CREAM;
    if (sun < 11) return GOLD[2];
    for (const c of clouds) {
      const e = ((x - c.x) / c.rx) ** 2 + ((y - c.y) / c.ry) ** 2;
      if (e < 0.75 + vnoise(x / 5, y / 2, 69) * 0.5) return at(SKY, c.col);
    }
    const v = y / horizon + Math.max(0, 1 - sun / 60) * 0.16;
    let band = 0;
    while (band < SKY_STOPS.length - 2 && v >= (SKY_STOPS[band + 1] ?? 9)) band++;
    const lo = SKY_STOPS[band] ?? 0;
    const hi = SKY_STOPS[band + 1] ?? 1;
    const t = (v - lo) / (hi - lo);
    if (band === 0 && hash(x, y, 70) > 0.996) return CREAM;
    return at(SKY, t > 0.55 && dither(x, y) < (t - 0.55) / 0.45 ? band + 1 : band);
  });
}

/**
 * The clearing's grass from `top` down: one green with lighter and darker drifts lying across it,
 * shade towards the trees at both sides, a strip of deep forest floor along its far edge, and
 * tufts never quite in line.
 */
export function paintGrass(w: number, h: number, top: number): HTMLCanvasElement {
  return paint(w, h, (x, y) => {
    if (y < top) return null;
    if (y < top + 3) return at(DEEP, (y - top) / 1.5 + hash(x >> 1, y, 71) * 0.8);
    const n = vnoise(x / 30, y / 9, 3);
    let idx = n > 0.7 ? 3 : n < 0.27 ? 1 : 2;
    const edge = Math.min(x - 10, w - 10 - x, (y - top) * 2.2);
    if (edge < 4 + vnoise(x / 20, y / 14, 8) * 30) idx -= 1;
    idx = clamp(idx, 0, 3);
    const gx = Math.floor(x / 13);
    const gy = Math.floor(y / 9);
    if (hash(gx, gy, 31) > 0.62) {
      const dx = x - (gx * 13 + 1 + Math.floor(hash(gx, gy, 32) * 9));
      const dy = y - (gy * 9 + 3 + Math.floor(hash(gx, gy, 33) * 5));
      if ((dx === 0 && dy === 0) || (dx === 2 && dy === 0)) return at(GREEN, idx - 1);
      if (dx === 1 && dy === -1) return at(GREEN, idx + 1);
    }
    return at(GREEN, idx);
  });
}

// ---------- the enormous trunks ----------

const TRUNK_RAMP = ["#1c1019", "#2a1519", ...BARK];

export interface Painted {
  c: HTMLCanvasElement;
  /** Where the picture's foot is: this pixel goes on the trunk's spot. */
  ax: number;
  ay: number;
}

/** How far a trunk's bark reaches either side of its middle on row `y`: `hw` up the trunk, spreading into roots. */
export function trunkHalf(hw: number, height: number, seed: number, y: number): number {
  const flare = Math.round(hw * 0.5);
  const rootH = hw * 1.5;
  return hw + flare * clamp((y - (height - rootH)) / rootH, 0, 1) ** 2.6 + Math.sin(y * 0.021 + seed) * 1.4;
}

/**
 * A redwood trunk seen from its foot upwards: round, deeply furrowed, spreading into roots.
 * `dim` is how many rows from the top are lost in the canopy's shade.
 */
export function paintTrunk(hw: number, height: number, seed: number, dim: number): Painted {
  const flare = Math.round(hw * 0.5);
  const w = (hw + flare) * 2 + 4;
  const cx = w / 2;
  const foot = (x: number): number =>
    height - 2 - 3.2 * (0.5 + 0.5 * Math.sin(x * 0.2 + seed * 2.1)) - 2 * (0.5 + 0.5 * Math.sin(x * 0.57 + seed));
  const c = paint(w, height, (x, y) => {
    const hf = trunkHalf(hw, height, seed, y);
    const off = Math.abs(x + 0.5 - cx);
    if (off >= hf || y > foot(x)) return null;
    const u = (x + 0.5 - cx) / hf;
    let idx = 4.9 - 2.5 * Math.abs(u + 0.28) ** 1.4;
    const stripe = (u * hf) / 6.5 + 0.7 * vnoise(x * 0.09, y * 0.014, seed) + 0.3 * Math.sin(y * 0.03 + seed);
    const f = stripe - Math.floor(stripe);
    if (f < 0.24) idx -= 1.5;
    else if (f > 0.66 && f < 0.86) idx += 0.8;
    idx += (hash(x, y >> 1, seed) - 0.5) * 0.7;
    idx -= clamp((dim - y) / 46, 0, 4);
    if (off > hf - 1.3 || y > foot(x) - 1) idx = Math.min(idx, 1.4);
    return at(TRUNK_RAMP, idx);
  });
  return { c, ax: Math.round(cx), ay: height - 1 };
}

// ---------- ferns ----------

/** A fern: fronds arching out from one foot, each with its rows of leaflets. */
export function drawFern(g: Ctx, bx: number, by: number, size: number, cols: readonly string[], seed: number): void {
  const n = 5 + Math.floor(hash(seed, 1, 81) * 3);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + ((i - (n - 1) / 2) * 2.3) / n + (hash(seed, i, 82) - 0.5) * 0.25;
    const len = size * (0.72 + hash(seed, i, 83) * 0.4);
    let x = bx;
    let y = by;
    const vx = Math.cos(a);
    let vy = Math.sin(a);
    const col = cols[i % cols.length] ?? "#000000";
    for (let s = 0; s < len; s++) {
      x += vx;
      y += vy;
      vy += (0.9 / size) * (1 + Math.abs(vx));
      R(g, Math.round(x), Math.round(y), 1, 1, col);
      if (s % 2 === 1 && s > 1) {
        const reach = Math.max(1, Math.round((1 - s / len) * size * 0.24));
        const k = Math.hypot(vx, vy) || 1;
        for (let q = 1; q <= reach; q++) {
          R(g, Math.round(x - (vy / k) * q), Math.round(y + (vx / k) * q), 1, 1, col);
          R(g, Math.round(x + (vy / k) * q), Math.round(y - (vx / k) * q), 1, 1, col);
        }
      }
    }
  }
}

// ---------- the lantern tree and its lanterns ----------

const AMBER = ["#7a3b22", BARK[4], GOLD[0], GOLD[1], GOLD[2]];

/** The great lantern tree: a young maple gone gold, with its dark edge. Its foot is at (33, 81). */
export function lanternTree(): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 80);
  R(g, 29, 44, 6, 36, BARK[1]);
  R(g, 29, 44, 2, 36, BARK[3]);
  R(g, 27, 77, 10, 3, BARK[1]);
  for (let i = 0; i < 12; i++) {
    R(g, 28 - i, 54 - i, 2, 1, BARK[1]);
    R(g, 35 + i, 56 - i, 2, 1, BARK[1]);
  }
  const lobes: readonly (readonly [number, number, number])[] = [
    [32, 25, 21],
    [16, 34, 14],
    [48, 34, 14],
    [25, 15, 13],
    [41, 16, 12],
  ];
  g.drawImage(
    paint(64, 56, (x, y) => {
      let lit = -9;
      for (const [cx, cy, r] of lobes) {
        const d = Math.hypot(x - cx, (y - cy) * 1.15);
        const rr = r + (vnoise(x / 4, y / 4, 91) - 0.5) * 6;
        if (d < rr) lit = Math.max(lit, (-(x - cx) * 0.6 - (y - cy) * 0.8) / r + (1 - d / rr) * 0.3);
      }
      if (lit < -8) return null;
      return at(AMBER, 1.7 + lit * 2.1 + (vnoise(x / 5, y / 3.5, 92) - 0.5) * 2);
    }),
    0,
    0,
  );
  return outlined(c, INK);
}

/** A paper lantern on its cord, with its dark edge: 7 by 11, hung from (3, 1). */
export function paperLantern(col: string, core: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(5, 9);
  R(g, 2, 0, 1, 2, BARK[0]);
  R(g, 1, 2, 3, 1, BARK[1]);
  R(g, 0, 3, 5, 4, col);
  R(g, 1, 3, 3, 4, core);
  R(g, 2, 4, 1, 2, CREAM);
  R(g, 1, 7, 3, 1, BARK[1]);
  R(g, 2, 8, 1, 1, col);
  return outlined(c, INK);
}
