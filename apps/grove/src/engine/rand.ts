/** Seeded integer hash and value noise. The same inputs always give the same world. */

export function ihash(x: number, y: number, z: number, s: number): number {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^
    Math.imul(y | 0, 0x165667b1) ^
    Math.imul(z | 0, 0x9e3779b1) ^
    Math.imul(s | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Smooth 2D value noise in 0..1; `period` wraps it (for tiles), 0 leaves it open. */
export function noise2(x: number, y: number, seed: number, period = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const w = (v: number): number => (period ? ((v % period) + period) % period : v);
  const a = ihash(w(x0), w(y0), 0, seed);
  const b = ihash(w(x0 + 1), w(y0), 0, seed);
  const c = ihash(w(x0), w(y0 + 1), 0, seed);
  const d = ihash(w(x0 + 1), w(y0 + 1), 0, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** A small deterministic generator for sequences. */
export function rng(seed: number): () => number {
  let n = 0;
  return () => ihash(n++, 17, 31, seed);
}
