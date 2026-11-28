/**
 * The rings in the plumbing (`Rings`), as the plumbing keeps them once it is worked out (`wire.ts`):
 * the parts of it where things handed on come back round, found by Tarjan's walk over the ways things
 * can really go (`walk.ts`), and for each the order its turn tries its tiles in (`round.ts`).
 *
 * A ring's turn tries its tiles in the handing order, each after every tile it hands to but where the
 * walk came back round to a tile it was still walking from: so a tile has tried to hand on, and made
 * room, before the tiles behind it try. Round a ring the order must break somewhere; each turn begins
 * it at a tile with room (`round.ts`), where the break costs nothing.
 */
import type { Rings } from "./plumbing.ts";
import { CARRIES, NONE, SPAN_MOST } from "./tables.ts";
import { tunnelOf, type Yard } from "./yard.ts";

/** What makes a ring's tiles what they are, by tile: one that carries on its own tile alone; one that holds things (a crate, a grower). */
export interface RingTiles {
  readonly plain: (i: number) => boolean;
  readonly holds: (i: number) => boolean;
}

/**
 * The rings found, as the plumbing keeps them: each ring's tiles in the order its turn tries them (the
 * handing order), which of them carry on their own tile alone, which hold things, and which ring each
 * tile is on. `order` is the handing order by the ways things can go, `found` each ring's tiles.
 */
export function ringsFound(order: readonly number[], found: readonly number[][], is: RingTiles): Rings {
  const onRing = new Map<number, number>();
  found.forEach((tiles, k) => {
    for (const i of tiles) onRing.set(i, k);
  });
  const byRing = found.map(() => [] as number[]);
  for (const i of order) byRing[onRing.get(i) ?? -1]?.push(i);
  const tiles = byRing.flat();
  const starts = [0];
  for (const turn of byRing) starts.push((starts.at(-1) ?? 0) + turn.length);
  const holders: number[] = [];
  const holderStarts = [0];
  byRing.forEach((_, k) => {
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
    had: new Uint8Array(tiles.length),
    sorted: Int32Array.from(sorted),
    ringOf: Int32Array.from(sorted, (i) => onRing.get(i) ?? -1),
    done: new Int32Array(tiles.length),
    begin: Int32Array.from(starts.slice(0, -1)),
    still: new Float64Array(found.length),
    looked: new Float64Array(1),
  };
}

/** No rings. */
export const NO_RINGS: Rings = {
  count: 0,
  tiles: new Int32Array(0),
  starts: Int32Array.of(0),
  plain: new Uint8Array(0),
  holders: new Int32Array(0),
  holderStarts: Int32Array.of(0),
  had: new Uint8Array(0),
  sorted: new Int32Array(0),
  ringOf: new Int32Array(0),
  done: new Int32Array(0),
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
