/**
 * The walks that work out the plumbing's order and its rings (`wire.ts`), over the plumbing as it
 * reads it (`Plumbing`): the tiles that hand things on, each after the tiles it hands to, so that a
 * full belt moves as one; a walk from each tile in turn, a piece's ways in order, each tile once.
 *
 * The same walk, over only the ways things can really go (each tile handing to one that takes from
 * that side, or under the ground to a tunnel's far mouth), finds the rings: parts of the plumbing
 * where things handed on come back round (`Rings`). By Tarjan's walk: `low` is the first tile of the
 * walk a tile is found to lead back to, and a tile whose `low` is its own begins a part of the
 * plumbing that every tile in it leads round to; a part of more than one tile is a ring.
 */
import type { Rings } from "./plumbing.ts";
import { CARRIES, NONE, SPAN_MOST } from "./tables.ts";
import { tunnelOf, type Yard } from "./yard.ts";

/** How a walk reads the plumbing, by tile. */
export interface Plumbing {
  readonly tiles: number;
  /** The own tile of the piece on a tile (`sizes.ts`): a piece of more than one tile is walked from its own. */
  readonly own: (t: number) => number;
  /** How many ways out a tile is walked by: 1 for one that hands to one tile. */
  readonly ways: (i: number) => number;
  /** The own tile of what a tile hands to by its way `c`, or -1. */
  readonly to: (i: number, c: number) => number;
  /** Whether what stands on a tile hands things on at all. */
  readonly hands: (i: number) => boolean;
}

class Walk {
  readonly p: Plumbing;
  /** When each tile was walked to, -1 before; the first of those it leads back to; its next way. */
  readonly at: Int32Array;
  readonly low: Int32Array;
  readonly child: Uint8Array;
  /** The tiles walked on from, and those of the part of the plumbing not yet closed (and whether each is). */
  readonly stack: Int32Array;
  readonly open: Int32Array;
  readonly isOpen: Uint8Array;
  readonly order: number[] = [];
  /** The rings found, each its tiles. */
  readonly rings: number[][] = [];
  top = 0;
  opened = 0;
  walked = 0;

  constructor(p: Plumbing) {
    this.p = p;
    const n = p.tiles;
    this.at = new Int32Array(n).fill(-1);
    this.low = new Int32Array(n);
    this.child = new Uint8Array(n);
    this.stack = new Int32Array(n);
    this.open = new Int32Array(n);
    this.isOpen = new Uint8Array(n);
  }

  /** Walks from every tile in turn. */
  all(): void {
    for (let s = 0; s < this.p.tiles; s++) {
      this.enter(this.p.own(s), -1);
      while (this.top > 0) this.next();
    }
  }

  /** One step from the tile walked on from last: on by its next way, or back once it has none. */
  next(): void {
    const i = this.stack[this.top - 1] ?? 0;
    const c = this.child[i] ?? 0;
    if (c >= Math.max(1, this.p.ways(i))) {
      this.leave(i);
      return;
    }
    this.child[i] = c + 1;
    this.enter(this.p.to(i, c), i);
  }

  /** The tile `i`, handed to from `from` (-1 for none): walked to, unless it was, and then what `from` leads back to. */
  enter(i: number, from: number): void {
    if (i < 0) return;
    if ((this.at[i] ?? -1) >= 0) {
      if (from >= 0 && this.isOpen[i] === 1) this.low[from] = Math.min(this.low[from] ?? 0, this.at[i] ?? 0);
      return;
    }
    this.at[i] = this.walked++;
    // One that hands nothing on is walked to and no further, and is on no ring.
    if (!this.p.hands(i)) return;
    this.low[i] = this.at[i] ?? 0;
    this.stack[this.top++] = i;
    this.open[this.opened++] = i;
    this.isOpen[i] = 1;
  }

  /** A tile walked from in full: in the order; what it leads back to, its walker does too; and one that begins a part closes it. */
  leave(i: number): void {
    this.top--;
    this.order.push(i);
    const by = this.top > 0 ? (this.stack[this.top - 1] ?? -1) : -1;
    if (by >= 0) this.low[by] = Math.min(this.low[by] ?? 0, this.low[i] ?? 0);
    if (this.low[i] === this.at[i]) this.close(i);
  }

