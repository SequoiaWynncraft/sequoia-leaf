/**
 * Our own 16×16 block textures, painted in code from the ramps in palette.ts, packed into one atlas.
 * Each tile sits in a 32×32 cell surrounded by a wrapped copy of itself, so nearest mipmaps never bleed.
 */
import { CanvasTexture, NearestFilter, NearestMipmapNearestFilter, NoColorSpace, RepeatWrapping } from "three";
import {
  ASH,
  BARK,
  CHAR,
  CONE,
  DIRT,
  FERN,
  FIRE,
  FLOWER,
  FOLIAGE,
  FOLIAGE_WINTER,
  GLASS,
  GRASS,
  hex,
  IRON,
  LITTER,
  MOSS,
  MUSHROOM,
  type Rgb,
  SNOW,
  STONE,
  WOOD,
} from "./palette.ts";
import { clamp, hash2, tileNoise } from "./rng.ts";

export const ATLAS = 512;
export const CELL = 32;
const PER_ROW = ATLAS / CELL;

/** A 16×16 RGBA pixel grid. */
export class Px {
  readonly data: Uint8ClampedArray;
  readonly w: number;
  readonly h: number;
  constructor(w = 16, h = 16) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: Rgb, a = 255): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }
  /** Sets with wrap-around, for tiling textures. */
  wset(x: number, y: number, c: Rgb, a = 255): void {
    this.set(((x % this.w) + this.w) % this.w, ((y % this.h) + this.h) % this.h, c, a);
  }
  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3] ?? 0;
  }
  rgb(x: number, y: number): Rgb {
    const i = (y * this.w + x) * 4;
    return [this.data[i] ?? 0, this.data[i + 1] ?? 0, this.data[i + 2] ?? 0];
  }
  fill(c: Rgb, a = 255): void {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c, a);
  }
  copy(): Px {
    const p = new Px(this.w, this.h);
    p.data.set(this.data);
    return p;
  }
}

const at = (r: readonly Rgb[], i: number): Rgb => r[clamp(Math.round(i), 0, r.length - 1)] ?? [255, 0, 255];
const wrap16 = (v: number): number => ((v % 16) + 16) % 16;
/** Signed shortest offset on a 16-pixel torus. */
const tor = (d: number): number => {
  const w = wrap16(d);
  return w > 8 ? w - 16 : w;
};

// ---------------------------------------------------------------- bark

/** Vertical furrows that wander a pixel, ridges with fibrous streaks, and the odd horizontal split. */
function barkSide(v: number, moss: number, palette: readonly Rgb[] = BARK): Px {
  const p = new Px();
  const salt = 100 + v * 17;
  const bases = [
    [0, 4, 8, 11],
    [1, 5, 10, 13],
    [2, 6, 9, 13],
  ][v % 3] ?? [0, 4, 8, 11];
  const phase = bases.map((_, i) => hash2(i, v, salt) * Math.PI * 2);
  const amp = bases.map((_, i) => (hash2(i, v, salt + 1) < 0.55 ? 1 : 0.55));
  const furrowAt = (y: number) => bases.map((b, i) => wrap16(b + Math.round((amp[i] ?? 1) * Math.sin((Math.PI * 2 * y) / 16 + (phase[i] ?? 0)))));
  const ridgeS: number[] = [];
  for (let y = 0; y < 16; y++) {
    const fs = furrowAt(y);
    for (let x = 0; x < 16; x++) {
      let dl = 99;
      let dr = 99;
      let which = 0;
      fs.forEach((f, i) => {
        const l = wrap16(x - f);
        const r = wrap16(f - x);
        if (l < dl) {
          dl = l;
          which = i;
        }
        if (r < dr && r > 0) dr = r;
      });
      if (dl === 0) {
        const deep = Math.sin((Math.PI * 4 * y) / 16 + (phase[which] ?? 0) * 1.7) > 0.25;
        p.set(x, y, at(palette, deep ? 0 : 1));
        ridgeS[y * 16 + x] = -1;
        continue;
      }
      const width = dl + dr;
      const s = dl / width;
      ridgeS[y * 16 + x] = s;
      const fibre = tileNoise(x * 1.0, y * 0.25, 16, salt + 5);
      let idx = 3;
      if (dl === 1) idx = 4;
      else if (s < 0.45) idx = fibre > 0.45 ? 4 : 3;
      if (dr === 1) idx = 2;
      if (fibre > 0.7) idx += 1;
      if (fibre < 0.22) idx -= 1;
      if (s > 0.15 && s < 0.5 && fibre > 0.82) idx = 6;
      p.set(x, y, at(palette, idx));
    }
  }
  // Horizontal splits: a dark nick with a chipped light edge above it.
  for (let k = 0; k < 2; k++) {
    const row = Math.floor(hash2(k, v, salt + 9) * 16);
    const fs = furrowAt(row);
    const col = wrap16((fs[(k * 2 + v) % fs.length] ?? 0) + 1);
    p.wset(col, row, at(palette, 1));
    p.wset(col + 1, row, at(palette, 1));
    p.wset(col, row - 1, at(palette, 5));
  }
  if (moss > 0) mossOver(p, ridgeS, moss, salt);
  return p;
}

