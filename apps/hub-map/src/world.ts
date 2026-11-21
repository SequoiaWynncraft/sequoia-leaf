/**
 * The province as plain facts: where things stand, the roads between them, and the lands. Everything
 * is in art pixels on a map `W` by `H`; the screen is a window onto it.
 */
import { hash2 } from "./rand.ts";

export const W = 1024;
export const H = 736;
export type Pt = { x: number; y: number };

const N = (x: number, y: number): Pt => ({ x, y });

/** Where people stand. A node is the spot in front of a thing, not the thing itself. */
export const NODES = {
  town: N(500, 344),
  treasury: N(466, 323),
  board: N(534, 322),
  market: N(552, 368),
  fire: N(484, 372),
  westgate: N(428, 342),
  millfork: N(300, 270),
  hillfoot: N(252, 198),
  gateA: N(222, 140),
  mill: N(152, 274),
  otter: N(285, 470),
  stonering: N(108, 456),
  gateC: N(172, 614),
  northgate: N(506, 284),
  northfork: N(522, 206),
  gateB: N(758, 118),
  eastgate: N(578, 342),
  works: N(690, 322),
  shore: N(772, 414),
  pond: N(796, 522),
  southgate: N(498, 404),
  camp: N(478, 552),
  bracken: N(398, 636),
  reed: N(640, 640),
} satisfies Record<string, Pt>;
export type NodeId = keyof typeof NODES;

type EdgeDef = { a: NodeId; b: NodeId; main?: true; via?: [number, number][] };
const DEFS: EdgeDef[] = [
  { a: "town", b: "treasury" },
  { a: "town", b: "board" },
  { a: "town", b: "market" },
  { a: "town", b: "fire" },
  { a: "town", b: "westgate", main: true },
  { a: "treasury", b: "westgate" },
  { a: "town", b: "northgate", main: true },
  { a: "board", b: "northgate" },
  { a: "town", b: "eastgate", main: true },
  { a: "market", b: "eastgate" },
  { a: "town", b: "southgate", main: true },
  { a: "fire", b: "southgate" },
  { a: "westgate", b: "millfork", main: true, via: [[372, 316]] },
  { a: "millfork", b: "hillfoot" },
  { a: "hillfoot", b: "gateA" },
  { a: "millfork", b: "mill", via: [[226, 262]] },
  { a: "millfork", b: "otter", via: [[304, 368]] },
  { a: "otter", b: "stonering", via: [[196, 478]] },
  { a: "otter", b: "gateC", via: [[240, 552]] },
  { a: "northgate", b: "northfork", main: true },
  {
    a: "northfork",
    b: "gateB",
    via: [
      [600, 158],
      [690, 150],
    ],
  },
  { a: "eastgate", b: "works", main: true, via: [[634, 326]] },
  { a: "works", b: "shore", via: [[742, 364]] },
  { a: "shore", b: "pond", via: [[790, 468]] },
  {
    a: "southgate",
    b: "shore",
    via: [
      [600, 436],
      [700, 428],
    ],
  },
  { a: "southgate", b: "camp", main: true, via: [[496, 472]] },
  { a: "camp", b: "bracken", via: [[446, 604]] },
  { a: "camp", b: "reed", via: [[562, 610]] },
];

export type Edge = { a: NodeId; b: NodeId; main: boolean; pts: Pt[]; cum: number[]; len: number };

/** A smooth line through the given points, sampled every few pixels. */
export function smoothLine(ctrl: Pt[], step = 3): Pt[] {
  const out: Pt[] = [];
  const at = (i: number): Pt => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))] as Pt;
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (p2.y - p0.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(at(ctrl.length - 1));
  return out;
}

export const EDGES: Edge[] = DEFS.map((d, i) => {
  const a = NODES[d.a];
  const b = NODES[d.b];
  const ctrl: Pt[] = [a];
  if (d.via) for (const [x, y] of d.via) ctrl.push({ x, y });
  else {
    // A road with no bend given still wanders a little, so none is ruler-straight.
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 46) {
      const k = (hash2(i, 7, 3) - 0.5) * 0.22;
      ctrl.push({ x: (a.x + b.x) / 2 - (b.y - a.y) * k, y: (a.y + b.y) / 2 + (b.x - a.x) * k });
    }
  }
  ctrl.push(b);
  const pts = smoothLine(ctrl);
  const cum = [0];
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k] as Pt;
    const q = pts[k - 1] as Pt;
    cum.push((cum[k - 1] as number) + Math.hypot(p.x - q.x, p.y - q.y));
  }
  return { a: d.a, b: d.b, main: d.main === true, pts, cum, len: cum[cum.length - 1] as number };
});

/** The point a distance `s` along a road. */
export function edgePoint(e: number, s: number): Pt {
  const edge = EDGES[e] as Edge;
  const { pts, cum } = edge;
  if (s <= 0) return pts[0] as Pt;
  if (s >= edge.len) return pts[pts.length - 1] as Pt;
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((cum[mid] as number) <= s) lo = mid;
    else hi = mid;
  }
  const p = pts[lo] as Pt;
  const q = pts[hi] as Pt;
  const t = (s - (cum[lo] as number)) / ((cum[hi] as number) - (cum[lo] as number) || 1);
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

