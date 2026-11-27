/**
 * The clearing's own things, drawn the way the town draws them (`apps/town/src/sprites.ts` and
 * `ground.ts`): rocks, bushes, ferns, stumps, and the redwoods' great trunks.
 */

import { BARK, GOLD, GREEN, INK, STONE } from "@sequoia-leaf/kit/palette.ts";
import { ell, outlined, paint, R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx, hash, makeCanvas, vnoise } from "@sequoia-leaf/kit/util.ts";

import { DEEP, spr, type Sprite, tone } from "./pal.ts";

/** A rock lit from the upper left; `ramp` is its stone, darkest first. */
export function rock(w: number, h: number, seed: number, ramp: readonly string[] = STONE): HTMLCanvasElement {
  return paint(w, h, (x, y) => {
    const d = Math.hypot((x + 0.5 - w / 2) / (w / 2), (y + 0.5 - h * 0.55) / (h * 0.6));
    if (d > 1 + (vnoise(x / 3, y / 3, seed) - 0.5) * 0.25 || y >= h) return null;
    const lit = (-(x - w / 2) / w - (y - h / 2) / h) * 1.6;
    return tone(ramp, 1.4 + lit * 2 + (hash(x >> 1, y >> 1, seed) - 0.5) * 0.9);
  });
}

export function bush(w: number, h: number, seed: number, ramp: readonly string[] = GREEN): Sprite {
  const c = paint(w, h, (x, y) => {
    const cx = w / 2;
    const d = Math.hypot((x - cx) / (w / 2), (y - h * 0.62) / (h * 0.62));
    if (d > 0.94 + (vnoise(x / 3, y / 3, seed) - 0.5) * 0.3 || y >= h - 1 + (x % 3 === 0 ? 0 : 1)) return null;
    const lit = (-(x - cx) / w - (y - h * 0.6) / h) * 1.5;
    return tone(ramp, 2 + lit * 1.6 + (vnoise(x / 4, y / 3, seed + 1) - 0.5) * 1.8);
  });
  return spr(c, Math.round(w / 2), h);
}

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

export function fern(size: number, seed: number, cols: readonly string[] = [GREEN[2], GREEN[3], GREEN[2]]): Sprite {
  const { c, g } = makeCanvas(size * 2 + 6, size + 6);
  drawFern(g, size + 3, size + 4, size, cols, seed);
  R(g, size + 2, size + 4, 3, 1, GREEN[0]);
  return { c, ax: size + 3, ay: size + 5 };
}

/** A cut stump with its rings showing; `drip` hangs amber resin down its side. */
export function stump(seed: number, drip: boolean): HTMLCanvasElement {
  const { c, g } = makeCanvas(12, 11);
  R(g, 1, 4, 10, 6, BARK[2]);
  R(g, 0, 9, 12, 2, BARK[1]);
  for (const x of [3, 6, 9]) R(g, x, 6, 1, 4, BARK[1]);
  ell(g, 6, 3.5, 5.6, 3.6, BARK[4]);
  ell(g, 6, 3.5, 3.6, 2.2, GOLD[0]);
  R(g, 5, 3, 2, 1, BARK[3]);
  if (drip) {
    const at = 2 + Math.floor(hash(seed, 1, 5) * 3);
    R(g, at, 5, 2, 1, GOLD[2]);
    R(g, at, 6, 1, 3, GOLD[1]);
    R(g, at + 1, 6, 1, 2, GOLD[1]);
    R(g, at, 9, 2, 1, GOLD[0]);
    const other = 7 + Math.floor(hash(seed, 2, 5) * 2);
    R(g, other, 6, 1, 2, GOLD[1]);
    R(g, other, 8, 1, 1, GOLD[0]);
  }
  return outlined(c, INK);
}

const TRUNK_RAMP = ["#1c1019", "#2a1519", ...BARK];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * A redwood trunk seen from its foot upwards: round, deeply furrowed, spreading into roots. `dim`
 * is how many rows from the top are lost in the canopy's shade; `fade` rows at the very top thin
 * out to nothing, so that a trunk standing in the yard does not hide what is behind it.
 */