/** Moss settles on ridge tops, thicker toward the bottom of the block. */
function mossOver(p: Px, ridgeS: number[], level: number, salt: number): void {
  const mask: boolean[] = [];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const s = ridgeS[y * 16 + x] ?? -1;
      const n = tileNoise(x / 4, y / 4, 4, salt + 21) * 0.7 + tileNoise(x / 2, y / 2, 8, salt + 22) * 0.3;
      const threshold = level >= 2 ? 0.5 - y * 0.012 : 0.64 - y * 0.006;
      mask[y * 16 + x] = s >= 0 && n > threshold;
    }
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (!mask[y * 16 + x]) continue;
      const above = mask[wrap16(y - 1) * 16 + x];
      const below = mask[wrap16(y + 1) * 16 + x];
      const left = mask[y * 16 + wrap16(x - 1)];
      let idx = 2;
      if (!above || !left) idx = 3;
      if (!above && !left) idx = 3.6;
      if (!below) idx = 0.6;
      if (hash2(x, y, salt + 23) > 0.85) idx -= 1;
      p.set(x, y, at(MOSS, idx));
    }
}

/** A log end: bark rim, cinnamon heartwood rings, dark pith. */
function logEnd(): Px {
  const p = new Px();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) * 0.55 + Math.hypot(x - 7.5, y - 7.5) * 0.45;
      if (d > 7.1) p.set(x, y, at(BARK, hash2(x, y, 3) > 0.5 ? 2 : 1));
      else if (d > 6.2) p.set(x, y, at(BARK, 3));
      else if (d < 1.2) p.set(x, y, at(BARK, 2));
      else p.set(x, y, at(BARK, Math.floor(d) % 2 === 0 ? 6 : 5));
    }
  return p;
}

// ---------------------------------------------------------------- foliage

interface Spray {
  x: number;
  y: number;
  len: number;
  hw: number;
  a: number;
  depth: number;
}

/** Drooping sprays laid out on a jittered grid, back ones first. */
function sprays(v: number): Spray[] {
  const out: Spray[] = [];
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 3; i++) {
      const k = j * 3 + i;
      const side = hash2(k, v, 55) < 0.5 ? -1 : 1;
      out.push({
        x: (i + 0.5) * (16 / 3) + (hash2(k, v, 51) - 0.5) * 3 + (j % 2) * 2.4,
        y: j * 4 + (hash2(k, v, 52) - 0.5) * 2 - 1,
        len: 5.2 + hash2(k, v, 53) * 2.4,
        hw: 1.55 + hash2(k, v, 56) * 0.6,
        a: Math.PI / 2 + side * (0.45 + hash2(k, v, 54) * 0.5),
        depth: hash2(k, v, 57),
      });
    }
  return out.sort((a, b) => a.depth - b.depth);
}

