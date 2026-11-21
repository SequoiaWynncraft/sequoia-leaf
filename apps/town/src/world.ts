/**
 * The town as a map: where the trodden paths and the pond are, which squares can be walked on,
 * how to get from one spot to another, and where the places stand.
 */

import type { Dir } from "@sequoia-leaf/kit/skin.ts";
import { clamp, type Pt, vnoise } from "@sequoia-leaf/kit/util.ts";

/** The walkable town, in art pixels. */
export const W = 512;
export const H = 352;
/** Collision squares. */
export const CELL = 8;
export const GW = W / CELL;
export const GH = H / CELL;

// ---------- the ground ----------

/** Trodden earth: stretches of path as x1, y1, x2, y2 and half-width. */
const PATHS: readonly (readonly [number, number, number, number, number])[] = [
  [92, 137, 424, 137, 9], // the north road, along the shop fronts
  [256, 58, 256, 176, 10], // in from the gate
  [256, 216, 256, 216, 45], // the square round the fire
  [224, 152, 198, 168, 7], // to the quest board
  [222, 238, 190, 261, 8], // west to the market
  [190, 262, 50, 263, 8],
  [290, 236, 340, 247, 7], // east to the pond
  [340, 247, 382, 250, 7],
  [256, 256, 248, 296, 7], // south, round to the garden
  [248, 296, 200, 318, 7],
  [200, 318, 110, 322, 7],
  [104, 130, 104, 130, 14], // before the Treasury
  [380, 130, 380, 130, 13], // before the Works
  [352, 214, 352, 214, 11], // under the lantern tree
];

