/**
 * The town as a map: where the trodden paths and the pond are, which squares can be walked on,
 * how to get from one spot to another, and where the places stand.
 */

import type { Dir } from "@sequoia-leaf/kit/skin.ts";
import { clamp, type Pt, vnoise } from "@sequoia-leaf/kit/util.ts";

import { CELL, type Ground, makeGround } from "./grid.ts";

/** The walkable town, in art pixels. */
export const W = 512;
export const H = 352;
/** Collision squares. */
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
  [362, 211, 414, 206, 6], // east to the great stump
  [444, 205, 444, 205, 27], // round the stump, where people stand to watch
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

/** The town's own ground: which squares are solid, and the ways round them. */
export const TOWN: Ground = makeGround(GW, GH, pathD);

export const { cellBlocked, footBlocked, nearestFree, findPath } = TOWN;

// ---------- places ----------

export type PlaceId = "treasury" | "quests" | "market" | "works" | "table" | "fire" | "pond" | "camp";

export interface Place {
  id: PlaceId;
  name: string;
  /** What it is, in a line, for whoever points at it, where its name does not say. */
  about?: string;
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
    about: "Cinfy sells things for Leaf.",
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
    about: "Things for your camp, for Coins.",
    stand: { x: 108, y: 257 },
    face: 3,
    prompt: { x: 108, y: 200 },
  },
  {
    id: "works",
    name: "The Works",
    about: "Your yard. Coins are made here.",
    stand: { x: 373, y: 127 },
    face: 3,
    prompt: { x: 373, y: 62 },
  },
  {
    id: "table",
    name: "The Little Raid",
    about: "The guild's board game.",
    stand: { x: 444, y: 206 },
    face: 3,
    prompt: { x: 444, y: 140 },
  },
  {
    id: "fire",
    name: "Campfire",
    stand: { x: 256, y: 205 },
    face: 0,
    // On the fire's own stones, under the flames: over the logs it covered the faces of whoever sat there.
    prompt: { x: 256, y: 217 },
  },
  {
    id: "pond",
    name: "Crab pond",
    about: "Nine crabs. Eight at roll call.",
    stand: { x: 380, y: 254 },
    face: 0,
    prompt: { x: 400, y: 270 },
  },
  {
    id: "camp",
    name: "Your camp",
    about: "Through the gate and down the trail.",
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
  { x: 424, y: 181 }, // over the stump's board
];

/** The market stalls, by the left end of their foot. */
export const STALL_FEET: readonly Pt[] = [
  { x: 40, y: 248 },
  { x: 88, y: 248 },
  { x: 136, y: 248 },
];

/** The Treasury and the Works, by the left end of their foot, and the gate by the middle of its. */
export const BUILDINGS: Readonly<Record<"treasury" | "works" | "gate", Pt>> = {
  treasury: { x: 56, y: 120 },
  works: { x: 344, y: 120 },
  gate: { x: 256, y: 98 },
};

/** One of the enormous trunks, by the middle of its foot: half its width above the roots, and its bark's seed. */
export interface Trunk {
  x: number;
  y: number;
  hw: number;
  seed: number;
}

/** The enormous trunks: four across the back, two down each side. */
export const TRUNKS: readonly Trunk[] = [
  { x: 10, y: 106, hw: 44, seed: 1 },
  { x: 196, y: 96, hw: 26, seed: 2 },
  { x: 316, y: 96, hw: 26, seed: 3 },
  { x: 502, y: 108, hw: 44, seed: 4 },
  { x: -12, y: 204, hw: 40, seed: 5 },
  { x: 524, y: 236, hw: 40, seed: 6 },
  { x: -6, y: 344, hw: 44, seed: 7 },
  { x: 520, y: 348, hw: 46, seed: 8 },
];

/** How tall a trunk's picture is: from its foot to well past the top of the map. */
export const trunkTall = (t: Trunk): number => t.y + 210;

// ---------- somewhere to sit, somewhere to be ----------

export interface Seat {
  /** Where the sitter is drawn, and which way they face. */
  x: number;
  y: number;
  dir: Dir;
  /** The clear spot they step up from. */
  from: Pt;
  /** By the fire, on the garden bench or the bench by the Works' door, or at the stump. */
  at: "fire" | "bench" | "works" | "table";
  taken: boolean;
  /** Left for the member: nobody else sits there. */
  yours?: boolean;
}

