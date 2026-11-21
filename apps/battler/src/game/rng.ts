/**
 * Chance, from a seed. Anything that carries a random stream holds its whole state in one number
 * (`rng`), so a run or a fight can be saved, sent and replayed exactly.
 */
export interface Stream {
  rng: number;
}

/** A small seeded generator (mulberry32): moves the stream on and gives a number from 0 up to 1. */
export function chance(o: Stream): number {
  o.rng = (o.rng + 0x6d2b79f5) >>> 0;
  let t = o.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A whole number from 0 up to, not including, `n`. */
export const below = (o: Stream, n: number): number => Math.floor(chance(o) * n);

/** One of a list. The list must not be empty. */
export function pick<T>(o: Stream, list: readonly T[]): T {
  const v = list[below(o, list.length)];
  if (v === undefined) throw new Error("nothing to pick from");
  return v;
}

/** The place of one of a list of weights, drawn in proportion to them; -1 if none of them weighs anything. */
export function weighted(o: Stream, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return -1;
  let roll = chance(o) * total;
  let last = -1;
  for (let i = 0; i < weights.length; i++) {
    const w = Math.max(0, weights[i] ?? 0);
    if (w <= 0) continue;
    last = i;
    roll -= w;
    if (roll < 0) return i;
  }
  return last;
}

/** A copy of a list in a drawn order. */
export function shuffled<T>(o: Stream, list: readonly T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = below(o, i + 1);
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** A new seed made from a seed and a number, so each room and each fight has a stream of its own. */
export const mix = (seed: number, n: number): number => {
  let t = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
  return (t ^ (t >>> 16)) >>> 0;
};
