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
