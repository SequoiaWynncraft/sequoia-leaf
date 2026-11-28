/**
 * The walk that works out the handing order (`wire.ts`), over plumbing as it reads it (`Plumbing`):
 * the tiles that hand things on, each after the tiles it hands to, so that a full belt moves as one;
 * a walk from each tile in turn, a piece's ways in order, each tile once.
 *
 * Round a ring there is no such order, and the walk cuts it: a tile that hands to one the walk is
 * still walking on from comes before it. So with the order the walk gives the tiles of it that lie
 * on a ring, and those of them that carry and hand across a cut (`Walked`). A ring is found by
 * Tarjan's walk: `low` is the first tile of the walk a tile is found to lead back to, and a tile
 * whose `low` is its own begins a part of the plumbing that every tile in it leads round to; a part
 * of more than one tile is a ring.
 */

/** How the walk reads the plumbing, by tile. */
export interface Plumbing {
  readonly tiles: number;
  /** The own tile of the piece on a tile (`sizes.ts`): a piece of more than one tile is walked from its own. */
  readonly own: (t: number) => number;
  /** How many ways out a tile is walked by: 1 for one that hands to one tile. */
  readonly ways: (i: number) => number;
  /** The own tile of what a tile hands to by its way `c`, or -1. */
  readonly to: (i: number, c: number) => number;
  /** Whether what stands on a tile hands things on at all; and whether it carries them across it. */
  readonly hands: (i: number) => boolean;
  readonly carries: (i: number) => boolean;
}

/** The handing order, the tiles of it on a ring and those that hand across a cut, in its order; and how many rings. */
export interface Walked {
  readonly order: Int32Array;
  readonly rings: Int32Array;
  readonly cuts: Int32Array;
  readonly count: number;
}

/** What the walk knows of a tile, a bit each. */
const OPEN = 1;
const ON_PATH = 2;
const ON_RING = 4;
const CUT = 8;

class Walk {
  readonly p: Plumbing;
  /** When each tile was walked to, -1 before; the first of those it leads back to; its next way. */
  readonly at: Int32Array;
  readonly low: Int32Array;
  readonly child: Uint8Array;
  /** The tiles walked on from, and those of the part of the plumbing not yet closed. */
  readonly stack: Int32Array;
  readonly open: Int32Array;
  readonly flags: Uint8Array;
  readonly order: number[] = [];
  top = 0;
  opened = 0;
  walked = 0;
  count = 0;

  constructor(p: Plumbing) {
    this.p = p;
    const n = p.tiles;
    this.at = new Int32Array(n).fill(-1);
    this.low = new Int32Array(n);
    this.child = new Uint8Array(n);
    this.stack = new Int32Array(n);
    this.open = new Int32Array(n);
    this.flags = new Uint8Array(n);
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

  /** The tile `i`, handed to from `from` (-1 for none): walked to, unless it was; a tile walked before marks a ring or a cut. */
  enter(i: number, from: number): void {
    if (i < 0) return;
    const f = this.flags[i] ?? 0;
    if ((this.at[i] ?? -1) >= 0) {
      if (from < 0) return;
      if ((f & OPEN) !== 0) this.low[from] = Math.min(this.low[from] ?? 0, this.at[i] ?? 0);
      if ((f & ON_PATH) !== 0) this.flags[from] = (this.flags[from] ?? 0) | CUT;
      return;
    }
    this.at[i] = this.walked++;
    // One that hands nothing on is walked to and no further, and is on no ring.
    if (!this.p.hands(i)) return;
    this.low[i] = this.at[i] ?? 0;
    this.stack[this.top++] = i;
    this.open[this.opened++] = i;
    this.flags[i] = OPEN | ON_PATH;
  }

  /** A tile walked from in full: in the order; what it leads back to, its walker does too; and one that begins a part closes it. */
  leave(i: number): void {
    this.top--;
    this.order.push(i);
    this.flags[i] = (this.flags[i] ?? 0) & ~ON_PATH;
    const by = this.top > 0 ? (this.stack[this.top - 1] ?? -1) : -1;
    if (by >= 0) this.low[by] = Math.min(this.low[by] ?? 0, this.low[i] ?? 0);
    if (this.low[i] === this.at[i]) this.close(i);
  }

  /** Closes the part of the plumbing the tile `i` begins: a ring if it is more than itself. */
  close(i: number): void {
    const from = this.opened;
    for (let j = -1; j !== i;) {
      j = this.open[--this.opened] ?? i;
      this.flags[j] = (this.flags[j] ?? 0) & ~OPEN;
    }
    if (from - this.opened < 2) return;
    this.count++;
    for (let k = this.opened; k < from; k++)
      this.flags[this.open[k] ?? 0] = (this.flags[this.open[k] ?? 0] ?? 0) | ON_RING;
  }

  has(i: number, bit: number): boolean {
    return ((this.flags[i] ?? 0) & bit) !== 0;
  }
}

/** Walks the plumbing: its handing order, its rings and their cuts. */
export function walk(p: Plumbing): Walked {
  const w = new Walk(p);
  w.all();
  const { order } = w;
  return {
    order: Int32Array.from(order),
    rings: Int32Array.from(order.filter((i) => w.has(i, ON_RING))),
    cuts: Int32Array.from(order.filter((i) => w.has(i, ON_RING) && w.has(i, CUT) && p.carries(i))),
    count: w.count,
  };
}
