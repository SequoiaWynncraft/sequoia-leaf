/** Seeded randomness and smooth noise, all deterministic. */

export function hashString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Mulberry32: a small, fast seeded generator. */
export class Rng {
  private state: number;
  constructor(seed: number | string) {
    this.state = (typeof seed === "string" ? hashString(seed) : seed) >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }
  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error("pick from empty list");
    return item;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Integer hash of up to three coordinates and a salt, in [0, 1). */
export function hash3(x: number, y: number, z: number, salt = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(salt | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash2(x: number, y: number, salt = 0): number {
  return hash3(x, y, 0, salt);
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise on a grid of the given period, so it tiles. */
export function tileNoise(x: number, y: number, period: number, salt: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const w = (v: number) => ((v % period) + period) % period;
  const a = hash2(w(x0), w(y0), salt);
  const b = hash2(w(x0 + 1), w(y0), salt);
  const c = hash2(w(x0), w(y0 + 1), salt);
  const d = hash2(w(x0 + 1), w(y0 + 1), salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Plain 2D value noise (not tiling). */
export function noise2(x: number, y: number, salt: number): number {
  return tileNoise(x, y, 1 << 20, salt);
}

export function fbm2(x: number, y: number, salt: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, salt + i * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
