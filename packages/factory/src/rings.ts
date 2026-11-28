/**
 * The rings in the plumbing (`Rings`): the parts of it where things handed on come back round, found
 * by Tarjan's walk over the ways things can go (`walk.ts`, `wire.ts`). The tick reads none of it:
 * every yard hands on in the one order (`Wire.order`). A ring's own turn, so that a full ring moves as
 * a full belt does, is later work (`works/ring-turn`). Status reads it, to say whether a line runs into
 * a ring that has stopped (`kinds/say.ts`), and so does the count of rings in kept yards (`ringsOf`).
 */
import type { Rings } from "./plumbing.ts";

/** The rings found, as the plumbing keeps them: each ring's tiles in the handing order, and which ring each tile is on. */
export function ringsFound(order: readonly number[], found: readonly number[][]): Rings {
  const onRing = new Map<number, number>();
  found.forEach((tiles, k) => {
    for (const i of tiles) onRing.set(i, k);
  });
  const byRing = found.map(() => [] as number[]);
  for (const i of order) byRing[onRing.get(i) ?? -1]?.push(i);
  const starts = [0];
  for (const tiles of byRing) starts.push((starts.at(-1) ?? 0) + tiles.length);
  const sorted = [...onRing.keys()].toSorted((a, b) => a - b);
  return {
    count: found.length,
    tiles: Int32Array.from(byRing.flat()),
    starts: Int32Array.from(starts),
    sorted: Int32Array.from(sorted),
    ringOf: Int32Array.from(sorted, (i) => onRing.get(i) ?? -1),
  };
}

/** No rings. */
export const NO_RINGS: Rings = {
  count: 0,
  tiles: new Int32Array(0),
  starts: Int32Array.of(0),
  sorted: new Int32Array(0),
  ringOf: new Int32Array(0),
};

/** The ring a piece's own tile is on, or -1. */
export function ringAt(rings: Rings, i: number): number {
  let lo = 0;
  let hi = rings.sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = rings.sorted[mid] ?? 0;
    if (t === i) return rings.ringOf[mid] ?? -1;
    if (t < i) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