/** The bench by the Works' door (under the belt, clear of the lantern tree), by its foot. */
export const WORKS_BENCH: Pt = { x: 428, y: 152 };

export const SEATS: Seat[] = [
  { x: 248, y: 201, dir: 0, from: { x: 248, y: 188 }, at: "fire", taken: false },
  { x: 264, y: 201, dir: 0, from: { x: 264, y: 188 }, at: "fire", taken: false, yours: true },
  { x: 248, y: 236, dir: 3, from: { x: 248, y: 246 }, at: "fire", taken: false },
  { x: 264, y: 236, dir: 3, from: { x: 264, y: 246 }, at: "fire", taken: false },
  { x: 221, y: 213, dir: 2, from: { x: 212, y: 214 }, at: "fire", taken: false },
  { x: 291, y: 213, dir: 1, from: { x: 300, y: 214 }, at: "fire", taken: false },
  { x: 114, y: 312, dir: 0, from: { x: 114, y: 320 }, at: "bench", taken: false },
  { x: 127, y: 312, dir: 0, from: { x: 127, y: 320 }, at: "bench", taken: false },
  {
    x: WORKS_BENCH.x - 6,
    y: WORKS_BENCH.y,
    dir: 0,
    from: { x: WORKS_BENCH.x - 6, y: WORKS_BENCH.y + 8 },
    at: "works",
    taken: false,
  },
  {
    x: WORKS_BENCH.x + 7,
    y: WORKS_BENCH.y,
    dir: 0,
    from: { x: WORKS_BENCH.x + 7, y: WORKS_BENCH.y + 8 },
    at: "works",
    taken: false,
  },
  { x: 431, y: 213, dir: 3, from: { x: 431, y: 224 }, at: "table", taken: false, yours: true },
  { x: 457, y: 213, dir: 3, from: { x: 457, y: 224 }, at: "table", taken: false },
];

/**
 * Somewhere to stand and be busy: counting the crabs at the pond, reading the quest board, minding
 * the gate, warming the Works' doorstep, the fire's edge, and watching a game at the stump.
 */
export type Errand = "crabs" | "board" | "gate" | "works" | "fire" | "table";

export interface Spot {
  x: number;
  y: number;
  dir: Dir;
  errand: Errand;
  taken: boolean;
}

const spot = (x: number, y: number, dir: Dir, errand: Errand): Spot => ({ x, y, dir, errand, taken: false });

export const SPOTS: Spot[] = [
  spot(404, 254, 0, "crabs"),
  spot(342, 280, 2, "crabs"),
  spot(188, 166, 3, "board"),
  spot(208, 167, 3, "board"),
  spot(240, 112, 0, "gate"),
  spot(387, 126, 0, "works"),
  spot(398, 131, 1, "works"),
  spot(284, 226, 1, "fire"),
  spot(230, 230, 2, "fire"),
  spot(414, 197, 2, "table"),
  spot(471, 197, 1, "table"),
  spot(437, 171, 0, "table"),
  spot(457, 171, 0, "table"),
];

/** Where the stallkeepers stand, behind each stall by its place in the row, and in front of each (on the counter). */
export const STALL_BEHIND: readonly Pt[] = [
  { x: 60, y: 238 },
  { x: 108, y: 238 },
  { x: 156, y: 238 },
];
export const STALL_FRONT_Y = 249;
/** The top of a stall's counter, for whoever is on it. */
export const STALL_TOP_Y = 233;

/** Where a raid party musters before the gate. */
export const MUSTER: readonly Pt[] = [
  { x: 240, y: 112 },
  { x: 272, y: 113 },
  { x: 250, y: 125 },
  { x: 265, y: 127 },
];

// ---------- the squares, worked out once everything above is known ----------

function build(): void {
  const { blocked, cost, fill } = TOWN;
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
  fill(52, 17, 55, 17, 1); // the bench by the Works' door
  fill(53, 22, 57, 24, 1); // the great stump
  fill(53, 26, 54, 26, 1); // its two log seats
  fill(56, 26, 57, 26, 1);
  // A lantern post takes the square its foot is in.
  for (const p of POSTS) {
    const x = Math.floor(p.x / CELL);
    const y = Math.floor((p.y - 2) / CELL);
    fill(x, y, x, y, 1);
  }
}

build();