/** Sequoia foliage: overlapping feathery sprays with needle-serrated edges, lit from the top left, gaps between them. */
function foliage(v: number, palette: readonly Rgb[], snow: "none" | "top" | "side" = "none"): Px {
  const p = new Px();
  const list = sprays(v);
  const lightOf: number[] = new Array(256).fill(-9);
  const cover: number[] = new Array(256).fill(0);
  for (const s of list) {
    const ca = Math.cos(s.a);
    const sa = Math.sin(s.a);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const dx = tor(x + 0.5 - s.x);
        const dy = tor(y + 0.5 - s.y);
        const u = dx * ca + dy * sa;
        const w = -dx * sa + dy * ca;
        if (u < -0.5 || u > s.len) continue;
        const t = Math.max(0, u) / s.len;
        const half = s.hw * Math.min(1, (u + 0.9) / 1.6) * Math.sqrt(Math.max(0, 1 - t * t));
        const aw = Math.abs(w);
        if (aw > half + 0.35) continue;
        // Needle serration: the outermost ring of each spray alternates along its length.
        const serrate = aw > half - 0.6 && (Math.round(u) + (w > 0 ? 1 : 0)) % 2 === 1;
        if (serrate && t > 0.55) continue;
        // The spray's upper edge faces the light (screen up-left), the lower edge falls into shade.
        const up = -(w * ca) - w * sa * 0.2;
        const facing = Math.sign(-dy * 0.6 - dx * 0.4 + 0.0001);
        let idx = 3.4 + (s.depth - 0.5) * 1.6;
        idx += clamp(-w / Math.max(0.8, half), -1, 1) * Math.sign(ca === 0 ? 1 : -ca) * 0.9;
        if (aw < 0.5 && u > 0.5) idx -= 0.9;
        if (t > 0.72) idx += 1.1;
        if (aw > half - 0.6) idx += facing * 0.6 + up * 0;
        if (serrate) idx -= 1.2;
        const i = y * 16 + x;
        cover[i] = 1;
        lightOf[i] = idx;
        p.set(x, y, at(palette, idx));
      }
  }
  // Fill tight crevices with deep shade; open gaps stay see-through.
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const i = y * 16 + x;
      if (cover[i]) continue;
      let n = 0;
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        n += cover[wrap16(y + oy) * 16 + wrap16(x + ox)] ?? 0;
      if (n >= 3) p.set(x, y, at(palette, 1));
      else p.set(x, y, at(palette, 3), 0);
    }
  for (let i = 0; i < 256; i++) {
    const x = i % 16;
    const y = Math.floor(i / 16);
    if (cover[i] && (lightOf[i] ?? 0) > 4.4 && hash2(x, y, v + 70) > 0.55) p.set(x, y, at(palette, 7));
  }
  if (snow === "top") {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (p.alpha(x, y) === 0) continue;
        const n = tileNoise(x / 4, y / 4, 4, 88 + v);
        if ((lightOf[y * 16 + x] ?? -9) > 3.2 + (0.5 - n)) {
          const below = (lightOf[wrap16(y + 1) * 16 + x] ?? -9) > 3.2 + (0.5 - tileNoise(x / 4, (y + 1) / 4, 4, 88 + v));
          p.set(x, y, at(SNOW, !below ? 2 : hash2(x, y, 4) > 0.9 ? 6 : 4));
        }
      }
  } else if (snow === "side") {
    for (let x = 0; x < 16; x++) {
      const depth = 1 + Math.round(tileNoise(x / 4, 0.5, 4, 91 + v) * 2.2);
      for (let y = 0; y < depth; y++) {
        if (p.alpha(x, y) === 0) continue;
        p.set(x, y, at(SNOW, y === depth - 1 ? 2 : 4));
      }
    }
  }
  return p;
}

// ---------------------------------------------------------------- ground

function grassTop(v: number): Px {
  const p = new Px();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const n = 0.6 * tileNoise(x / 4, y / 4, 4, 200 + v) + 0.4 * tileNoise(x / 2, y / 2, 8, 210 + v);
      p.set(x, y, at(GRASS, 2 + Math.floor(n * 3.3)));
    }
  // Tufts: a lit blade tip with its own shadow below and to the right.
  for (let k = 0; k < 11; k++) {
    const x = Math.floor(hash2(k, v, 220) * 16);
    const y = Math.floor(hash2(k, v, 221) * 16);
    p.wset(x, y, at(GRASS, hash2(k, v, 222) > 0.6 ? 6 : 5));
    p.wset(x + 1, y + 1, at(GRASS, 1));
    if (hash2(k, v, 223) > 0.5) p.wset(x - 1, y + 1, at(GRASS, 4));
  }
  return p;
}

function dirt(v: number, palette: readonly Rgb[] = DIRT): Px {
  const p = new Px();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const n = 0.55 * tileNoise(x / 4, y / 4, 4, 300 + v) + 0.45 * tileNoise(x / 2, y / 2, 8, 310 + v);
      p.set(x, y, at(palette, 1 + Math.floor(n * 3.6)));
    }
  for (let k = 0; k < 4; k++) {
    const x = Math.floor(hash2(k, v, 320) * 16);
    const y = Math.floor(hash2(k, v, 321) * 16);
    const pebble = hash2(k, v, 322) > 0.5 ? STONE : palette;
    p.wset(x, y, at(pebble, 5));
    p.wset(x + 1, y, at(pebble, 4));
    p.wset(x, y + 1, at(palette, 0));
    p.wset(x + 1, y + 1, at(palette, 0));
  }
  return p;
}

/** Depth of the grass lip per column: irregular, never a stamped zigzag. */
const LIP = [3, 2, 2, 3, 4, 3, 2, 2, 3, 2, 3, 5, 3, 2, 2, 3];

function grassSide(v: number): Px {
  const p = dirt(v);
  for (let x = 0; x < 16; x++) {
    const depth = LIP[(x + v * 5) % 16] ?? 3;
    for (let y = 0; y < depth; y++) {
      let idx = 3;
      if (y === 0) idx = hash2(x, v, 400) > 0.4 ? 5 : 4;
      else if (y === depth - 1) idx = 1;
      else if (hash2(x, y, 401 + v) > 0.7) idx = 4;
      p.set(x, y, at(GRASS, idx));
    }
  }
  return p;
}

