/**
 * The rings in the plumbing (`Rings`), as the plumbing keeps them once it is worked out (`wire.ts`):
 * the parts of it where things handed on come back round, found by Tarjan's walk over the ways things
 * can really go (`walk.ts`), and for each the order its turn tries its tiles in (`round.ts`).
 *
 * A ring's turn tries its tiles backward along the ways things go round it: a tile, then each tile that
 * hands to it, then each that hands to those, so that a tile has tried to hand on, and made room,
 * before the tile behind it tries. The order is worked out from a tile with a way off the ring, or a
 * ring's first in the handing order; each turn begins it where the ring has room (`round.ts`).
 */
import type { Rings } from "./plumbing.ts";
import { CARRIES, NONE, SPAN_MOST } from "./tables.ts";
import type { Plumbing } from "./walk.ts";
import { tunnelOf, type Yard } from "./yard.ts";

/** What makes a ring's tiles what they are, by tile: one that carries on its own tile alone; one that holds things (a crate, a grower). */
export interface RingTiles {
  readonly plain: (i: number) => boolean;
  readonly holds: (i: number) => boolean;
}

/**
 * The rings found, as the plumbing keeps them: each ring's tiles in the order its turn tries them,
 * which of them carry on their own tile alone, which hold things, and which ring each tile is on.
 * `order` is the handing order, `found` each ring's tiles, `real` the ways things can really go.
 */
export function ringsFound(order: readonly number[], found: readonly number[][], real: Plumbing, is: RingTiles): Rings {
  const onRing = new Map<number, number>();
  found.forEach((tiles, k) => {
    for (const i of tiles) onRing.set(i, k);
  });
  const byRing = found.map(() => [] as number[]);
  for (const i of order) byRing[onRing.get(i) ?? -1]?.push(i);
  const turns = byRing.map((tiles, k) => turnOrder(tiles, k, onRing, real));
  const tiles = turns.flat();
  const starts = [0];
  for (const turn of turns) starts.push((starts.at(-1) ?? 0) + turn.length);
  const holders: number[] = [];
  const holderStarts = [0];
  turns.forEach((_, k) => {
    for (let t = starts[k] ?? 0; t < (starts[k + 1] ?? 0); t++) if (is.holds(tiles[t] ?? 0)) holders.push(t);
    holderStarts.push(holders.length);
  });
  const sorted = [...onRing.keys()].toSorted((a, b) => a - b);
  return {
    count: found.length,
    tiles: Int32Array.from(tiles),
    starts: Int32Array.from(starts),
    plain: Uint8Array.from(tiles, (i) => (is.plain(i) ? 1 : 0)),
    holders: Int32Array.from(holders),
    holderStarts: Int32Array.from(holderStarts),
    sorted: Int32Array.from(sorted),
    ringOf: Int32Array.from(sorted, (i) => onRing.get(i) ?? -1),
    done: new Float64Array(tiles.length),
    begin: Int32Array.from(starts.slice(0, -1)),
    still: new Float64Array(found.length),
    looked: new Float64Array(1),
  };
}

/**
 * The order ring `k`'s turn tries its tiles in (the module says why): from its first tile with a way
 * off the ring, or its first, each tile before the tiles that hand to it, through every tile of it.
 * `tiles` are its tiles in the handing order.
 */
function turnOrder(tiles: readonly number[], k: number, onRing: ReadonlyMap<number, number>, real: Plumbing): number[] {
  const behind = new Map<number, number[]>(tiles.map((i) => [i, []]));
  let start = -1;
  for (const i of tiles)
    for (let c = 0; c < Math.max(1, real.ways(i)); c++) {
      const t = real.to(i, c);
      if (t < 0) continue;
      if (onRing.get(t) === k) behind.get(t)?.push(i);
      else if (start < 0) start = i;
    }
  const out: number[] = [];
  const seen = new Set<number>();
  const next = [start < 0 ? (tiles[0] ?? 0) : start];
  for (let i = next.pop(); i !== undefined; i = next.pop()) {
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(i);
    // The first that hands to it is tried next.
    next.push(...(behind.get(i) ?? []).toReversed());
  }
  return out;
}

/** No rings. */
export const NO_RINGS: Rings = {
  count: 0,
  tiles: new Int32Array(0),
  starts: Int32Array.of(0),
  plain: new Uint8Array(0),
  holders: new Int32Array(0),
  holderStarts: Int32Array.of(0),
  sorted: new Int32Array(0),
  ringOf: new Int32Array(0),
  done: new Float64Array(0),
  begin: new Int32Array(0),
  still: new Float64Array(0),
  looked: new Float64Array(1),
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

/**
 * Whether ring `k` is full and stood still: its turn in the tick the yard last ran moved nothing, and
 * every tile of it that carries holds a thing that has crossed it (a tunnel's way-in mouth, every tile
 * under the ground too). Whether it has stopped is then whether what it hands to off it has
 * (`kinds/say.ts`).
 */
export function ringFull(y: Yard, rings: Rings, k: number): boolean {
  if (k < 0 || rings.still[k] !== y.tick) return false;
  for (let t = rings.starts[k] ?? 0; t < (rings.starts[k + 1] ?? 0); t++)
    if (!fullAt(y, rings.tiles[t] ?? 0)) return false;
  return true;
}

/** Whether what carries on a tile holds a thing that has crossed it, and a way-in mouth every tile under the ground; anything else is. */
function fullAt(y: Yard, i: number): boolean {
  if (CARRIES[y.kind[i] ?? NONE] !== 1) return true;
  if (y.item[i] === NONE || (y.prog[i] ?? 0) < 8) return false;
  const span = y.span[i] ?? 0;
  const { under, along } = y.tunnels;
  const at = tunnelOf(y, i) * SPAN_MOST;
  for (let t = at; t < at + span; t++) if (under[t] === NONE || (along[t] ?? 0) < 8) return false;
  return true;
}
