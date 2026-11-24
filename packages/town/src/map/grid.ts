/**
 * Ground that can be walked on: a sheet of squares, some of them blocked, and the way round the
 * blocked ones from one spot to another. The town has one and every camp has its own; a camp's
 * changes whenever something in it is moved. The sheet's top-left corner is at `x0`, `y0` in
 * pixels, which may be below 0: square `(cx, cy)` covers the pixels from `x0 + cx * CELL` up to
 * the next square's.
 */

import { clamp, type Pt, vnoise } from "@sequoia-leaf/core";

/** The side of one square, in art pixels. */
export const CELL = 8;

export interface Ground {
  /** How many squares across and down, and where the first one's top-left corner is, in pixels. */
  readonly gw: number;
  readonly gh: number;
  readonly x0: number;
  readonly y0: number;
  /** One number a square: 1 where nothing can stand. */
  readonly blocked: Uint8Array;
  /** What a step onto each square costs: trodden earth is easy, grass a little less so. */
  readonly cost: Float32Array;
  /** Marks a block of squares, corners included, as blocked (1) or clear (0). */
  readonly fill: (x0: number, y0: number, x1: number, y1: number, v: number) => void;
  readonly cellBlocked: (cx: number, cy: number) => boolean;
  /** Whether a figure's feet fit at a point: a little box round the point must be clear. */
  readonly footBlocked: (x: number, y: number) => boolean;
  /** The clear spot nearest a point, looking outwards in rings. */
  readonly nearestFree: (x: number, y: number) => Pt;
  /** Whether a figure walks from one point straight to another with its feet clear all the way. */
  readonly clearLine: (a: Pt, b: Pt) => boolean;
  /**
   * A way from one point to another round whatever is in between, as points to walk to in turn.
   * `straight` pulls the way taut (the member, going where they pointed); otherwise it keeps to the
   * squares, and so to the paths (anybody ambling). Nothing at all if there is no way.
   */
  readonly findPath: (from: Pt, to: Pt, straight: boolean) => Pt[];
  /** How far outside trodden earth a point is (negative: on a path). */
  readonly pathD: (x: number, y: number) => number;
}

/** A stretch of trodden earth: from one point to another, and half its width. */
export type Trodden = readonly [x1: number, y1: number, x2: number, y2: number, half: number];

function segD(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / len, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

/** How far outside trodden earth a point is (negative: on it), with a ragged edge: the town's paths, and a camp's worn earth. */
export function troddenD(paths: readonly Trodden[], x: number, y: number): number {
  let d = 999;
  for (const [x1, y1, x2, y2, hw] of paths) d = Math.min(d, segD(x, y, x1, y1, x2, y2) - hw);
  return d + (vnoise(x / 9, y / 9, 5) - 0.5) * 7;
}

/** The squares, without the ways of asking about them. */
type Sheet = Pick<Ground, "gw" | "gh" | "x0" | "y0" | "blocked" | "cost">;

/** What a search keeps from one square to the next, made once for each ground so that a search makes nothing new. */
interface Search {
  readonly open: number[];
  readonly score: Float32Array;
  readonly came: Int32Array;
  readonly mark: Uint16Array;
  /** Marks this search's squares: `stamp + 1` waiting to be looked at, `stamp + 2` looked at. */
  stamp: number;
}

const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** How many rings of squares `nearestFree` looks through before giving up. */
const RINGS = 9;

function cellBlocked(s: Sheet, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= s.gw || cy >= s.gh) return true;
  return s.blocked[cy * s.gw + cx] === 1;
}

const pointBlocked = (s: Sheet, px: number, py: number): boolean =>
  cellBlocked(s, Math.floor((px - s.x0) / CELL), Math.floor((py - s.y0) / CELL));

const footBlocked = (s: Sheet, x: number, y: number): boolean =>
  pointBlocked(s, x - 3, y - 3) ||
  pointBlocked(s, x + 3, y - 3) ||
  pointBlocked(s, x - 3, y) ||
  pointBlocked(s, x + 3, y);

/** The square a point is in, or the nearest on the sheet. */
const cellAt = (s: Sheet, p: Pt): { cx: number; cy: number } => ({
  cx: clamp(Math.floor((p.x - s.x0) / CELL), 0, s.gw - 1),
  cy: clamp(Math.floor((p.y - s.y0) / CELL), 0, s.gh - 1),
});

/** Where somebody stands on a square: a little below its middle. */
const standOn = (s: Sheet, cx: number, cy: number): Pt => ({ x: s.x0 + cx * CELL + 4, y: s.y0 + cy * CELL + 5 });

function nearestFree(s: Sheet, x: number, y: number): Pt {
  const { cx, cy } = cellAt(s, { x, y });
  if (!cellBlocked(s, cx, cy) && !footBlocked(s, x, y)) return { x, y };
  let best: Pt | null = null;
  let bestD = 1e9;
  for (let r = 0; r <= RINGS && !best; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || cellBlocked(s, cx + dx, cy + dy)) continue;
        const p = standOn(s, cx + dx, cy + dy);
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
    }
  }
  return best ?? { x, y };
}