function snowSide(v: number): Px {
  const p = dirt(v);
  for (let x = 0; x < 16; x++) {
    const depth = (LIP[(x * 3 + v * 5) % 16] ?? 3) + 1;
    for (let y = 0; y < depth; y++) p.set(x, y, at(SNOW, y === 0 ? 5 : y === depth - 1 ? 1 : 4 - (hash2(x, y, 410) > 0.8 ? 1 : 0)));
  }
  return p;
}

function snowTop(v: number): Px {
  const p = new Px();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const n = tileNoise(x / 4, y / 4, 4, 500 + v);
      let idx = n > 0.55 ? 5 : 4;
      if (n < 0.22) idx = 3;
      if (hash2(x, y, 501 + v) > 0.965) idx = 6;
      p.set(x, y, at(SNOW, idx));
    }
  return p;
}

/** Cinnamon needle duff: short strokes of fallen needles over dark earth, a green sprig or two. */
function litter(v: number): Px {
  const p = new Px();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const n = tileNoise(x / 4, y / 4, 4, 600 + v);
      p.set(x, y, at(LITTER, 1 + Math.floor(n * 2.4)));
    }
  const dirs: [number, number][] = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(hash2(k, v, 610) * 16);
    const y = Math.floor(hash2(k, v, 611) * 16);
    const d = dirs[Math.floor(hash2(k, v, 612) * 4)] ?? [1, 0];
    const len = 2 + Math.floor(hash2(k, v, 613) * 3);
    const tone = 3 + Math.floor(hash2(k, v, 614) * 2);
    for (let s = 0; s < len; s++) p.wset(x + d[0] * s, y + d[1] * s, at(LITTER, s === 0 ? tone + 1 : tone));
    p.wset(x + d[0] * len, y + d[1] * len + 1, at(LITTER, 0));
  }
  for (let k = 0; k < 2; k++) {
    const x = Math.floor(hash2(k, v, 620) * 16);
    const y = Math.floor(hash2(k, v, 621) * 16);
    p.wset(x, y, at(MOSS, 3));
    p.wset(x + 1, y, at(MOSS, 2));
  }
  return p;
}

/** Moss cushions: Voronoi pads lit from the top left with dark seams. */
function moss(v: number): Px {
  const p = new Px();
  const seeds = Array.from({ length: 7 }, (_, k) => [hash2(k, v, 700) * 16, hash2(k, v, 701) * 16] as const);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let best = 99;
      let second = 99;
      let bx = 0;
      let by = 0;
      for (const [sx, sy] of seeds) {
        const dx = tor(x + 0.5 - sx);
        const dy = tor(y + 0.5 - sy);
        const d = Math.hypot(dx, dy);
        if (d < best) {
          second = best;
          best = d;
          bx = dx;
          by = dy;
        } else if (d < second) second = d;
      }
      let idx = 3 + (-(bx + by) / 5) * 1.4;
      if (second - best < 0.9) idx = 1;
      p.set(x, y, at(MOSS, idx));
    }
  return p;
}

/** Warm layered stone: wandering strata seams, the odd vertical crack, a few speckles. */
function stone(v: number, mossy: number): Px {
  const p = new Px();
  const seams = [3, 7, 12].map((r, i) => r + Math.floor(hash2(i, v, 800) * 2));
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const band = seams.filter((s) => s <= y).length;
      const n = tileNoise(x / 4, y / 2, 4, 810 + v + band);
      let idx = (band % 2 === 0 ? 4 : 3) + (n > 0.65 ? 1 : n < 0.25 ? -1 : 0);
      for (const s of seams) {
        const wob = Math.round(Math.sin((x / 16) * Math.PI * 2 + s + v) * 0.7);
        if (y === s + wob && hash2(x, s, 820 + v) > 0.15) idx = 1;
        if (y === s + wob + 1 && hash2(x, s, 821 + v) > 0.4) idx = Math.max(idx, 5);
      }
      p.set(x, y, at(STONE, idx));
    }
  for (let k = 0; k < 2; k++) {
    const x = Math.floor(hash2(k, v, 830) * 16);
    const y = Math.floor(hash2(k, v, 831) * 16);
    for (let s = 0; s < 3; s++) p.wset(x + (s === 2 ? 1 : 0), y + s, at(STONE, 1));
  }
  if (mossy > 0) {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const n = tileNoise(x / 4, y / 4, 4, 840 + v);
        const t = mossy >= 2 ? 0.3 + y * 0.03 : 0.5 + y * 0.03;
        if (n > t) p.set(x, y, at(MOSS, n - t > 0.12 ? (y < 4 ? 4 : 3) : 2));
      }
  }
  return p;
}