// ---------- shortest ways between nodes ----------

const IDS = Object.keys(NODES) as NodeId[];
const INDEX = new Map<NodeId, number>(IDS.map((id, i) => [id, i]));
const COUNT = IDS.length;
const dist = new Float64Array(COUNT * COUNT).fill(Number.POSITIVE_INFINITY);
const hop = new Int16Array(COUNT * COUNT).fill(-1);
const via = new Int16Array(COUNT * COUNT).fill(-1);
const idx = (id: NodeId): number => INDEX.get(id) as number;
for (let i = 0; i < COUNT; i++) dist[i * COUNT + i] = 0;
EDGES.forEach((e, n) => {
  const a = idx(e.a);
  const b = idx(e.b);
  dist[a * COUNT + b] = e.len;
  dist[b * COUNT + a] = e.len;
  hop[a * COUNT + b] = b;
  hop[b * COUNT + a] = a;
  via[a * COUNT + b] = n;
  via[b * COUNT + a] = n;
});
for (let k = 0; k < COUNT; k++)
  for (let i = 0; i < COUNT; i++)
    for (let j = 0; j < COUNT; j++) {
      const d = (dist[i * COUNT + k] as number) + (dist[k * COUNT + j] as number);
      if (d < (dist[i * COUNT + j] as number)) {
        dist[i * COUNT + j] = d;
        hop[i * COUNT + j] = hop[i * COUNT + k] as number;
      }
    }

/** One stretch of a walk: along road `e` from one distance to another (backwards when `to < from`). */
export type Leg = { e: number; from: number; to: number };

export const roadDistance = (a: NodeId, b: NodeId): number => dist[idx(a) * COUNT + idx(b)] as number;

export function route(a: NodeId, b: NodeId): Leg[] {
  const legs: Leg[] = [];
  let at = idx(a);
  const end = idx(b);
  while (at !== end) {
    const next = hop[at * COUNT + end] as number;
    if (next < 0) break;
    const e = via[at * COUNT + next] as number;
    const edge = EDGES[e] as Edge;
    legs.push(idx(edge.a) === at ? { e, from: 0, to: edge.len } : { e, from: edge.len, to: 0 });
    at = next;
  }
  return legs;
}

// ---------- the river, the rope of lanterns, and other fixed things ----------

export const RIVER: Pt[] = [
  N(386, -8),
  N(402, 92),
  N(360, 182),
  N(382, 266),
  N(368, 330),
  N(374, 402),
  N(422, 456),
  N(496, 474),
  N(572, 480),
  N(652, 522),
  N(732, 572),
  N(812, 612),
  N(900, 652),
];

/** The rope across the plaza where raid lanterns hang: its two pole tops, and how far it sags. */
export const ROPE = { ax: 452, ay: 316, bx: 548, by: 316, sag: 8, slots: 17 };
export function ropeSlot(i: number): Pt {
  // Filled from the middle outwards, so a few lanterns already look deliberate.
  const order = i % ROPE.slots;
  const half = (ROPE.slots - 1) / 2;
  const k = half + (order % 2 === 0 ? 1 : -1) * Math.ceil(order / 2);
  const t = (k + 0.5) / ROPE.slots;
  const row = Math.floor(i / ROPE.slots);
  return { x: ROPE.ax + (ROPE.bx - ROPE.ax) * t, y: ROPE.ay + Math.sin(t * Math.PI) * ROPE.sag + 1 + row * 5 };
}

export type Hue = "amber" | "coral" | "violet" | "teal" | "cream";
export type GateId = "gateA" | "gateB" | "gateC";
export const GATES: Record<GateId, { name: string; hue: Hue; x: number; y: number; lore: string }> = {
  gateA: { name: "Gloamgate", hue: "violet", x: 222, y: 130, lore: "An arch in the hills that hums at dusk." },
  gateB: { name: "Tidecaller's Arch", hue: "teal", x: 758, y: 108, lore: "It only opens when the tide is listening." },
  gateC: { name: "Emberroot Gate", hue: "coral", x: 172, y: 604, lore: "Warm to the touch. Nobody asks why." },
};

export type PlaceId =
  | "town"
  | "treasury"
  | "board"
  | "market"
  | "fire"
  | "works"
  | "gateA"
  | "gateB"
  | "gateC"
  | "pond"
  | "camp";

export type Place = {
  id: PlaceId;
  node: NodeId;
  name: string;
  /** Where its label hangs, and the middle and reach of what answers a tap. */
  lx: number;
  ly: number;
  hx: number;
  hy: number;
  hr: number;
  /** How close the map comes when you are taken there. */
  zoom: number;
  /** `far` shows only from high up, `near` only close in, `both` always. */
  tier: "far" | "near" | "both";
};