/** How big a trunk `hw` wide and `height` tall is, and where its foot is in its picture (`trunk`). */
export function trunkBox(hw: number, height: number): { w: number; h: number; ax: number; ay: number } {
  const w = (hw + Math.round(hw * 0.5)) * 2 + 4;
  return { w, h: height, ax: Math.round(w / 2), ay: height - 1 };
}

export function trunk(hw: number, height: number, seed: number, dim: number, fade = 0): Sprite {
  const { w, ax, ay } = trunkBox(hw, height);
  return { c: paint(w, height, trunkPixel(hw, height, seed, dim, fade)), ax, ay };
}

/** The colour of each pixel of a trunk's picture (`trunk`), or null where it is clear. */
export function trunkPixel(
  hw: number,
  height: number,
  seed: number,
  dim: number,
  fade = 0,
): (x: number, y: number) => string | null {
  const flare = Math.round(hw * 0.5);
  const rootH = hw * 1.5;
  const { w } = trunkBox(hw, height);
  const cx = w / 2;
  const half = (y: number): number =>
    hw + flare * clamp((y - (height - rootH)) / rootH, 0, 1) ** 2.6 + Math.sin(y * 0.021 + seed) * 1.4;
  const foot = (x: number): number =>
    height - 2 - 3.2 * (0.5 + 0.5 * Math.sin(x * 0.2 + seed * 2.1)) - 2 * (0.5 + 0.5 * Math.sin(x * 0.57 + seed));
  return (x, y) => {
    const hf = half(y);
    const off = Math.abs(x + 0.5 - cx);
    if (off >= hf || y > foot(x)) return null;
    if (y < fade && ((BAYER[(y & 3) * 4 + (x & 3)] ?? 0) + 0.5) / 16 > y / fade) return null;
    const u = (x + 0.5 - cx) / hf;
    let idx = 4.9 - 2.5 * Math.abs(u + 0.28) ** 1.4;
    const stripe = (u * hf) / 6.5 + 0.7 * vnoise(x * 0.09, y * 0.014, seed) + 0.3 * Math.sin(y * 0.03 + seed);
    const f = stripe - Math.floor(stripe);
    if (f < 0.24) idx -= 1.5;
    else if (f > 0.66 && f < 0.86) idx += 0.8;
    idx += (hash(x, y >> 1, seed) - 0.5) * 0.7;
    idx -= clamp((dim - y) / 46, 0, 4);
    if (off > hf - 1.3 || y > foot(x) - 1) idx = Math.min(idx, 1.4);
    return tone(TRUNK_RAMP, idx);
  };
}

/** The dark ferns along the near edge of the clearing, `w` pixels wide: `wide` of them from `from` across, a fern a step. */
export function* nearFerns(w: number, h: number, from = 0, wide = w): Generator<void, HTMLCanvasElement, undefined> {
  const { c, g } = makeCanvas(wide, h);
  g.translate(-from, 0);
  const floor = g.createLinearGradient(0, h * 0.25, 0, h * 0.7);
  floor.addColorStop(0, "rgba(20,31,28,0)");
  floor.addColorStop(1, "rgba(20,31,28,1)");
  g.fillStyle = floor;
  g.fillRect(0, h * 0.25, w, h);
  // A fern reaches less than 48 pixels either way from its foot: those further from the part drawn are left out.
  const shows = (x: number): boolean => x > from - 48 && x < from + wide + 48;
  for (let i = 0; i * 22 < w + 22; i++) {
    const x = 6 + i * 22 + Math.round((hash(i, 2, 84) - 0.5) * 10);
    if (!shows(x)) continue;
    drawFern(g, x, h * 0.55 + Math.round(hash(i, 4, 86) * 8), 18 + hash(i, 3, 85) * 10, [DEEP[1], DEEP[2]], 100 + i);
    yield;
  }
  for (let i = 0; i * 34 < w + 34; i++) {
    const x = i * 34 + Math.round(hash(i, 5, 87) * 16);
    if (!shows(x)) continue;
    drawFern(g, x, h * 0.8 + Math.round(hash(i, 6, 88) * 6), 24 + hash(i, 7, 89) * 8, [DEEP[0], DEEP[1]], 200 + i);
    yield;
  }
  return c;
}