/** Rounded boulder faces: big soft cobbles lit from the top left. */
function boulder(v: number, mossy: boolean): Px {
  const p = new Px();
  const seeds = Array.from({ length: 5 }, (_, k) => [((k % 3) + 0.5) * 5.3 + (hash2(k, v, 900) - 0.5) * 3, (Math.floor(k / 2) + 0.5) * 5.3 + (hash2(k, v, 901) - 0.5) * 3] as const);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let best = 99;
      let second = 99;
      let bx = 0;
      let by = 0;
      for (const [sx, sy] of seeds) {
        const dx = tor(x + 0.5 - sx);
        const dy = tor(y + 0.5 - sy);
        const d = Math.hypot(dx, dy);
        if (d < best) {
          second = best;
          best = d;
          bx = dx;
          by = dy;
        } else if (d < second) second = d;
      }
      const lit = clamp(-(bx + by) / 6, -1, 1);
      let idx = 4 + lit * 1.5;
      if (second - best < 1.1) idx = 1.5;
      if (hash2(x, y, 902 + v) > 0.93) idx -= 1;
      p.set(x, y, at(STONE, idx));
      if (mossy) {
        const n = tileNoise(x / 4, y / 4, 4, 910 + v);
        if (n > 0.42 + y * 0.022 && second - best >= 1.1) p.set(x, y, at(MOSS, 3 + lit * 1.5));
      }
    }
  return p;
}

/** Charred bark from an old fire scar: alligator blocks of charcoal with a little cinnamon at the seams. */
function charred(v: number): Px {
  const p = new Px();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const row = Math.floor((y + (Math.floor((x + v * 3) / 4) % 2) * 2) / 4);
      const cx = (x + v * 3) % 4;
      const cy = (y + (Math.floor((x + v * 3) / 4) % 2) * 2) % 4;
      let idx = 2 + (cx === 0 || cy === 0 ? -1 : 0) + (cx === 1 && cy === 1 ? 1 : 0);
      if (cx === 0 && hash2(x, row, 950 + v) > 0.82) idx = 4;
      p.set(x, y, at(CHAR, idx));
    }
  return p;
}

function wood(): Px {
  const p = new Px();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const n = tileNoise(x * 0.9, y / 5, 16, 960);
      p.set(x, y, at(WOOD, 2 + Math.floor(n * 3) - (x % 4 === 0 ? 1 : 0)));
    }
  return p;
}

// ---------------------------------------------------------------- props

/** Cone scales in offset rows: each scale a rounded tab, lit at its upper edge, a dark seam beneath. */
function coneScales(): Px {
  const p = new Px();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const row = Math.floor(y / 4);
      const sy = y % 4;
      const sx = (x + (row % 2) * 2) % 4;
      let idx = 4;
      if (sy === 3) idx = sx === 0 || sx === 3 ? 0 : 1;
      else if (sx === 0) idx = 2;
      else if (sy === 0) idx = sx === 1 ? 6 : 5;
      else if (sy === 1 && sx === 1) idx = 5;
      else if (sx === 3) idx = 3;
      p.set(x, y, at(CONE, idx));
    }
  return p;
}

function flame(frame: number): Px {
  const p = new Px();
  p.fill(FIRE[1] ?? [0, 0, 0], 0);
  const tongues = [
    { x: 4.5, h: 9, ph: 0.0 },
    { x: 8.0, h: 14, ph: 1.7 },
    { x: 11.5, h: 10, ph: 3.1 },
    { x: 6.5, h: 6, ph: 4.4 },
  ];
  for (let x = 0; x < 16; x++) {
    let height = 0;
    let lean = 0;
    for (const t of tongues) {
      const h = t.h * (0.82 + 0.18 * Math.sin(frame * 1.6 + t.ph));
      const dx = x + 0.5 - (t.x + Math.sin(frame * 1.6 + t.ph) * 0.6);
      const g = h * Math.max(0, 1 - (dx * dx) / 7);
      if (g > height) {
        height = g;
        lean = dx;
      }
    }
    const top = Math.round(height);
    for (let k = 0; k < top; k++) {
      const y = 15 - k;
      const t = k / Math.max(1, top);
      const centre = 1 - Math.min(1, Math.abs(lean) / 2.5);
      let idx = 6 - t * 4.2 + centre * 0.9 - (k === top - 1 ? 1 : 0);
      if (k < 2) idx = 5;
      p.set(x, y, at(FIRE, idx));
    }
  }
  if (frame % 2 === 0) p.set(5 + frame, 2 + frame, at(FIRE, 5));
  else p.set(11 - frame, 4, at(FIRE, 4));
  return p;
}