function clearLine(s: Sheet, a: Pt, b: Pt): boolean {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3);
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    if (footBlocked(s, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

/** Takes the square waiting to be looked at that looks best for reaching square `tx`, `ty`. */
function nearestOpen(s: Sheet, q: Search, tx: number, ty: number): number {
  let bi = 0;
  let bf = 1e9;
  for (let i = 0; i < q.open.length; i++) {
    const n = q.open[i] ?? 0;
    const f = (q.score[n] ?? 0) + Math.hypot((n % s.gw) - tx, Math.floor(n / s.gw) - ty);
    if (f < bf) {
      bf = f;
      bi = i;
    }
  }
  const cur = q.open[bi] ?? 0;
  q.open[bi] = q.open[q.open.length - 1] ?? 0;
  q.open.pop();
  return cur;
}

/** Looks at the squares round `cur`: each it is cheaper to reach by way of it waits to be looked at. */
function expand(s: Sheet, q: Search, cur: number): void {
  const cx = cur % s.gw;
  const cy = Math.floor(cur / s.gw);
  for (const [dx, dy] of STEPS) {
    const nx = cx + dx;
    const ny = cy + dy;
    const diagonal = dx !== 0 && dy !== 0;
    if (cellBlocked(s, nx, ny)) continue;
    if (diagonal && (cellBlocked(s, cx + dx, cy) || cellBlocked(s, cx, cy + dy))) continue;
    const n = ny * s.gw + nx;
    if (q.mark[n] === q.stamp + 2) continue;
    const g = (q.score[cur] ?? 0) + (diagonal ? Math.SQRT2 : 1) * (s.cost[n] ?? 1);
    const waiting = q.mark[n] === q.stamp + 1;
    if (waiting && g >= (q.score[n] ?? 0)) continue;
    q.score[n] = g;
    q.came[n] = cur;
    if (waiting) continue;
    q.mark[n] = q.stamp + 1;
    q.open.push(n);
  }
}

/** Searches from one square to another (A*), leaving the way back in `came`. Says whether there is a way. */
function search(s: Sheet, q: Search, start: number, target: number): boolean {
  q.stamp = (q.stamp + 2) % 65534;
  q.open.length = 0;
  q.open.push(start);
  q.score[start] = 0;
  q.came[start] = -1;
  q.mark[start] = q.stamp + 1;
  const tx = target % s.gw;
  const ty = Math.floor(target / s.gw);
  while (q.open.length > 0) {
    const cur = nearestOpen(s, q, tx, ty);
    if (cur === target) return true;
    q.mark[cur] = q.stamp + 2;
    expand(s, q, cur);
  }
  return false;
}

/** A way of points pulled taut: from each point on to the furthest one it walks to in a straight line. */
function taut(s: Sheet, cells: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  let at = 0;
  while (at < cells.length - 1) {
    let next = at + 1;
    const a = cells[at];
    for (let j = cells.length - 1; j > at + 1; j--) {
      const b = cells[j];
      if (a && b && clearLine(s, a, b)) {
        next = j;
        break;
      }
    }
    const p = cells[next];
    if (p) out.push(p);
    at = next;
  }
  return out;
}

function findPath(s: Sheet, q: Search, from: Pt, to: Pt, straight: boolean): Pt[] {
  const goal = nearestFree(s, to.x, to.y);
  const start = cellAt(s, nearestFree(s, from.x, from.y));
  const end = cellAt(s, goal);
  const target = end.cy * s.gw + end.cx;
  if (!search(s, q, start.cy * s.gw + start.cx, target)) return [];
  const cells: Pt[] = [];
  for (let n = target; n !== -1; n = q.came[n] ?? -1) cells.push(standOn(s, n % s.gw, Math.floor(n / s.gw)));
  cells.reverse();
  cells[0] = { x: from.x, y: from.y };
  cells.push(goal);
  return straight ? taut(s, cells) : cells.slice(1);
}

/** Ground `gw` squares across and `gh` down, all of it clear, its top-left corner at `origin`. */
export function makeGround(
  gw: number,
  gh: number,
  pathD: (x: number, y: number) => number,
  origin: Pt = { x: 0, y: 0 },
): Ground {
  const s: Sheet = {
    gw,
    gh,
    x0: origin.x,
    y0: origin.y,
    blocked: new Uint8Array(gw * gh),
    cost: new Float32Array(gw * gh).fill(1),
  };
  const q: Search = {
    open: [],
    score: new Float32Array(gw * gh),
    came: new Int32Array(gw * gh),
    mark: new Uint16Array(gw * gh),
    stamp: 0,
  };
  return {
    ...s,
    fill(x0, y0, x1, y1, v) {
      for (let y = Math.max(0, y0); y <= Math.min(gh - 1, y1); y++)
        for (let x = Math.max(0, x0); x <= Math.min(gw - 1, x1); x++) s.blocked[y * gw + x] = v;
    },
    cellBlocked: (cx, cy) => cellBlocked(s, cx, cy),
    footBlocked: (x, y) => footBlocked(s, x, y),
    nearestFree: (x, y) => nearestFree(s, x, y),
    clearLine: (a, b) => clearLine(s, a, b),
    findPath: (from, to, straight) => findPath(s, q, from, to, straight),
    pathD,
  };
}