  /** Closes the part of the plumbing the tile `i` begins: a ring if it is more than itself. */
  close(i: number): void {
    const part: number[] = [];
    for (let j = -1; j !== i;) {
      j = this.open[--this.opened] ?? i;
      this.isOpen[j] = 0;
      part.push(j);
    }
    if (part.length > 1) this.rings.push(part);
  }
}

/** Walks the plumbing: its order (each tile after the tiles it hands to), and the rings in it. */
export function walk(p: Plumbing): { readonly order: number[]; readonly rings: readonly number[][] } {
  const w = new Walk(p);
  w.all();
  return { order: w.order, rings: w.rings };
}

/** The handing order (`walk`) with each ring's tiles taken out, and -1 less the ring's number where its last stood. */
export function orderAround(order: readonly number[], ringOf: (i: number) => number, count: number): Int32Array {
  const last = new Int32Array(count).fill(-1);
  order.forEach((i, o) => {
    const k = ringOf(i);
    if (k >= 0) last[k] = o;
  });
  const out: number[] = [];
  order.forEach((i, o) => {
    const k = ringOf(i);
    if (k < 0) out.push(i);
    else if (last[k] === o) out.push(-1 - k);
  });
  return Int32Array.from(out);
}

/**
 * The rings found (`walk` over the ways things can really go), as the plumbing keeps them: each ring's
 * tiles in the handing order, which ring each tile is on, and whether each has a way off it (`real`
 * from one of its tiles to a tile off it).
 */
export function ringsFound(order: readonly number[], found: readonly number[][], real: Plumbing): Rings {
  const onRing = new Map<number, number>();
  found.forEach((tiles, k) => {
    for (const i of tiles) onRing.set(i, k);
  });
  const byRing = found.map(() => [] as number[]);
  for (const i of order) byRing[onRing.get(i) ?? -1]?.push(i);
  const starts = [0];
  for (const tiles of byRing) starts.push((starts.at(-1) ?? 0) + tiles.length);
  const exits = byRing.map((tiles, k) =>
    tiles.some((i) => {
      for (let c = 0; c < Math.max(1, real.ways(i)); c++) {
        const t = real.to(i, c);
        if (t >= 0 && onRing.get(t) !== k) return true;
      }
      return false;
    })
      ? 1
      : 0,
  );
  const sorted = [...onRing.keys()].toSorted((a, b) => a - b);
  return {
    count: found.length,
    tiles: Int32Array.from(byRing.flat()),
    starts: Int32Array.from(starts),
    exits: Uint8Array.from(exits),
    sorted: Int32Array.from(sorted),
    ringOf: Int32Array.from(sorted, (i) => onRing.get(i) ?? -1),
    done: new Int32Array(onRing.size),
  };
}

/** No rings. */
export const NO_RINGS: Rings = {
  count: 0,
  tiles: new Int32Array(0),
  starts: Int32Array.of(0),
  exits: new Uint8Array(0),
  sorted: new Int32Array(0),
  ringOf: new Int32Array(0),
  done: new Int32Array(0),
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
 * Whether a ring has stopped for good: it has no way off it, and every tile of it carries a thing that
 * has crossed it (a tunnel's way-in mouth, every tile under the ground full too). A ring with a holder
 * on it, which may take more in, has not.
 */
export function ringStopped(y: Yard, rings: Rings, k: number): boolean {
  if (k < 0 || rings.exits[k] === 1) return false;
  for (let t = rings.starts[k] ?? 0; t < (rings.starts[k + 1] ?? 0); t++)
    if (!fullAt(y, rings.tiles[t] ?? 0)) return false;
  return true;
}

/** Whether what carries on a tile holds a thing that has crossed it, and, a way-in mouth, every tile under the ground one too. */
function fullAt(y: Yard, i: number): boolean {
  if (CARRIES[y.kind[i] ?? NONE] !== 1 || y.item[i] === NONE || (y.prog[i] ?? 0) < 8) return false;
  const span = y.span[i] ?? 0;
  const { under, along } = y.tunnels;
  const at = tunnelOf(y, i) * SPAN_MOST;
  for (let t = at; t < at + span; t++) if (under[t] === NONE || (along[t] ?? 0) < 8) return false;
  return true;
}