function embers(frame: number): Px {
  const p = new Px();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const n = tileNoise(x / 4, y / 4, 4, 1000);
      const glow = n + 0.18 * Math.sin(frame * 1.9 + x * 0.7 + y * 1.3);
      if (glow > 0.62) p.set(x, y, at(FIRE, glow > 0.78 ? 5 : 4));
      else if (glow > 0.48) p.set(x, y, at(FIRE, 2));
      else p.set(x, y, at(ASH, 1 + Math.floor(n * 3)));
    }
  return p;
}

/** The lantern's side: an iron frame round warm glass, a brighter core. */
function lanternSide(): Px {
  const p = new Px();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const frame = x === 0 || x === 15 || y === 0 || y === 15 || x === 7 || x === 8;
      if (frame) {
        p.set(x, y, at(IRON, x === 0 || y === 0 ? 3 : 1));
        continue;
      }
      const d = Math.hypot((x - 7.5) / 7, (y - 9) / 8);
      p.set(x, y, at(GLASS, 5 - d * 4.5));
    }
  return p;
}

function iron(): Px {
  const p = new Px();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, at(IRON, (x + y) % 5 === 0 ? 3 : y < 2 ? 3 : 2));
  return p;
}

/** Beaten copper for the watering can: warm bands with a bright lip. */
function copper(): Px {
  const p = new Px();
  const ramp = [hex("#5a2a18"), hex("#8a4428"), hex("#b0623a"), hex("#cf8450"), hex("#eeb27a")];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let idx = 2 + (y < 2 ? 2 : y > 12 ? -1 : 0) + ((x + y * 3) % 7 === 0 ? 1 : 0) - (x % 5 === 4 ? 1 : 0);
      if (x === 2 && y > 2 && y < 12) idx = 4;
      p.set(x, y, at(ramp, idx));
    }
  return p;
}

function solid(c: Rgb, edge?: Rgb): Px {
  const p = new Px();
  p.fill(c);
  if (edge) for (let i = 0; i < 16; i++) p.set(i, 15, edge);
  return p;
}

// ---------------------------------------------------------------- plants (crossed quads)

/** A sword fern: lance-shaped fronds arching from the crown, saw-edged with leaflets, a darker midrib, lit tips. */
function fern(v: number): Px {
  const p = new Px();
  p.fill(FERN[3] ?? [0, 0, 0], 0);
  const fronds = v === 0 ? [-1.2, -0.62, -0.05, 0.55, 1.15] : [-1.0, -0.38, 0.28, 0.92];
  // Back fronds first so the front ones overlap them.
  const order = fronds.map((a, i) => ({ a, i })).sort((p1, p2) => Math.abs(p2.a) - Math.abs(p1.a));
  for (const { a: angle, i: fi } of order) {
    const len = 13 - Math.abs(angle) * 2.6 + (fi % 2) * 0.8;
    for (let s = 0.5; s <= len; s += 0.5) {
      const t = s / len;
      const a = angle * (0.4 + t * 0.95);
      const cx = 7.5 + Math.sin(a) * s;
      const cy = 15.5 - Math.cos(a) * s + t * t * Math.abs(angle) * 2.4;
      const half = 2.3 * Math.sin(Math.PI * Math.min(1, t * 1.08)) ** 0.7;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      const saw = Math.floor(s * 2) % 3 === 0 ? 0.8 : 0;
      for (let k = -half + saw; k <= half - saw; k += 0.5) {
        const x = Math.round(cx + nx * k);
        const y = Math.round(cy + ny * k * 0.6 - Math.abs(k) * 0.35);
        const upper = k * (angle >= 0 ? -1 : 1) > 0;
        let idx = upper ? 4 : 3;
        if (Math.abs(k) < 0.5) idx = 2;
        if (t > 0.78) idx += 1;
        if (Math.abs(angle) > 1) idx -= 0.6;
        p.set(x, y, at(FERN, idx));
      }
    }
  }
  return p;
}

function mushrooms(v: number): Px {
  const p = new Px();
  p.fill(MUSHROOM[2] ?? [0, 0, 0], 0);
  const caps =
    v === 0
      ? [
          { x: 5, w: 7, stem: 5 },
          { x: 11, w: 5, stem: 3 },
        ]
      : [
          { x: 8, w: 7, stem: 6 },
          { x: 3, w: 4, stem: 2 },
        ];
  for (const c of caps) {
    const top = 15 - c.stem - 3;
    for (let y = 16 - c.stem; y < 16; y++) {
      p.set(c.x, y, at(MUSHROOM, 4));
      p.set(c.x - 1, y, at(MUSHROOM, 5));
    }
    const half = Math.floor(c.w / 2);
    for (let row = 0; row < 3; row++) {
      const span = row === 0 ? half - 1 : half;
      for (let dx = -span; dx <= span; dx++) {
        const idx = row === 0 ? 5 : row === 1 ? (dx < 0 ? 5 : 4) : 3;
        p.set(c.x + dx, top + row, at(MUSHROOM, idx));
      }
    }
    for (let dx = -half + 1; dx < half; dx++) p.set(c.x + dx, top + 3, at(MUSHROOM, 1));
  }
  return p;
}