function segD(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / len, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

/** How far outside trodden earth a point is (negative: on a path), with a ragged edge. */
export function pathD(x: number, y: number): number {
  let d = 999;
  for (const [x1, y1, x2, y2, hw] of PATHS) d = Math.min(d, segD(x, y, x1, y1, x2, y2) - hw);
  return d + (vnoise(x / 9, y / 9, 5) - 0.5) * 7;
}

const POND: readonly (readonly [number, number, number, number])[] = [
  [400, 293, 58, 30],
  [436, 280, 30, 21],
  [365, 304, 29, 19],
];

/** How far outside the pond's water a point is (negative: in the water). */
export function pondD(x: number, y: number): number {
  let d = 999;
  for (const [cx, cy, rx, ry] of POND)
    d = Math.min(d, (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry));
  return d + (vnoise(x / 11, y / 11, 9) - 0.5) * 6;
}

/** Where the far hedge tops out: the clearing ends there and the sunset shows above it. */
export function hedgeY(x: number): number {
  const top = 58 + vnoise(x / 13, 0, 21) * 7 + vnoise(x / 5, 3, 22) * 3;
  return Math.round(top + (81 - top) * gateway(x));
}

/** How far into the gateway a column is, 0 to 1: there the ground drops away and the sun comes through. */
export function gateway(x: number): number {
  const k = clamp((25 - Math.abs(x - 256)) / 10, 0, 1);
  return k * k * (3 - 2 * k);
}

// ---------- what can be walked on ----------

export const blocked = new Uint8Array(GW * GH);
/** What a step onto each square costs: paths are easy, grass a little less so. */
const cost = new Float32Array(GW * GH);

function fill(x0: number, y0: number, x1: number, y1: number, v: number): void {
  for (let y = Math.max(0, y0); y <= Math.min(GH - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(GW - 1, x1); x++) blocked[y * GW + x] = v;
}

export function cellBlocked(cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return true;
  return blocked[cy * GW + cx] === 1;
}

/** Whether a figure's feet fit at a point: a little box round the point must be clear. */
export function footBlocked(x: number, y: number): boolean {
  return pointBlocked(x - 3, y - 3) || pointBlocked(x + 3, y - 3) || pointBlocked(x - 3, y) || pointBlocked(x + 3, y);
}

function pointBlocked(px: number, py: number): boolean {
  return cellBlocked(Math.floor(px / CELL), Math.floor(py / CELL));
}

/** The clear square nearest a point, looking outwards in rings. */
export function nearestFree(x: number, y: number): Pt {
  const cx = clamp(Math.floor(x / CELL), 0, GW - 1);
  const cy = clamp(Math.floor(y / CELL), 0, GH - 1);
  if (!cellBlocked(cx, cy) && !footBlocked(x, y)) return { x, y };
  let best: Pt | null = null;
  let bestD = 1e9;
  for (let r = 0; r <= 9 && !best; r++) {
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

const open: number[] = [];
const gScore = new Float32Array(GW * GH);
const came = new Int32Array(GW * GH);
const mark = new Uint16Array(GW * GH);
let stamp = 0;
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

/**
 * A way from one point to another round whatever is in between, as points to walk to in turn.
 * `straight` pulls the way taut (the player, going where they pointed); otherwise it keeps to the
 * squares, and so to the paths (guild-mates, ambling).
 */
export function findPath(from: Pt, to: Pt, straight: boolean): Pt[] {
  const goal = nearestFree(to.x, to.y);
  const start = nearestFree(from.x, from.y);
  const sx = Math.floor(start.x / CELL);
  const sy = Math.floor(start.y / CELL);
  const tx = Math.floor(goal.x / CELL);
  const ty = Math.floor(goal.y / CELL);
  const target = ty * GW + tx;
  stamp = (stamp + 2) % 65534;
  open.length = 0;
  open.push(sy * GW + sx);
  gScore[sy * GW + sx] = 0;
  came[sy * GW + sx] = -1;
  mark[sy * GW + sx] = stamp + 1;
  let found = false;
  while (open.length > 0) {
    let bi = 0;
    let bf = 1e9;
    for (let i = 0; i < open.length; i++) {
      const n = open[i] ?? 0;
      const f = (gScore[n] ?? 0) + Math.hypot((n % GW) - tx, Math.floor(n / GW) - ty);
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
    const cx = cur % GW;
    const cy = Math.floor(cur / GW);
    for (const [dx, dy] of STEPS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (cellBlocked(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (cellBlocked(cx + dx, cy) || cellBlocked(cx, cy + dy))) continue;
      const n = ny * GW + nx;
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
    cells.push({ x: (n % GW) * CELL + 4, y: Math.floor(n / GW) * CELL + 5 });
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

// ---------- places ----------

export type PlaceId = "treasury" | "quests" | "market" | "works" | "fire" | "pond" | "camp";

export interface Place {
  id: PlaceId;
  name: string;
  /** Where to stand to use it, and which way to face. */
  stand: Pt;
  face: Dir;
  /** Where its prompt floats. */
  prompt: Pt;
}

export const PLACES: readonly Place[] = [
  {
    id: "treasury",
    name: "Treasury",
    stand: { x: 104, y: 128 },
    face: 3,
    prompt: { x: 104, y: 62 },
  },
  {
    id: "quests",
    name: "Quest board",
    stand: { x: 198, y: 168 },
    face: 3,
    prompt: { x: 198, y: 116 },
  },
  {
    id: "market",
    name: "Market",
    stand: { x: 108, y: 257 },
    face: 3,
    prompt: { x: 108, y: 200 },
  },
  {
    id: "works",
    name: "The Works",
    stand: { x: 380, y: 128 },
    face: 3,
    prompt: { x: 380, y: 62 },
  },
  {
    id: "fire",
    name: "Campfire",
    stand: { x: 256, y: 205 },
    face: 0,
    prompt: { x: 256, y: 186 },
  },
  {
    id: "pond",
    name: "Crab pond",
    stand: { x: 380, y: 254 },
    face: 0,
    prompt: { x: 400, y: 270 },
  },
  {
    id: "camp",
    name: "Your camp",
    stand: { x: 256, y: 106 },
    face: 3,
    prompt: { x: 256, y: 44 },
  },
];

export function place(id: PlaceId): Place {
  const p = PLACES.find((q) => q.id === id);
  if (!p) throw new Error(`no place ${id}`);
  return p;
}

/** Lantern posts, by their foot. */
export const POSTS: readonly Pt[] = [
  { x: 174, y: 126 },
  { x: 334, y: 126 },
  { x: 204, y: 246 },
  { x: 310, y: 246 },
  { x: 188, y: 276 },
  { x: 398, y: 246 },
  { x: 230, y: 306 },
  { x: 92, y: 294 },
];

// ---------- somewhere to sit, somewhere to be ----------

export interface Seat {
  /** Where the sitter is drawn, and which way they face. */
  x: number;
  y: number;
  dir: Dir;
  /** The clear spot they step up from. */
  from: Pt;
  at: "fire" | "bench";
  taken: boolean;
}

export const SEATS: Seat[] = [
  { x: 248, y: 201, dir: 0, from: { x: 248, y: 188 }, at: "fire", taken: false },
  { x: 264, y: 201, dir: 0, from: { x: 264, y: 188 }, at: "fire", taken: false },
  { x: 248, y: 236, dir: 3, from: { x: 248, y: 246 }, at: "fire", taken: false },
  { x: 264, y: 236, dir: 3, from: { x: 264, y: 246 }, at: "fire", taken: false },
  { x: 221, y: 213, dir: 2, from: { x: 212, y: 214 }, at: "fire", taken: false },
  { x: 291, y: 213, dir: 1, from: { x: 300, y: 214 }, at: "fire", taken: false },
  { x: 114, y: 312, dir: 0, from: { x: 114, y: 320 }, at: "bench", taken: false },
  { x: 127, y: 312, dir: 0, from: { x: 127, y: 320 }, at: "bench", taken: false },
];

export type Errand =
  "treasury" | "quests" | "market" | "stall" | "works" | "pond" | "tree" | "pole" | "garden" | "gate";

export interface Spot {
  x: number;
  y: number;
  dir: Dir;
  errand: Errand;
  taken: boolean;
}

const spot = (x: number, y: number, dir: Dir, errand: Errand): Spot => ({ x, y, dir, errand, taken: false });

export const SPOTS: Spot[] = [
  spot(92, 128, 3, "treasury"),
  spot(118, 129, 3, "treasury"),
  spot(188, 166, 3, "quests"),
  spot(208, 167, 3, "quests"),
  spot(60, 254, 3, "market"),
  spot(110, 255, 3, "market"),
  spot(156, 254, 3, "market"),
  spot(60, 238, 0, "stall"),
  spot(156, 238, 0, "stall"),
  spot(366, 128, 3, "works"),
  spot(428, 137, 3, "works"),
  spot(342, 280, 2, "pond"),
  spot(404, 254, 0, "pond"),
  spot(448, 250, 0, "pond"),
  spot(340, 216, 2, "tree"),
  spot(300, 164, 3, "pole"),
  spot(64, 300, 0, "garden"),
  spot(170, 300, 1, "garden"),
];

/** Where a raid party musters before the gate. */
export const MUSTER: readonly Pt[] = [
  { x: 240, y: 112 },
  { x: 272, y: 113 },
  { x: 250, y: 125 },
  { x: 265, y: 127 },
];

// ---------- the squares, worked out once everything above is known ----------

function build(): void {
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const px = x * CELL + 4;
      const py = y * CELL + 4;
      blocked[y * GW + x] = pondD(px, py) < 3 ? 1 : 0;
      cost[y * GW + x] = pathD(px, py) < 1 ? 1 : 1.7;
    }
  }
  fill(0, 0, GW - 1, 11, 1); // the far trees, the shops' backs
  fill(30, 10, 33, 11, 0); // the way through the gate
  fill(7, 12, 18, 14, 1); // Treasury
  fill(19, 14, 19, 14, 1); // its chest
  fill(43, 12, 55, 14, 1); // the Works
  fill(50, 15, 58, 15, 1); // its belt and crates
  fill(21, 12, 27, 12, 1); // the great trunks either side of the gate
  fill(36, 12, 42, 12, 1);
  fill(0, 12, 5, 15, 1); // the corner trunks
  fill(59, 12, 63, 16, 1);
  fill(0, 0, 3, GH - 1, 1); // the walls of bark, left and right
  fill(60, 0, 63, GH - 1, 1);
  fill(0, 22, 4, 25, 1);
  fill(0, 38, 5, 43, 1);
  fill(59, 26, 63, 29, 1);
  fill(58, 39, 63, 43, 1);
  fill(0, 42, GW - 1, 43, 1); // the ferns along the bottom
  fill(22, 19, 26, 19, 1); // quest board
  fill(37, 18, 37, 18, 1); // banner pole
  fill(31, 26, 32, 27, 1); // the fire
  fill(30, 24, 33, 24, 1); // its logs and stumps
  fill(30, 29, 33, 29, 1);
  fill(27, 26, 27, 26, 1);
  fill(36, 26, 36, 26, 1);
  fill(43, 24, 44, 24, 1); // lantern tree
  fill(5, 30, 9, 30, 1); // market stalls
  fill(11, 30, 15, 30, 1);
  fill(17, 30, 21, 30, 1);
  fill(13, 38, 16, 38, 1); // garden bench
  // A lantern post takes the square its foot is in.
  for (const p of POSTS) {
    const x = Math.floor(p.x / CELL);
    const y = Math.floor((p.y - 2) / CELL);
    fill(x, y, x, y, 1);
  }
}

build();