export const PLACES: Place[] = [
  { id: "town", node: "town", name: "Guild Town", lx: 500, ly: 268, hx: 500, hy: 340, hr: 62, zoom: 3.4, tier: "far" },
  { id: "treasury", node: "treasury", name: "Treasury", lx: 466, ly: 284, hx: 466, hy: 304, hr: 17, zoom: 3.6, tier: "near" },
  { id: "board", node: "board", name: "Quest board", lx: 534, ly: 292, hx: 534, hy: 308, hr: 13, zoom: 3.6, tier: "near" },
  { id: "market", node: "market", name: "Market", lx: 553, ly: 338, hx: 553, hy: 354, hr: 20, zoom: 3.6, tier: "near" },
  { id: "fire", node: "fire", name: "Campfire", lx: 484, ly: 352, hx: 484, hy: 370, hr: 14, zoom: 3.8, tier: "near" },
  { id: "works", node: "works", name: "The Works", lx: 694, ly: 264, hx: 694, hy: 298, hr: 26, zoom: 3, tier: "both" },
  { id: "gateA", node: "gateA", name: GATES.gateA.name, lx: 222, ly: 98, hx: 222, hy: 120, hr: 20, zoom: 3, tier: "both" },
  { id: "gateB", node: "gateB", name: GATES.gateB.name, lx: 758, ly: 76, hx: 758, hy: 98, hr: 20, zoom: 3, tier: "both" },
  { id: "gateC", node: "gateC", name: GATES.gateC.name, lx: 172, ly: 572, hx: 172, hy: 594, hr: 20, zoom: 3, tier: "both" },
  { id: "pond", node: "pond", name: "Crab pond", lx: 820, ly: 494, hx: 820, hy: 516, hr: 26, zoom: 3.4, tier: "both" },
  { id: "camp", node: "camp", name: "Your camp", lx: 462, ly: 518, hx: 464, hy: 540, hr: 20, zoom: 3.4, tier: "both" },
];
export const place = (id: PlaceId): Place => PLACES.find((p) => p.id === id) as Place;

/** Who holds a land: the guild, nobody, or the rival company. */
export type Owner = 0 | 1 | 2;
export type Land = {
  name: string;
  x: number;
  y: number;
  owner: Owner;
  /** Where its banner stands. */
  bx: number;
  by: number;
  /** A border land that changes hands, and the node scouts gather at. */
  node?: NodeId;
};

export const RIVAL = "the Ashen Company";

export const LANDS: Land[] = [
  { name: "Frostfern", x: 92, y: 84, owner: 1, bx: 122, by: 112 },
  { name: "Gloam Hollow", x: 242, y: 124, owner: 0, bx: 266, by: 156 },
  { name: "Pinewatch", x: 448, y: 98, owner: 0, bx: 452, by: 128 },
  { name: "Kestrel Rise", x: 622, y: 92, owner: 0, bx: 610, by: 112 },
  { name: "Tidecall Head", x: 806, y: 112, owner: 0, bx: 816, by: 160 },
  { name: "Millbrook", x: 112, y: 276, owner: 0, bx: 196, by: 300 },
  { name: "Fernhollow", x: 296, y: 290, owner: 0, bx: 326, by: 232 },
  { name: "The Grove", x: 500, y: 340, owner: 0, bx: 452, by: 400 },
  { name: "Cinderworks", x: 694, y: 300, owner: 0, bx: 736, by: 334 },
  { name: "Saltgrass", x: 838, y: 292, owner: 0, bx: 836, by: 300 },
  { name: "Stonering", x: 96, y: 456, owner: 1, bx: 124, by: 444, node: "stonering" },
  { name: "Otter Bend", x: 286, y: 472, owner: 1, bx: 300, by: 456, node: "otter" },
  { name: "Homefield", x: 472, y: 550, owner: 0, bx: 524, by: 536 },
  { name: "Lanternlea", x: 652, y: 440, owner: 0, bx: 652, by: 454 },
  { name: "Crab Cove", x: 816, y: 506, owner: 0, bx: 770, by: 486 },
  { name: "Emberroot", x: 158, y: 626, owner: 1, bx: 200, by: 640 },
  { name: "Sootwater", x: 268, y: 716, owner: 2, bx: 272, by: 700 },
  { name: "Brackenmoor", x: 396, y: 652, owner: 2, bx: 414, by: 624, node: "bracken" },
  { name: "Ashen Fen", x: 546, y: 704, owner: 2, bx: 536, by: 690 },
  { name: "Reedmere", x: 652, y: 630, owner: 0, bx: 658, by: 622, node: "reed" },
];

/** Where the windmill, the lighthouse and the standing stones are, for drawing and for taps. */
export const MILL = { x: 138, y: 258 };
export const LIGHTHOUSE = { x: 914, y: 132 };
export const STONES = { x: 100, y: 436 };
export const WORKS = { x: 694, y: 308, chimneyX: 707, chimneyY: 266 };
export const TREASURY = { x: 466, y: 314 };
export const POND = { x: 822, y: 516, rx: 21, ry: 11 };
export const CAMP = { x: 460, y: 544, fireX: 488, fireY: 558, flagX: 446, flagY: 547 };
export const FIRE = { x: 484, y: 366 };