/** Redwood sorrel: low clover leaves and two pale pink flowers. */
function sorrel(): Px {
  const p = new Px();
  p.fill(FERN[3] ?? [0, 0, 0], 0);
  const leaves = [
    [3, 11],
    [7, 10],
    [11, 12],
    [5, 13],
    [10, 9],
  ] as const;
  for (const [lx, ly] of leaves) {
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 0],
    ] as const)
      p.set(lx + dx, ly + dy, at(FERN, dy < 0 ? 5 : dx < 0 ? 4 : 3));
    for (let y = ly + 1; y < 16; y++) p.set(lx, y, at(FERN, 2));
  }
  for (const [fx, fy] of [
    [8, 6],
    [13, 8],
  ] as const) {
    p.set(fx, fy, at(FLOWER, 3));
    p.set(fx - 1, fy, at(FLOWER, 2));
    p.set(fx + 1, fy, at(FLOWER, 2));
    p.set(fx, fy - 1, at(FLOWER, 2));
    p.set(fx, fy + 1, at(FLOWER, 1));
    for (let y = fy + 2; y < 16; y++) p.set(fx, y, at(FERN, 2));
  }
  return p;
}

/** A sequoia seedling: a reddish stem with tiers of blue-green needles. */
function seedling(): Px {
  const p = new Px();
  p.fill(FOLIAGE[3] ?? [0, 0, 0], 0);
  for (let y = 3; y < 16; y++) p.set(8, y, at(BARK, y > 12 ? 3 : 4));
  const tiers = [
    { y: 3, w: 1 },
    { y: 5, w: 2 },
    { y: 7, w: 3 },
    { y: 9, w: 4 },
    { y: 11, w: 5 },
  ];
  for (const t of tiers) {
    for (let dx = -t.w; dx <= t.w; dx++) {
      if (dx === 0) continue;
      const droop = Math.abs(dx) > t.w - 1 ? 1 : 0;
      p.set(8 + dx, t.y + droop, at(FOLIAGE, dx < 0 ? 6 : 4));
      if (Math.abs(dx) < t.w) p.set(8 + dx, t.y + 1 + droop, at(FOLIAGE, 3));
    }
  }
  p.set(8, 2, at(FOLIAGE, 7));
  return p;
}

function tuft(): Px {
  const p = new Px();
  p.fill(GRASS[3] ?? [0, 0, 0], 0);
  const blades = [
    [3, 7, -1],
    [5, 10, 0],
    [7, 6, 1],
    [9, 9, 0],
    [11, 7, 1],
    [13, 11, -1],
  ] as const;
  for (const [bx, top, lean] of blades)
    for (let y = top; y < 16; y++) {
      const x = bx + (y < top + 2 ? lean : 0);
      p.set(x, y, at(GRASS, y === top ? 6 : y < top + 3 ? 5 : 3));
    }
  return p;
}

// ---------------------------------------------------------------- atlas

export interface Tile {
  /** Atlas UV of the tile's top-left texel corner. */
  u: number;
  v: number;
  /** Number of animation frames laid out to the right. */
  frames: number;
}

const tiles = new Map<string, Tile>();
let nextCell = 0;
const canvas = document.createElement("canvas");
canvas.width = ATLAS;
canvas.height = ATLAS;
const ctx2d = canvas.getContext("2d");
if (!ctx2d) throw new Error("no 2d context");
const ctx = ctx2d;

function blit(cell: number, px: Px): void {
  const cx = (cell % PER_ROW) * CELL;
  const cy = Math.floor(cell / PER_ROW) * CELL;
  const img = ctx.createImageData(CELL, CELL);
  // Transparent texels carry the tile's mean colour so mipmaps never darken the cutout's edges.
  let mr = 0;
  let mg = 0;
  let mb = 0;
  let n = 0;
  for (let i = 0; i < 256; i++) {
    if ((px.data[i * 4 + 3] ?? 0) > 0) {
      mr += px.data[i * 4] ?? 0;
      mg += px.data[i * 4 + 1] ?? 0;
      mb += px.data[i * 4 + 2] ?? 0;
      n++;
    }
  }
  if (n) {
    mr /= n;
    mg /= n;
    mb /= n;
  }
  for (let y = 0; y < CELL; y++)
    for (let x = 0; x < CELL; x++) {
      const sx = (x - 8 + 16) % 16;
      const sy = (y - 8 + 16) % 16;
      const s = (sy * 16 + sx) * 4;
      const d = (y * CELL + x) * 4;
      const a = px.data[s + 3] ?? 0;
      img.data[d] = a ? (px.data[s] ?? 0) : mr;
      img.data[d + 1] = a ? (px.data[s + 1] ?? 0) : mg;
      img.data[d + 2] = a ? (px.data[s + 2] ?? 0) : mb;
      img.data[d + 3] = a;
    }
  ctx.putImageData(img, cx, cy);
}

