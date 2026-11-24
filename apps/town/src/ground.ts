/**
 * The big painted pieces, each worked out a pixel at a time and kept: the clearing's floor, the
 * sunset behind the far trees, the enormous trunks, and the ferns along the near edge.
 */

import { BARK, CREAM, EARTH, GOLD, GREEN, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { paint, R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx, hash, makeCanvas, vnoise } from "@sequoia-leaf/kit/util.ts";
import { BOUNDS, gateway, hedgeY, pathD, piece, pondD } from "@sequoia-leaf/town/map/map.ts";

/** The town's edges, in its pixels. */
const LEFT = BOUNDS.x;
const RIGHT = BOUNDS.x + BOUNDS.w;
const TOP = BOUNDS.y;
const FOOT = BOUNDS.y + BOUNDS.h;

const at = (ramp: readonly string[], i: number): string => ramp[clamp(Math.round(i), 0, ramp.length - 1)] ?? "#000000";

/** Deep forest floor, where nobody walks. */
export const DEEP = ["#141f1c", "#19291f", "#1e3324"] as const;

/** Where the floor's picture sits in the world: the town, and the forest floor a way out from it. */
export const GROUND = { x: LEFT - 72, y: TOP + 48, w: BOUNDS.w + 144, h: BOUNDS.h + 24 };

export function paintGround(): HTMLCanvasElement {
  return paint(GROUND.w, GROUND.h, (px, py) => {
    const x = px + GROUND.x;
    const y = py + GROUND.y;
    const top = hedgeY(x);
    if (y < top) return null;
    if (gateway(x) > 0.5) {
      // The crest of the path out, with the last of the sun on it.
      if (y < top + 1) return CREAM;
      if (y < top + 3) return GOLD[1];
      if (y < top + 7) return EARTH[2];
    } else if (y < top + 5) return at(DEEP, (y - top) / 3 + hash(x >> 1, y, 71) * 0.8);
    if (x < LEFT || x >= RIGHT || y > FOOT + 10) return at(DEEP, vnoise(x / 12, y / 9, 72) * 2.4);

    const pd = pondD(x, y);
    if (pd < 0) {
      if (pd > -2.4) return WATER[2];
      if (pd > -11 + vnoise(x / 8, y / 5, 51) * 5) return WATER[1];
      return (y & 3) === 0 && hash(x >> 2, y, 52) > 0.86 ? WATER[1] : WATER[0];
    }
    if (pd < 4.6) {
      if (pd > 3.4) return EARTH[0];
      const peb = hash(x >> 1, y >> 1, 53);
      return peb > 0.9 ? STONE[2] : peb > 0.8 ? STONE[1] : EARTH[2];
    }

    const td = pathD(x, y);
    if (td < 0) {
      if (td > -2.2) return EARTH[0];
      if (hash(x >> 1, y, 43) > 0.994) return STONE[1];
      if (hash(x, y >> 1, 44) > 0.985) return EARTH[0];
      return vnoise(x / 15, y / 8, 41) > 0.62 ? EARTH[2] : EARTH[1];
    }

    // Grass: one green, with lighter and darker drifts lying across it, and shade under the trees
    // that ring the clearing.
    const n = vnoise(x / 34, y / 13, 3);
    let idx = n > 0.7 ? 3 : n < 0.27 ? 1 : 2;
    const edge = Math.min(x - LEFT - 30, RIGHT - 30 - x, (y - TOP - 80) * 1.4, (FOOT - 14 - y) * 1.2);
    if (edge < 6 + vnoise(x / 26, y / 20, 8) * 44) idx -= 1;
    if (td < 1.6) idx -= 1;
    idx = clamp(idx, 0, 3);
    // Tufts: one to a patch of ground at most, never quite in line.
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

// ---------- the sunset ----------

const GATE = piece("gate");

/**
 * The backdrop's picture, the sun at `sunX` across it: it hangs with the sun behind the gate, its row
 * `horizon` at world height `SKYLINE.worldY`.
 */
export const SKYLINE = { w: 760, h: 300, horizon: 252, worldX: GATE.x - 380, worldY: GATE.y - 12, sunX: 380 };

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dither = (x: number, y: number): number => ((BAYER[(y & 3) * 4 + (x & 3)] ?? 0) + 0.5) / 16;

const SKY_STOPS = [0, 0.3, 0.47, 0.6, 0.73, 0.85, 0.94, 1.2];
const CLOUDS: readonly (readonly [number, number, number, number, number])[] = [
  [150, 158, 78, 3, 4],
  [470, 182, 96, 3, 5],
  [330, 128, 58, 2, 3],
  [600, 150, 66, 2, 4],
  [90, 208, 64, 2, 5],
  [660, 214, 70, 2, 6],
];

/** Whether a far trunk stands at this column: trunks are spaced unevenly, never in ranks. */
function farTrunk(x: number, y: number, spacing: number, thin: number, wide: number, seed: number): boolean {
  const flare = Math.max(0, y - (SKYLINE.horizon - 12)) * 0.4;
  for (let k = Math.floor(x / spacing) - 1; k <= Math.floor(x / spacing) + 1; k++) {
    if (hash(k, seed, 61) < 0.18) continue;
    const cx = k * spacing + hash(k, seed, 62) * spacing * 0.6;
    const half = (thin + hash(k, seed, 63) * (wide - thin)) / 2 + flare;
    if (Math.abs(x - cx) < half) return true;
  }
  return false;
}

export function paintBackdrop(): HTMLCanvasElement {
  const { horizon, sunX } = SKYLINE;
  return paint(SKYLINE.w, SKYLINE.h, (x, y) => {
    if (y >= horizon) return DEEP[0];
    // The canopy, hanging in from above, and the far trunks, nearest darkest.
    const canopy = 64 + vnoise(x / 34, 0, 64) * 56 + vnoise(x / 9, 1, 65) * 16 + vnoise(x / 3, y / 3, 66) * 5;
    if (y < canopy) return SKY[0];
    // Nothing stands between the gate and the sun: the far trees part there.
    const open = Math.abs(x - sunX) < 30;
    if (!open && farTrunk(x, y, 58, 13, 24, 2)) return SKY[0];
    if (y < canopy + 13 + vnoise(x / 6, 2, 67) * 9) return SKY[1];
    if (!open && y > horizon - 5 - vnoise(x / 44, 4, 68) * 9) return SKY[1];
    if (!open && farTrunk(x, y, 37, 6, 12, 1)) return SKY[1];

    const sun = Math.hypot(x - sunX, (y - horizon) * 1.05);
    if (sun < 13) return CREAM;
    if (sun < 21) return GOLD[2];
    for (const [cx, cy, rx, ry, col] of CLOUDS) {
      const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (e < 0.75 + vnoise(x / 7, y / 2, 69) * 0.5) return at(SKY, col);
    }
    const v = y / horizon + Math.max(0, 1 - sun / 110) * 0.16;
    let band = 0;
    while (band < SKY_STOPS.length - 2 && v >= (SKY_STOPS[band + 1] ?? 9)) band++;
    const lo = SKY_STOPS[band] ?? 0;
    const hi = SKY_STOPS[band + 1] ?? 1;
    const t = (v - lo) / (hi - lo);
    if (band === 0 && hash(x, y, 70) > 0.9984) return CREAM;
    return at(SKY, t > 0.55 && dither(x, y) < (t - 0.55) / 0.45 ? band + 1 : band);
  });
}

// ---------- the enormous trunks ----------

const TRUNK_RAMP = ["#1c1019", "#2a1519", ...BARK];

export interface Painted {
  c: HTMLCanvasElement;
  /** Where the picture's foot is: this pixel goes on the trunk's spot in the world. */
  ax: number;
  ay: number;
}

/**
 * How far a trunk's bark reaches either side of its middle on row `y` of its picture (`paintTrunk`):
 * `hw` up the trunk, spreading into the roots near the foot.
 */
export function trunkHalf(hw: number, height: number, seed: number, y: number): number {
  const flare = Math.round(hw * 0.5);
  const rootH = hw * 1.5;
  return hw + flare * clamp((y - (height - rootH)) / rootH, 0, 1) ** 2.6 + Math.sin(y * 0.021 + seed) * 1.4;
}

/** The great trunks round the clearing, by their look in the map: half their width above the roots, and their bark's seed. */
export const TRUNKS: readonly { hw: number; seed: number }[] = [
  { hw: 44, seed: 1 },
  { hw: 26, seed: 2 },
  { hw: 26, seed: 3 },
  { hw: 44, seed: 4 },
  { hw: 40, seed: 5 },
  { hw: 40, seed: 6 },
  { hw: 44, seed: 7 },
  { hw: 46, seed: 8 },
];

/** How tall a trunk's picture is, by the y of its foot: from there to well past the top of the map. */
export const trunkTall = (y: number): number => y + 210;

/**
 * A redwood trunk seen from its foot upwards: round, deeply furrowed, spreading into roots.
 * `dim` is how many rows from the top are lost in the canopy's shade; `above` more rows of it
 * go on over its top, further into that shade.
 */
export function paintTrunk(hw: number, height: number, seed: number, dim: number, above = 0): Painted {
  const flare = Math.round(hw * 0.5);
  const w = (hw + flare) * 2 + 4;
  const cx = w / 2;
  const foot = (x: number): number =>
    height - 2 - 3.2 * (0.5 + 0.5 * Math.sin(x * 0.2 + seed * 2.1)) - 2 * (0.5 + 0.5 * Math.sin(x * 0.57 + seed));
  const c = paint(w, height + above, (x, row) => {
    const y = row - above;
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
  return { c, ax: Math.round(cx), ay: height + above - 1 };
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

/** The dark ferns along the near edge, drawn over everything that walks. */
export const NEAR = { x: LEFT - 72, y: FOOT - 34, w: BOUNDS.w + 144, h: 106 };

export function paintNear(): HTMLCanvasElement {
  const { c, g } = makeCanvas(NEAR.w, NEAR.h);
  const floor = g.createLinearGradient(0, 30, 0, 70);
  floor.addColorStop(0, "rgba(20,31,28,0)");
  floor.addColorStop(1, "rgba(20,31,28,1)");
  g.fillStyle = floor;
  g.fillRect(0, 30, NEAR.w, NEAR.h - 30);
  for (let i = 0; i < Math.ceil(NEAR.w / 22); i++) {
    const x = 6 + i * 22 + Math.round((hash(i, 2, 84) - 0.5) * 10);
    const tall = 20 + hash(i, 3, 85) * 12;
    drawFern(g, x, 56 + Math.round(hash(i, 4, 86) * 8), tall, [DEEP[1], DEEP[2]], 100 + i);
  }
  for (let i = 0; i < Math.ceil(NEAR.w / 34); i++) {
    const x = i * 34 + Math.round(hash(i, 5, 87) * 16);
    drawFern(g, x, 78 + Math.round(hash(i, 6, 88) * 6), 26 + hash(i, 7, 89) * 10, [DEEP[0], DEEP[1]], 200 + i);
  }
  return c;
}
