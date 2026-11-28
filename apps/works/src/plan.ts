/**
 * The yard as a plan: the whole land in one picture, a whole number of pixels to a tile, painted
 * straight from the yard's arrays. Ground the yard owns, plots for sale (dim) and land not for sale
 * (dark); what lies in the ground, quietly, in each thing's own colour; belts and tunnels as lines;
 * machines and gatherers as blocks by kind; the depot, and over the picture the cart stops and the
 * Studies as marks large enough to find.
 *
 * A line is the colour it was painted; unpainted, the colour of the thing it carries; empty, wood.
 * What a line carries is what was last seen on each of its tiles, handed on down the line to tiles
 * that have shown nothing yet, and forgotten a minute after it was last seen: so a line is one
 * colour along its length, not a dot for each thing on it.
 *
 * A plan keeps what it drew, as one number for each tile, and paints again only the tiles whose
 * number has changed: when the rules change the yard (`y.rev`, as the layout is kept), and once for each
 * second of the yard's clock for what the lines carry. It is used for the map (`ui/views.ts`), at
 * 3 pixels to a tile, and for the two steps the camera goes furthest out to (`far.ts`), at 8 and 4.
 */

import {
  ALL_ITEMS,
  ALL_KINDS,
  carries,
  FIXED,
  isRaw,
  type Item,
  type ItemName,
  itemName,
  type Land,
  nextOf,
  NONE,
  OWN,
  plotState,
  redwoodAt,
  tunnelOf,
  wayOut,
  waysOf,
  type Yard,
} from "@sequoia-leaf/factory";
import { BARK, CREAM, GOLD, GREEN, INK, PAPER, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { armAt, PAINTS } from "./art/belts.ts";
import { CLAY, DARK, DEEP } from "./art/pal.ts";
import { hazeOnPlan } from "./haze.ts";
import { pageOf } from "./kinds/index.ts";
import { armsAt, type Layout } from "./layout.ts";

// ---------- colours ----------

/** One of a colour's three parts, as a number: red at 1, green at 3, blue at 5. */
const part = (hex: string, at: number): number => parseInt(hex.slice(at, at + 2), 16);

/** Two colours mixed: `t` of the way from the first to the second. */
function mix(a: string, b: string, t: number): string {
  const one = (at: number): string =>
    Math.round(part(a, at) + (part(b, at) - part(a, at)) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${one(1)}${one(3)}${one(5)}`;
}

/** Each thing's own colour on a plan: the line that carries it, and, quietly, where it lies in the ground. */
const HUE: Readonly<Record<ItemName, string>> = {
  deadfall: BARK[4],
  stone: STONE[2],
  ore: GOLD[0],
  clay: CLAY[1],
  sand: PAPER[2],
  resin: GOLD[1],
  plank: PAPER[0],
  brick: CLAY[2],
  ingot: "#d6d3dc",
  pot: CLAY[3],
  glass: WATER[3],
  oil: GOLD[2],
  tool: STONE[3],
  gear: "#c9923c",
  frame: BARK[3],
  hamper: PAPER[1],
  shell: WATER[2],
  lantern: GOLD[3],
  engine: STONE[1],
  pole: SKY[4],
  kit: GREEN[4],
  beacon: CREAM,
  crab: SKY[5],
  timber: "#bfa98a",
  brass: "#e0b05a",
  pipe: "#9a94a3",
  firework: CLAY[0],
  spyglass: WATER[1],
  clock: SKY[3],
  orrery: GREEN[2],
  salvage: "#7a6a5c",
  copper: "#b86a4a",
  slag: "#4a444e",
  gravel: "#8b8791",
  wire: "#d08a5a",
  coil: "#a85f48",
  bulb: "#efe6c8",
  spark: "#d9c27a",
  telegraph: "#9c8a6a",
  lights: "#e6d9a8",
  tar: "#1f1b24",
  pitch: "#2a2530",
  creosote: "#5a4636",
  spirit: "#c9b98a",
  tarmac: "#353039",
  sleeper: "#6b5040",
  varnish: "#b8873f",
  crystal: "#b9a6d9",
  feed: "#9fb7a6",
  lattice: "#8fb5ad",
  star: "#9f8fd0",
  dish: "#d4d0de",
};
const HUES = ALL_ITEMS.map((n) => HUE[itemName(n)]);

/** Each kind's block, lit and in shade, by its number; nothing for the kinds drawn another way (what carries, the lamp of a pylon, the depot). */
const LOOKS = ALL_KINDS.map((k) => pageOf(k)?.map ?? null);
/** Each kind's lit middle on the map, where it has one (`KindPage.mapMid`). */
const MIDS = ALL_KINDS.map((k) => pageOf(k)?.mapMid ?? null);

/** The ground by whose it is: the yard's (grass at dusk), a plot for sale (dim), land not for sale (dark). */
const GROUNDS = [mix(GREEN[1], SKY[0], 0.22), mix(GREEN[0], DEEP[1], 0.5), DEEP[0]] as const;
const WATERS = [WATER[1], WATER[0], mix(WATER[0], DEEP[0], 0.5)] as const;
const TRUNKS = [BARK[1], BARK[0], mix(BARK[0], DEEP[0], 0.5)] as const;
/** The line a plot's edge is drawn in, where land changes hands. */
const EDGES = GROUNDS.map((g) => mix(g, INK, 0.45));
/** How much of a thing's colour shows where it lies in the ground: quiet on the yard's own land, quieter beyond. */
const QUIET = [0.5, 0.34, 0.22] as const;
/** The things that lie in the ground, a raw each (a thing of step 0), in the tables' order. */
export const LYING: readonly Item[] = ALL_ITEMS.filter(isRaw);
/** What lies on a tile as the map keeps it in 4 bits: a thing's place among those that lie in the ground, from 1; 0 for nothing. */
const LIES_AT = Uint8Array.from(ALL_ITEMS, (n) => LYING.indexOf(n) + 1);
export const liesOf = (n: number): number => LIES_AT[n] ?? 0;
const LIES = GROUNDS.map((g, of) => LYING.map((n) => mix(g, HUE[itemName(n)], QUIET[of] ?? 0.3)));
/** A belt's dark bed, and the wood of a line that carries nothing. */
const BED = mix(BARK[0], INK, 0.45);
const WOOD = BARK[2];
/**
 * A line's paint or, unpainted, what it carries, as the map keeps it in 7 bits (never both drawn): 0
 * for neither, a paint as itself (1 to 7), a thing as 8 more than its number.
 */
export const lineField = (tint: number, load: number): number => (tint > 0 ? tint : load === NONE ? 0 : 8 + load);
/** The colour a line is drawn in, from its field: its paint's, else its thing's own, else wood. */
export const lineColour = (field: number): string =>
  field === 0 ? WOOD : field < 8 ? (PAINTS[field - 1]?.lit ?? WOOD) : (HUES[field - 8] ?? WOOD);
/** A thing's own colour on a plan. */
export const hueOf = (n: Item): string => HUE[itemName(n)];
/** The depot: its roof, lit and in shade, its planks, and the brass wheel on it. */
const ROOF = [SKY[3], SKY[2]] as const;
/** A mark on a piece in trouble. */
const ALARM = "#ff6b6b";

// ---------- what the plans are painted from, looked at once for all of them ----------

/** A thing a line was last seen carrying is forgotten after this many seconds of the yard's clock without it. */
const FORGET = 60;

/**
 * What every plan is painted from beside the yard's own arrays, by tile: the thing each tile that
 * carries was last seen carrying, and for how many seconds it has not been seen; whose the ground is
 * (0 the yard's, 1 for sale, 2 not for sale); where a plot's edge runs (a bit for the north side and
 * one for the west); which way a tunnel passes under (a bit for east to west, one for north to
 * south); and the tiles of the cart stops and the Studies.
 */
interface Seen {
  land: Land;
  yard: Yard | null;
  rev: number;
  /** The second of the yard's clock last looked at, and a count that moves whenever a plan may have to paint. */
  second: number;
  turn: number;
  carried: Uint8Array;
  age: Uint8Array;
  ground: Uint8Array;
  edge: Uint8Array;
  under: Uint8Array;
  spots: number[];
}
let seen: Seen | null = null;

/** Whose each tile's ground is, where the plots' edges run, where tunnels pass under, and where the stops and Studies stand. */
function lie(s: Seen, y: Yard): void {
  const { land } = y;
  const W = land.w;
  const of = land.plots.map((p) => (y.plots.includes(p.plot) ? 0 : plotState(y, p.plot).state === "for sale" ? 1 : 2));
  for (let i = 0; i < s.ground.length; i++) s.ground[i] = of[land.plot[i] ?? NONE] ?? 2;
  s.under.fill(0);
  s.spots.length = 0;
  for (let i = 0; i < s.ground.length; i++) {
    const x = i % W;
    const here = land.plot[i] ?? NONE;
    const mine = s.ground[i] === 0;
    // An edge where the land above or to the left is another plot, and not both the yard's.
    const north = i >= W && land.plot[i - W] !== here && !(mine && s.ground[i - W] === 0);
    const west = x > 0 && land.plot[i - 1] !== here && !(mine && s.ground[i - 1] === 0);
    s.edge[i] = (north ? 1 : 0) | (west ? 2 : 0);
    const k = y.kind[i] ?? NONE;
    if (pageOf(k)?.spot) s.spots.push(i);
    if (!carries(k)) s.carried[i] = NONE;
    if (tunnelOf(y, i) < 0) continue;
    const step = land.step[(y.dir[i] ?? 0) & 3] ?? 0;
    const way = Math.abs(step) === 1 ? 1 : 2;
    for (let n = 1, j = i + step; n <= (y.span[i] ?? 0) && j >= 0 && j < s.under.length; n++, j += step)
      s.under[j] = (s.under[j] ?? 0) | way;
  }
}

/** Hands what a tile was seen carrying on to a tile it hands to that has shown nothing yet. */
function hand(s: Seen, y: Yard, i: number, to: number): void {
  if (to < 0 || !carries(y.kind[to] ?? NONE) || s.carried[to] !== NONE) return;
  s.carried[to] = s.carried[i] ?? NONE;
  s.age[to] = s.age[i] ?? 0;
}

/**
 * Looks at the yard for every plan: each time, what is on the tiles that carry; and when what stands
 * has changed (`rev`) or the yard's clock has reached another second, the slower things, after which
 * the plans compare what they drew with what there is.
 */
function look(y: Yard): Seen {
  const n = y.kind.length;
  if (seen?.land !== y.land)
    seen = {
      land: y.land,
      yard: null,
      rev: -1,
      second: -1,
      turn: 0,
      carried: new Uint8Array(n).fill(NONE),
      age: new Uint8Array(n),
      ground: new Uint8Array(n),
      edge: new Uint8Array(n),
      under: new Uint8Array(n),
      spots: [],
    };
  const s = seen;
  const carry = y.wire?.carry;
  if (carry)
    for (let c = 0; c < carry.length; c++) {
      const i = carry[c] ?? 0;
      const on = y.item[i] ?? NONE;
      if (on === NONE) continue;
      s.carried[i] = on;
      s.age[i] = 0;
    }
  const second = Math.floor(y.tick / 10);
  const stands = s.rev !== y.rev || s.yard !== y;
  if (!stands && s.second === second) return s;
  if (stands) lie(s, y);
  // A second of the yard's clock: what has not been seen for a minute is forgotten.
  if (s.second !== second)
    for (let i = 0; i < n; i++) {
      if (s.carried[i] === NONE) continue;
      const age = (s.age[i] ?? 0) + 1;
      if (age > FORGET) s.carried[i] = NONE;
      else s.age[i] = age;
    }
  // Down each line, from where things come: the plumbing lists each tile after those it hands to.
  const order = y.wire?.order;
  if (order)
    for (let o = order.length - 1; o >= 0; o--) {
      const i = order[o] ?? 0;
      const k = y.kind[i] ?? NONE;
      // A piece that sends each thing by what it is (a sorter) carries no line on.
      if (s.carried[i] === NONE || !carries(k) || pageOf(k)?.sorts) continue;
      const ways = waysOf(k);
      if (ways > 0) for (let way = 0; way < ways; way++) hand(s, y, i, wayOut(y, i, way));
      else hand(s, y, i, nextOf(y, i));
    }
  s.yard = y;
  s.rev = y.rev;
  s.second = second;
  s.turn++;
  return s;
}

/**
 * The thing the line through a tile was last seen carrying, or `NONE`: looked at as a plan looks
 * (`rev` is the yard's count of changes). A plan paints a line this colour.
 */
export const carriedAt = (y: Yard, i: number): number => look(y).carried[i] ?? NONE;

// ---------- a plan ----------

export interface Plan {
  /** Pixels to a tile. */
  readonly px: number;
  /** The picture: the land's tiles, `px` pixels each. */
  readonly c: HTMLCanvasElement;
  readonly g: Ctx;
  /** What was drawn on each tile, as one number (`numberOf`); and the look it was last compared at. */
  drawn: Uint32Array;
  turn: number;
  land: Land | null;
  /** Nothing drawn can be trusted: the browser took the picture's memory back. */
  lost: boolean;
  /** The marks for a cart stop and a Study, drawn over the picture. */
  readonly stop: HTMLCanvasElement;
  readonly study: HTMLCanvasElement;
}

/** A mark large enough to find: a square for a cart stop, a diamond for a Study, each with a dark edge. */
function mark(px: number, diamond: boolean, lit: string, shade: string): HTMLCanvasElement {
  const half = Math.max(3, Math.floor(px / 2) + 2);
  const size = half * 2 + 3;
  const { c, g } = makeCanvas(size, size);
  const shape = (grow: number, col: string): void => {
    g.fillStyle = col;
    const r = half + grow;
    if (!diamond) g.fillRect(half + 1 - r, half + 1 - r, r * 2 + 1, r * 2 + 1);
    else
      for (let d = -r; d <= r; d++)
        g.fillRect(half + 1 - (r - Math.abs(d)), half + 1 + d, (r - Math.abs(d)) * 2 + 1, 1);
  };
  shape(1, INK);
  shape(0, shade);
  shape(-1, lit);
  shape(-half + 1, INK);
  return c;
}

/** A plan at so many pixels to a tile, with nothing drawn on it yet. */
export function makePlan(px: number): Plan {
  const made = makeCanvas(1, 1, true);
  const p: Plan = {
    px,
    ...made,
    drawn: new Uint32Array(0),
    turn: -1,
    land: null,
    lost: true,
    stop: mark(px, false, GOLD[2], GOLD[0]),
    study: mark(px, true, CREAM, SKY[4]),
  };
  made.c.addEventListener("contextrestored", () => {
    p.lost = true;
  });
  return p;
}

/**
 * A tile as one number: everything its picture is painted from. From the low bits: whose ground (2),
 * a plot's edges (2), water, a redwood, what lies in it (4, `liesOf`), what stands on it (5), a belt's
 * arms, which part of the depot, or a piece's middle lit (8), a line's paint or what it carries (7,
 * `lineField`), a tunnel under it (2).
 */
function numberOf(s: Seen, y: Yard, L: Layout, i: number, depot: number): number {
  const { land } = y;
  const k = y.kind[i] ?? NONE;
  const lies = land.deposit[i] ?? NONE;
  let n =
    (s.ground[i] ?? 0) |
    ((s.edge[i] ?? 0) << 2) |
    ((land.water[i] ?? 0) << 4) |
    ((redwoodAt(y, i) ? 1 : 0) << 5) |
    (liesOf(lies) << 6) |
    ((s.under[i] ?? 0) << 30);
  if (k === NONE) return n >>> 0;
  n |= (k + 1) << 10;
  if (carries(k)) {
    const tint = y.tint[i] ?? 0;
    const load = s.carried[i] ?? NONE;
    // A kind the picture near does not draw yet has no arms in the layout: they are worked out here.
    n |= ((L.arms[i] || armsAt(y, i)) << 15) | (lineField(tint, load) << 23);
  } else if (FIXED[k] === 1) {
    const W = land.w;
    n |= ((i % W) - (depot % W) + 1 + (Math.floor(i / W) - Math.floor(depot / W) + 1) * 3) << 15;
  } else n |= midLit(y, i, k) << 15;
  return n >>> 0;
}

/** 1 where the piece on a tile has its middle lit on the map, on its own tile (`KindPage.mapMid`: a grower holding star crystals); else 0. */
const midLit = (y: Yard, i: number, k: number): number =>
  MIDS[k]?.lit(y, i) === true && (y.part[i] === 0 || y.part[i] === OWN) ? 1 : 0;

/** Paints one tile of a plan from its number, at its corner. */
function tile(g: Ctx, P: number, x: number, y: number, n: number): void {
  const ground = n & 3;
  const edge = (n >> 2) & 3;
  const lies = (n >> 6) & 15;
  const kind = ((n >> 10) & 31) - 1;
  const detail = (n >> 15) & 255;
  // A line's width and the ground left either side of it: 1 and 1 of 3 pixels, 2 and 1 of 4, 4 and 2 of 8.
  const m = Math.floor(P / 3);
  const t = P - m * 2;
  g.fillStyle =
    (n >> 4) & 1
      ? (WATERS[ground] ?? DARK)
      : (n >> 5) & 1
        ? (TRUNKS[ground] ?? DARK)
        : lies > 0
          ? (LIES[ground]?.[lies - 1] ?? DARK)
          : (GROUNDS[ground] ?? DARK);
  g.fillRect(x, y, P, P);
  g.fillStyle = EDGES[ground] ?? INK;
  if (edge & 1) g.fillRect(x, y, P, 1);
  if (edge & 2) g.fillRect(x, y, 1, P);
  if (kind < 0) {
    // A tunnel under open ground: a dark dot a tile, so the line reads on across.
    if (n >>> 30 === 0) return;
    g.fillStyle = BED;
    g.fillRect(x + m, y + m, t, t);
    return;
  }
  if (carries(kind)) {
    const line = lineColour((n >> 23) & 127);
    // The bed, a pixel wider than the line each side, and then the line: the middle, and an arm to each side it joins.
    for (let pass = 0; pass < 2; pass++) {
      const grow = pass === 0 ? 1 : 0;
      const a = m - grow;
      const wide = t + grow * 2;
      g.fillStyle = pass === 0 ? BED : line;
      g.fillRect(x + a, y + a, wide, wide);
      const east = armAt(detail, 0);
      const south = armAt(detail, 1);
      const west = armAt(detail, 2);
      const north = armAt(detail, 3);
      if (east === 1 || east === 2) g.fillRect(x + m + t, y + a, m, wide);
      if (south === 1 || south === 2) g.fillRect(x + a, y + m + t, wide, m);
      if (west === 1 || west === 2) g.fillRect(x, y + a, m, wide);
      if (north === 1 || north === 2) g.fillRect(x + a, y, wide, m);
    }
    // Brass where a line parts or meets, stone at a tunnel's mouth: as its kind marks it.
    const mid = pageOf(kind)?.mapMark;
    if (mid) {
      g.fillStyle = mid;
      g.fillRect(x + m, y + m, t, t);
    }
    return;
  }
  const lamp = pageOf(kind)?.mapLamp;
  if (lamp) {
    // A lamp: small, so that a row of them does not read as machines.
    g.fillStyle = INK;
    g.fillRect(x + m - 1, y + m - 1, t + 2, t + 2);
    g.fillStyle = lamp;
    g.fillRect(x + m, y + m, t, t);
    return;
  }
  if (FIXED[kind] === 1) {
    // Nine tiles as one building: its roof, darker along the foot, a dark edge all round, the brass wheel in the middle.
    const col = detail % 3;
    const row = Math.floor(detail / 3);
    g.fillStyle = row === 2 ? ROOF[1] : ROOF[0];
    g.fillRect(x, y, P, P);
    g.fillStyle = INK;
    if (col === 0) g.fillRect(x, y, 1, P);
    if (col === 2) g.fillRect(x + P - 1, y, 1, P);
    if (row === 0) g.fillRect(x, y, P, 1);
    if (row === 2) g.fillRect(x, y + P - 1, P, 1);
    if (detail === 4) {
      g.fillStyle = GOLD[1];
      g.fillRect(x, y, P, P);
    }
    return;
  }
  block(g, P, x, y, kind, detail === 1);
}

/** A piece's block on a tile of a plan: at 8 pixels with a dark edge, darker along its foot, and its middle lit where its kind lights it (`MIDS`). */
function block(g: Ctx, P: number, x: number, y: number, kind: number, lit: boolean): void {
  const colours = LOOKS[kind];
  if (!colours) return;
  // A block: at 8 pixels with a dark edge, and always darker along its foot, so that a row of them is told apart.
  const inset = P >= 8 ? 1 : 0;
  if (inset > 0) {
    g.fillStyle = INK;
    g.fillRect(x, y, P, P);
  }
  g.fillStyle = colours[0];
  g.fillRect(x + inset, y + inset, P - inset * 2, P - inset * 2);
  g.fillStyle = colours[1];
  const foot = P >= 8 ? 2 : 1;
  g.fillRect(x + inset, y + P - inset - foot, P - inset * 2, foot);
  const mid = MIDS[kind];
  if (!lit || !mid) return;
  const m = Math.floor(P / 3);
  g.fillStyle = mid.colour;
  g.fillRect(x + m, y + m, P - m * 2, P - m * 2);
}

/**
 * Brings a plan up to date with the yard and gives its picture. `L` is the yard's layout (its
 * belts' arms) and `rev` its count of changes, as the layout is kept. Whatever the yard's size it
 * compares a number for each tile at most once a second, and paints only the tiles that differ.
 */
export function paintPlan(p: Plan, y: Yard, L: Layout): HTMLCanvasElement {
  const s = look(y);
  const { land } = y;
  const n = y.kind.length;
  if (p.land !== land || p.c.width !== land.w * p.px || p.c.height !== land.h * p.px) {
    p.land = land;
    p.c.width = land.w * p.px;
    p.c.height = land.h * p.px;
    p.drawn = new Uint32Array(n);
    p.lost = true;
  }
  if (p.turn === s.turn && !p.lost) return p.c;
  const depot = land.depot[1] * land.w + land.depot[0];
  const P = p.px;
  for (let i = 0; i < n; i++) {
    const now = numberOf(s, y, L, i, depot);
    if (now === p.drawn[i] && !p.lost) continue;
    p.drawn[i] = now;
    tile(p.g, P, (i % land.w) * P, Math.floor(i / land.w) * P, now);
  }
  p.turn = s.turn;
  p.lost = false;
  return p.c;
}

/**
 * Lays a plan on a picture with its corner at (`dx`, `dy`), and over it the marks large enough to
 * find: a square on each cart stop, a diamond on each Study. The plan must have been painted.
 */
export function layPlan(g: Ctx, p: Plan, y: Yard, dx: number, dy: number): void {
  g.drawImage(p.c, dx, dy);
  hazeOnPlan(g, y, dx, dy, p.px);
  const W = y.land.w;
  // The depot: a pale line round its nine tiles.
  const [cx, cy] = y.land.depot;
  const size = p.px * 3 + 2;
  g.fillStyle = CREAM;
  g.fillRect(dx + (cx - 1) * p.px - 1, dy + (cy - 1) * p.px - 1, size, 1);
  g.fillRect(dx + (cx - 1) * p.px - 1, dy + (cy + 2) * p.px, size, 1);
  g.fillRect(dx + (cx - 1) * p.px - 1, dy + (cy - 1) * p.px - 1, 1, size);
  g.fillRect(dx + (cx + 2) * p.px, dy + (cy - 1) * p.px - 1, 1, size);
  const s = seen;
  if (!s || s.spots.length === 0) return;
  for (const i of s.spots) {
    const pic = pageOf(y.kind[i] ?? NONE)?.spot === "study" ? p.study : p.stop;
    const half = (pic.width - p.px) / 2;
    g.drawImage(pic, dx + (i % W) * p.px - Math.floor(half), dy + Math.floor(i / W) * p.px - Math.floor(half));
  }
}

/**
 * The mark on a piece in trouble, over a plan laid at (`dx`, `dy`): a ring round its tile with a
 * dark edge, the piece still to be seen inside it, fading and coming back slowly with the screen's
 * clock (`t`, in seconds).
 */
export function alarm(g: Ctx, px: number, tx: number, ty: number, dx: number, dy: number, t: number): void {
  const wide = px >= 8 ? 2 : 1;
  const x = dx + tx * px - wide;
  const y = dy + ty * px - wide;
  const size = px + wide * 2;
  g.globalAlpha = 0.65 + 0.35 * Math.sin(t * 3);
  for (const [grow, col] of [
    [1, INK],
    [0, ALARM],
  ] as const) {
    const w = wide + grow * 2;
    g.fillStyle = col;
    g.fillRect(x - grow, y - grow, size + grow * 2, w);
    g.fillRect(x - grow, y + size - wide - grow, size + grow * 2, w);
    g.fillRect(x - grow, y - grow, w, size + grow * 2);
    g.fillRect(x + size - wide - grow, y - grow, w, size + grow * 2);
  }
  g.globalAlpha = 1;
}

/** The colour a kind's block is on a plan, for showing one that is about to be built; a line's wood for what carries. */
export const blockColour = (kind: number): string => LOOKS[kind]?.[0] ?? pageOf(kind)?.mapLamp ?? WOOD;