function add(name: string, ...frames: Px[]): void {
  // Animation frames must sit on one row.
  if ((nextCell % PER_ROW) + frames.length > PER_ROW) nextCell = (Math.floor(nextCell / PER_ROW) + 1) * PER_ROW;
  const cell = nextCell;
  frames.forEach((f, i) => blit(cell + i, f));
  tiles.set(name, { u: ((cell % PER_ROW) * CELL + 8) / ATLAS, v: (Math.floor(cell / PER_ROW) * CELL + 8) / ATLAS, frames: frames.length });
  nextCell += frames.length;
}

export function tile(name: string): Tile {
  const t = tiles.get(name);
  if (!t) throw new Error(`unknown tile ${name}`);
  return t;
}

export const TEXEL = 1 / ATLAS;

function buildAtlas(): void {
  for (let v = 0; v < 3; v++) add(`bark${v}`, barkSide(v, 0));
  for (let v = 0; v < 2; v++) add(`barkmoss${v}`, barkSide(v, 1));
  for (let v = 0; v < 2; v++) add(`barkmossy${v}`, barkSide(v + 1, 2));
  add("logend", logEnd());
  for (let v = 0; v < 3; v++) add(`leaf${v}`, foliage(v, FOLIAGE));
  for (let v = 0; v < 3; v++) add(`leafw${v}`, foliage(v, FOLIAGE_WINTER));
  for (let v = 0; v < 3; v++) add(`leafsnowtop${v}`, foliage(v, FOLIAGE_WINTER, "top"));
  for (let v = 0; v < 3; v++) add(`leafsnowside${v}`, foliage(v, FOLIAGE_WINTER, "side"));
  for (let v = 0; v < 3; v++) add(`grass${v}`, grassTop(v));
  for (let v = 0; v < 3; v++) add(`grassside${v}`, grassSide(v));
  for (let v = 0; v < 3; v++) add(`dirt${v}`, dirt(v));
  for (let v = 0; v < 3; v++) add(`litter${v}`, litter(v));
  for (let v = 0; v < 2; v++) add(`moss${v}`, moss(v));
  for (let v = 0; v < 3; v++) add(`stone${v}`, stone(v, 0));
  for (let v = 0; v < 2; v++) add(`stonemoss${v}`, stone(v + 3, 1));
  for (let v = 0; v < 2; v++) add(`stonemossy${v}`, stone(v + 5, 2));
  for (let v = 0; v < 2; v++) add(`boulder${v}`, boulder(v, false));
  for (let v = 0; v < 2; v++) add(`bouldermoss${v}`, boulder(v + 2, true));
  for (let v = 0; v < 2; v++) add(`snow${v}`, snowTop(v));
  for (let v = 0; v < 2; v++) add(`snowside${v}`, snowSide(v));
  for (let v = 0; v < 2; v++) add(`char${v}`, charred(v));
  add("wood", wood());
  add("copper", copper());
  add("cone", coneScales());
  add("flame", flame(0), flame(1), flame(2), flame(3), flame(4), flame(5));
  add("embers", embers(0), embers(1), embers(2), embers(3));
  add("lantern", lanternSide());
  add("iron", iron());
  add("bulbwarm", solid(hex("#ffd27a")));
  add("bulbred", solid(hex("#ff7a66")));
  add("bulbblue", solid(hex("#b4dcff")));
  add("wire", solid(hex("#2b211c")));
  add("fern0", fern(0));
  add("fern1", fern(1));
  add("mushroom0", mushrooms(0));
  add("mushroom1", mushrooms(1));
  add("sorrel", sorrel());
  add("seedling", seedling());
  add("tuft", tuft());
  add("ash", dirt(1, ASH));
}

buildAtlas();

export const atlasCanvas = canvas;

export function makeAtlasTexture(): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.flipY = false;
  t.magFilter = NearestFilter;
  t.minFilter = NearestMipmapNearestFilter;
  t.generateMipmaps = true;
  t.colorSpace = NoColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.anisotropy = 1;
  return t;
}
