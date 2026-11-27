/**
 * Finding a way: from where a figure stands to a place, round whatever is solid, as the points to
 * walk to in turn. The page works it out when its player taps or clicks the ground; Leaf never does.
 * Carried over from Outworks (`packages/region/src/way.ts`).
 *
 * The ground is searched in squares of half a tile (A*), a square open where a figure's feet fit on
 * it and a step taken only where they also fit half way to the next (so nothing as thin as a post is
 * stepped through), and the way found is pulled taut, so the figure walks straight wherever it can.
 * A stretch of the way keeps half a pixel more from what is solid than feet need, so that a walker a
 * hair off its line still fits along it. The search looks at no more than `WAY_MOST` squares: where
 * the place cannot be reached within that (it is walled in, or very far round), the way leads as near
 * to it as the search came, and the walker looks again from there.
 */
import { blocked, FOOT, freed, type Place, type Solid, SQUARE, standOn, unsound } from "@sequoia-leaf/factory";

/** The most squares one search looks at: about a millisecond on a desktop. */
export const WAY_MOST = 3000;
/** The furthest a pulled-taut stretch reaches, in squares: bounds what pulling taut costs. */
const TAUT_MOST = 48;
/** The room a stretch of a way keeps: half a pixel more than feet need. */
const ROOM = FOOT + 0.5;

/** The eight ways out of a square: across and down, then the diagonals. */
const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

const SPAN = 65536;
const keyOf = (cx: number, cy: number): number => cy * SPAN + cx;

/** One search: the squares it has looked at, and those waiting, the most promising first. */
class Search {
  /** Whether each square it has asked about is open. */
  readonly #open = new Map<number, boolean>();
  /** What reaching each square costs, and the square it was reached from. */
  readonly cost = new Map<number, number>();
  readonly from = new Map<number, number>();
  readonly done = new Set<number>();
  /** The waiting squares as a heap of pairs: what the whole way through each would cost at best, and its key. */
  readonly #heap: number[] = [];
  readonly #solid: Solid;

  constructor(solid: Solid) {
    this.#solid = solid;
  }

