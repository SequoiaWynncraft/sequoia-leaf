/**
 * An indexed pixel surface, sprites drawn from pixel strings, and stepped light.
 *
 * Pixels are palette indices of 16 bits (`ramp * 8 + level`, see palette.ts), so the world and the
 * cast share one palette, one light and one recolouring for the time of day and the season.
 */

import { type Lut, WORLD_RAMPS } from "./palette.ts";

/** The first character index: the cast keeps its own colours under a rarity's light. */
const CHARACTERS = WORLD_RAMPS * 8;

/** Palette indices, one per pixel. 0 is transparent. */
export type Indices = Uint16Array;

/** A small picture in palette indices. Index 0 is transparent. */
export interface Sprite {
  readonly w: number;
  readonly h: number;
  readonly data: Indices;
}

export function sprite(w: number, h: number): Sprite {
  return { w, h, data: new Uint16Array(Math.max(0, w * h)) };
}

/**
 * A sprite from rows of characters, one character per pixel. `legend` maps characters to palette
 * indices; "." and " " are transparent. Rows may differ in length; the widest sets the width.
 */
export function fromRows(rows: readonly string[], legend: Readonly<Record<string, number>>): Sprite {
  const w = Math.max(...rows.map((r) => r.length));
  const out = sprite(w, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] ?? ".";
      if (ch === "." || ch === " ") continue;
      const index = legend[ch];
      if (index === undefined) throw new Error(`no colour for "${ch}" in sprite row ${y}: ${row}`);
      out.data[y * w + x] = index;
    }
  });
  return out;
}

export interface BlitOptions {
  /** Mirror left to right. Only for things that are honestly the same both ways round, never for art variety. */
  flip?: boolean;
  /** Replace every opaque pixel with this index (a silhouette). */
  solid?: number;
  /** Map each index through this table first (`PALETTE_SIZE` entries). */
  map?: Indices;
}

export class Surface {
  readonly w: number;
  readonly h: number;
  readonly data: Indices;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint16Array(w * h);
  }

  copyFrom(other: Surface): void {
    this.data.set(other.data);
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x] ?? 0;
  }

  set(x: number, y: number, index: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (index === 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = index;
  }

  rect(x: number, y: number, w: number, h: number, index: number): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) this.data.fill(index, yy * this.w + x0, yy * this.w + x1);
  }

  hline(x0: number, x1: number, y: number, index: number): void {
    this.rect(Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, index);
  }

  blit(s: Sprite, x: number, y: number, opts: BlitOptions = {}): void {
    x = Math.round(x);
    y = Math.round(y);
    for (let sy = 0; sy < s.h; sy++) {
      const ty = y + sy;
      if (ty < 0 || ty >= this.h) continue;
      for (let sx = 0; sx < s.w; sx++) {
        const tx = x + sx;
        if (tx < 0 || tx >= this.w) continue;
        let v = s.data[sy * s.w + (opts.flip ? s.w - 1 - sx : sx)] ?? 0;
        if (v === 0) continue;
        if (opts.map) v = opts.map[v] ?? v;
        if (opts.solid !== undefined) v = opts.solid;
        this.data[ty * this.w + tx] = v;
      }
    }
  }

  /** Lays another surface over this one, from row `fromRow` down; its index 0 is transparent. */
  overlay(top: Surface, fromRow = 0): void {
    const a = this.data;
    const b = top.data;
    for (let i = Math.max(0, Math.round(fromRow)) * top.w; i < b.length; i++) {
      const v = b[i] ?? 0;
      if (v) a[i] = v;
    }
  }

  /** Draws only over pixels whose current index passes `where`, as stars only show in open sky. */
  setWhere(x: number, y: number, index: number, where: (current: number) => boolean): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (where(this.data[i] ?? 0)) this.data[i] = index;
  }
}

/** Ordered 4x4 Bayer thresholds in [0, 1), for dithering only where a soft edge helps. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x: number, y: number): number => BAYER[(y & 3) * 4 + (x & 3)] ?? 0.5;

/** Warm light in steps 0 to 3, as the welcome lantern's stepped pools. */
export class Light {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h);
  }

  clear(): void {
    this.data.fill(0);
  }

  /**
   * A pool of light: `strength` steps at the centre falling to none at `radius`, squashed
   * vertically by `squash`, with a dithered pixel between steps so the pool has no hard ring.
   */
  pool(cx: number, cy: number, radius: number, strength: number, squash = 1): void {
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + radius));
    const ry = radius / squash;
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + ry));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x - cx) / radius;
        const dy = ((y - cy) * squash) / radius;
        // Band edges wander a little with the angle, so a pool is round but never a perfect ring.
        const a = Math.atan2(dy, dx);
        const lump = 1 + 0.06 * Math.sin(a * 5 + cx * 0.13) + 0.04 * Math.sin(a * 9 + cy * 0.21);
        const d = Math.sqrt(dx * dx + dy * dy) / lump;
        if (d >= 1) continue;
        const v = strength * (1 - d) * 1.1 + 0.15;
        let level = Math.min(3, Math.floor(v));
        // Only the pool's outer edge is softened, with a one-pixel checker, where it meets the dark.
        if (level === 1 && v - 1 < 0.22 && (x + y) % 2 === 0) level = 0;
        if (level <= 0) continue;
        const i = y * this.w + x;
        if (level > (this.data[i] ?? 0)) this.data[i] = level;
      }
    }
  }
}

/**
 * Indices through the light-level tables into RGBA pixels: one pass for the world and the cast. `rare`
 * is a second, coloured light: the rarity's glow in a cone reveal, mixed toward `rareRgb` a step at a
 * time, over the world only, so a spirit stepping out of the cone keeps its own colours.
 */
export function compose(
  surface: Surface,
  light: Light,
  lut: Lut,
  out: Uint32Array,
  rare?: Light,
  rareRgb?: readonly [number, number, number],
): void {
  const { data } = surface;
  const lights = light.data;
  const l0 = lut.levels[0];
  const l1 = lut.levels[1];
  const l2 = lut.levels[2];
  const l3 = lut.levels[3];
  if (!l0 || !l1 || !l2 || !l3) return;
  const tables = [l0, l1, l2, l3];
  for (let i = 0; i < data.length; i++) {
    const table = tables[lights[i] ?? 0] ?? l0;
    out[i] = table[data[i] ?? 0] ?? 0;
  }
  if (!rare || !rareRgb) return;
  const rd = rare.data;
  for (let i = 0; i < rd.length; i++) {
    const k = rd[i] ?? 0;
    if (!k || (data[i] ?? 0) >= CHARACTERS) continue;
    const v = out[i] ?? 0;
    const f = 0.17 * k;
    const r = (v & 255) + (rareRgb[0] - (v & 255)) * f + 10 * k;
    const g = ((v >> 8) & 255) + (rareRgb[1] - ((v >> 8) & 255)) * f + 10 * k;
    const b = ((v >> 16) & 255) + (rareRgb[2] - ((v >> 16) & 255)) * f + 10 * k;
    out[i] =
      (0xff000000 |
        (Math.min(255, Math.round(b)) << 16) |
        (Math.min(255, Math.round(g)) << 8) |
        Math.min(255, Math.round(r))) >>>
      0;
  }
}
