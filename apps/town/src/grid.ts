/**
 * Ground that can be walked on: a sheet of squares, some of them blocked, and the way round the
 * blocked ones from one spot to another. The town has one and every camp has its own; a camp's
 * changes whenever something in it is moved.
 */

import { clamp, type Pt } from "@sequoia-leaf/kit/util.ts";

/** The side of one square, in art pixels. */
export const CELL = 8;

export interface Ground {
  /** How many squares across and down. */
  readonly gw: number;
  readonly gh: number;
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
  /**
   * A way from one point to another round whatever is in between, as points to walk to in turn.
   * `straight` pulls the way taut (the member, going where they pointed); otherwise it keeps to the
   * squares, and so to the paths (guild-mates, ambling). Nothing at all if there is no way.
   */
  readonly findPath: (from: Pt, to: Pt, straight: boolean) => Pt[];
  /** How far outside trodden earth a point is (negative: on a path). */
  readonly pathD: (x: number, y: number) => number;
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

export function makeGround(gw: number, gh: number, pathD: (x: number, y: number) => number): Ground {
  const blocked = new Uint8Array(gw * gh);
  const cost = new Float32Array(gw * gh).fill(1);
  const open: number[] = [];
  const gScore = new Float32Array(gw * gh);
  const came = new Int32Array(gw * gh);
  const mark = new Uint16Array(gw * gh);
  let stamp = 0;

  function cellBlocked(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return true;
    return blocked[cy * gw + cx] === 1;
  }
  const pointBlocked = (px: number, py: number): boolean => cellBlocked(Math.floor(px / CELL), Math.floor(py / CELL));
  const footBlocked = (x: number, y: number): boolean =>
    pointBlocked(x - 3, y - 3) || pointBlocked(x + 3, y - 3) || pointBlocked(x - 3, y) || pointBlocked(x + 3, y);

  function nearestFree(x: number, y: number): Pt {
    const cx = clamp(Math.floor(x / CELL), 0, gw - 1);
    const cy = clamp(Math.floor(y / CELL), 0, gh - 1);
    if (!cellBlocked(cx, cy) && !footBlocked(x, y)) return { x, y };
    let best: Pt | null = null;
    let bestD = 1e9;
    for (let r = 0; r <= RINGS && !best; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || cellBlocked(cx + dx, cy + dy)) continue;
          const p = { x: (cx + dx) * CELL + 4, y: (cy + dy) * CELL + 5 };
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

  function clearLine(a: Pt, b: Pt): boolean {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3);
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : i / n;
      if (footBlocked(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  }

  function findPath(from: Pt, to: Pt, straight: boolean): Pt[] {
    const goal = nearestFree(to.x, to.y);
    const start = nearestFree(from.x, from.y);
    const sx = clamp(Math.floor(start.x / CELL), 0, gw - 1);
    const sy = clamp(Math.floor(start.y / CELL), 0, gh - 1);
    const tx = clamp(Math.floor(goal.x / CELL), 0, gw - 1);
    const ty = clamp(Math.floor(goal.y / CELL), 0, gh - 1);
    const target = ty * gw + tx;
    stamp = (stamp + 2) % 65534;
    open.length = 0;
    open.push(sy * gw + sx);
    gScore[sy * gw + sx] = 0;
    came[sy * gw + sx] = -1;
    mark[sy * gw + sx] = stamp + 1;
    let found = false;
    while (open.length > 0) {
      let bi = 0;
      let bf = 1e9;
      for (let i = 0; i < open.length; i++) {
        const n = open[i] ?? 0;
        const f = (gScore[n] ?? 0) + Math.hypot((n % gw) - tx, Math.floor(n / gw) - ty);
        if (f < bf) {
          bf = f;
          bi = i;
        }
      }
      const cur = open[bi] ?? 0;
      open[bi] = open[open.length - 1] ?? 0;
      open.pop();
      if (cur === target) {
        found = true;
        break;
      }
      mark[cur] = stamp + 2;
      const cx = cur % gw;
      const cy = Math.floor(cur / gw);
      for (const [dx, dy] of STEPS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (cellBlocked(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (cellBlocked(cx + dx, cy) || cellBlocked(cx, cy + dy))) continue;
        const n = ny * gw + nx;
        if (mark[n] === stamp + 2) continue;
        const g = (gScore[cur] ?? 0) + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1) * (cost[n] ?? 1);
        if (mark[n] === stamp + 1 && g >= (gScore[n] ?? 0)) continue;
        gScore[n] = g;
        came[n] = cur;
        if (mark[n] !== stamp + 1) {
          mark[n] = stamp + 1;
          open.push(n);
        }
      }
    }
    if (!found) return [];
    const cells: Pt[] = [];
    for (let n = target; n !== -1; n = came[n] ?? -1)
      cells.push({ x: (n % gw) * CELL + 4, y: Math.floor(n / gw) * CELL + 5 });
    cells.reverse();
    cells[0] = { x: from.x, y: from.y };
    cells.push(goal);
    if (!straight) return cells.slice(1);
    const out: Pt[] = [];
    let at = 0;
    while (at < cells.length - 1) {
      let next = at + 1;
      const a = cells[at];
      for (let j = cells.length - 1; j > at + 1; j--) {
        const b = cells[j];
        if (a && b && clearLine(a, b)) {
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

  return {
    gw,
    gh,
    blocked,
    cost,
    fill(x0, y0, x1, y1, v) {
      for (let y = Math.max(0, y0); y <= Math.min(gh - 1, y1); y++)
        for (let x = Math.max(0, x0); x <= Math.min(gw - 1, x1); x++) blocked[y * gw + x] = v;
    },
    cellBlocked,
    footBlocked,
    nearestFree,
    findPath,
    pathD,
  };
}