  /** Whether a figure's feet fit half way between two squares next to each other. */
  between(ax: number, ay: number, bx: number, by: number): boolean {
    const [a, b] = [standOn(ax, ay), standOn(bx, by)];
    return unsound(this.#solid, (a.x + b.x) / 2, (a.y + b.y) / 2) === null;
  }

  /** Whether a figure's feet fit on a square. */
  open(cx: number, cy: number): boolean {
    const key = keyOf(cx, cy);
    let is = this.#open.get(key);
    if (is === undefined) {
      const at = standOn(cx, cy);
      is = unsound(this.#solid, at.x, at.y) === null;
      this.#open.set(key, is);
    }
    return is;
  }

  push(f: number, key: number): void {
    const heap = this.#heap;
    let i = heap.length;
    heap.push(f, key);
    while (i > 0) {
      const up = ((i / 2 - 1) >> 1) * 2;
      if ((heap[up] ?? 0) <= f) break;
      heap[i] = heap[up] ?? 0;
      heap[i + 1] = heap[up + 1] ?? 0;
      i = up;
    }
    heap[i] = f;
    heap[i + 1] = key;
  }

  /** Takes the most promising waiting square; -1 when none waits. */
  pop(): number {
    const heap = this.#heap;
    const top = heap[1];
    const key = heap.pop();
    const f = heap.pop();
    if (top === undefined || key === undefined || f === undefined) return -1;
    const n = heap.length;
    if (n === 0) return top;
    // The last pair is let sink from the top to where it belongs.
    const at = (i: number): number => heap[i] ?? Number.POSITIVE_INFINITY;
    let i = 0;
    for (let low = 2; low < n; low = i * 2 + 2) {
      if (at(low + 2) < at(low)) low += 2;
      if (at(low) >= f) break;
      heap[i] = at(low);
      heap[i + 1] = at(low + 1);
      i = low;
    }
    heap[i] = f;
    heap[i + 1] = key;
    return top;
  }
}

/** How far it is between two squares at best, going across, down and diagonally. */
function apart(ax: number, ay: number, bx: number, by: number): number {
  const [dx, dy] = [Math.abs(ax - bx), Math.abs(ay - by)];
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

/** Looks at the squares round one: each it is cheaper to reach by way of it waits to be looked at. */
function spread(q: Search, cur: number, tx: number, ty: number): void {
  const [cx, cy] = [cur % SPAN, Math.floor(cur / SPAN)];
  const had = q.cost.get(cur) ?? 0;
  for (const [dx, dy] of STEPS) {
    const [nx, ny] = [cx + dx, cy + dy];
    const key = keyOf(nx, ny);
    if (q.done.has(key) || !q.open(nx, ny)) continue;
    // A diagonal is walked only where both squares beside it are open: no corner is cut.
    const diagonal = dx !== 0 && dy !== 0;
    if (diagonal && (!q.open(cx + dx, cy) || !q.open(cx, cy + dy))) continue;
    const cost = had + (diagonal ? Math.SQRT2 : 1);
    if (cost >= (q.cost.get(key) ?? Number.POSITIVE_INFINITY)) continue;
    if (!q.between(cx, cy, nx, ny)) continue;
    q.cost.set(key, cost);
    q.from.set(key, cur);
    q.push(cost + apart(nx, ny, tx, ty), key);
  }
}

/** A way of points pulled taut: from each point on to the furthest of the next few it walks to in a straight line. */
function taut(solid: Solid, points: readonly Place[]): Place[] {
  const out: Place[] = [];
  let at = 0;
  while (at < points.length - 1) {
    const a = points[at];
    let next = at + 1;
    for (let j = Math.min(points.length - 1, at + TAUT_MOST); j > at + 1; j--) {
      const b = points[j];
      if (a !== undefined && b !== undefined && blocked(solid, a.x, a.y, b.x, b.y, ROOM) === null) {
        next = j;
        break;
      }
    }
    const p = points[next];
    if (p !== undefined) out.push(p);
    at = next;
  }
  return out;
}

/** A way found: the points to walk to in turn, and whether it ends at the place asked for (or the clear ground nearest it). */
export interface Way {
  readonly points: Place[];
  readonly whole: boolean;
}

/**
 * The way from one place to another round whatever is solid. The way ends at the place itself, or at
 * the clear ground nearest it where the place is solid; where that cannot be reached within `most`
 * squares, as near to it as the search came (`whole` false). No points: there is nowhere to go.
 */
export function findWay(solid: Solid, from: Place, to: Place, most = WAY_MOST): Way {
  const goal = freed(solid, to.x, to.y);
  // The straight way, where it is clear, needs no search.
  if (blocked(solid, from.x, from.y, goal.x, goal.y, ROOM) === null) return { points: [goal], whole: true };
  const start = freed(solid, from.x, from.y);
  const [sx, sy] = [Math.floor(start.x / SQUARE), Math.floor(start.y / SQUARE)];
  const [tx, ty] = [Math.floor(goal.x / SQUARE), Math.floor(goal.y / SQUARE)];
  const q = new Search(solid);
  const [first, target] = [keyOf(sx, sy), keyOf(tx, ty)];
  q.cost.set(first, 0);
  q.push(apart(sx, sy, tx, ty), first);
  let nearest = first;
  let nearestFar = apart(sx, sy, tx, ty);
  let found = false;
  for (let looked = 0; looked < most; looked++) {
    const cur = q.pop();
    if (cur < 0) break;
    if (q.done.has(cur)) continue;
    q.done.add(cur);
    if (cur === target) {
      found = true;
      break;
    }
    const far = apart(cur % SPAN, Math.floor(cur / SPAN), tx, ty);
    if (far < nearestFar) [nearest, nearestFar] = [cur, far];
    spread(q, cur, tx, ty);
  }
  const end = found ? target : nearest;
  if (end === first && !found) return { points: [], whole: false };
  const squares: Place[] = [];
  for (let key: number | undefined = end; key !== undefined; key = q.from.get(key))
    squares.push(standOn(key % SPAN, Math.floor(key / SPAN)));
  squares.reverse();
  squares[0] = { x: from.x, y: from.y };
  if (found) squares.push(goal);
  return { points: taut(solid, squares), whole: found };
}
