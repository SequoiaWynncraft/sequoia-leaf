/**
 * What follows from the town's table (`town.ts`), worked out once: every piece by its id, the
 * ground (which squares are blocked, what a step costs, the water, the hedge), the rest spots, the
 * places, the lights and shadows, the strings of lights, and every spot fixed to a piece, each where
 * it is in the town. The page and the town's clock read all of it from here.
 */

import { clamp, type Pt, type Rect, vnoise } from "@sequoia-leaf/core";

import { CELL, type Ground, makeGround, type Trodden, troddenD } from "./grid.ts";
import { type Dir, type KindId, kindOf, SEAT_AT, type SeatAt } from "./kinds.ts";
import {
  type At,
  type AtBox,
  type Faced,
  type Group,
  type PathOn,
  PLACE_IDS,
  type PlaceId,
  type PlaceRow,
  type Post,
  type Row,
  type Some,
  type Stand,
} from "./rows.ts";
import { TOWN_MAP } from "./town.ts";

const { bounds: BOUNDS, ground: GROUND, areas: AREAS } = TOWN_MAP;
export { BOUNDS };

// ---------- the pieces ----------

/** A piece of the town as it stands: a row of the table, or one of a group's, with what it leaves out filled in. */
export interface Piece {
  id: string;
  kind: KindId;
  x: number;
  y: number;
  look: number;
  face: Dir | null;
  at: SeatAt | null;
  yours: number | null;
}

const ROWS = AREAS.flatMap((a) => a.pieces);
/** The rows that are part of nothing, by id: what a part's point, or a group's, is from. */
const WHOLES = new Map(ROWS.flatMap((r): [string, Row][] => ("x" in r && r.piece === undefined ? [[r.id, r]] : [])));

/** Where a row's or a group's points are from: the anchor of the whole it is part of, or the town's corner. */
function anchorOf(row: Row | Group): Pt {
  if (row.piece === undefined) return { x: 0, y: 0 };
  const whole = WHOLES.get(row.piece);
  if (!whole) throw new Error(`${row.id} is part of ${row.piece}, which is no row of its own.`);
  return whole;
}

/** A row as its piece, or a group as its pieces, each where it is in the town. */
function expand(row: Row | Group): Piece[] {
  const on = anchorOf(row);
  if ("x" in row) {
    const { id, kind, look = 0, face = null, at = null, yours = null } = row;
    return [{ id, kind, x: on.x + row.x, y: on.y + row.y, look, face, at, yours }];
  }
  return row.points.map(([x, y, look = 0], i) => ({
    id: `${row.id}.${i}`,
    kind: row.kind,
    x: on.x + x,
    y: on.y + y,
    look,
    face: null,
    at: null,
    yours: null,
  }));
}

/** Every piece, area by area, each in the area's order: a group's in turn where the group is. */
export const PIECES: readonly Piece[] = ROWS.flatMap(expand);

const BY_ID = new Map(PIECES.map((p) => [p.id, p]));
/** The pieces that are rows, by id: everything fixed to a piece names one of these, never one of a group's. */
const ROW_IDS = new Set(ROWS.flatMap((r) => ("x" in r ? [r.id] : [])));

/** The piece of an id. A name that is no piece's is a mistake in the table: it stops the town. */
export function piece(id: string): Piece {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`No piece in town is called ${id}.`);
  return p;
}

/** Every piece of a kind, in the table's order. */
export const piecesOf = (kind: KindId): Piece[] => PIECES.filter((p) => p.kind === kind);

/** A point fixed to a piece, where it is in the town. Only a row is something to fix things to. */
export function pointOf(a: At): Pt {
  if (!ROW_IDS.has(a.piece)) throw new Error(`Something is fixed to ${a.piece}, which is no row of the town.`);
  const p = piece(a.piece);
  return { x: p.x + a.x, y: p.y + a.y };
}

/** A list with something in it, each of it made something else: still a list with something in it. */
const each = <T, U>(list: Some<T>, f: (t: T) => U): Some<U> => [f(list[0]), ...list.slice(1).map(f)];

/** Somewhere somebody stands: where, and which way they face. */
export interface Spot extends Pt {
  dir: Dir;
}

const spotOf = (a: Faced): Spot => ({ ...pointOf(a), dir: a.dir });
const boxOf = (a: AtBox): Rect => ({ ...pointOf(a), w: a.w, h: a.h });
/** Boxes from a piece's anchor, where they are in the town. */
const placed = (p: Piece, boxes: readonly Rect[]): Rect[] =>
  boxes.map((b) => ({ x: p.x + b.x, y: p.y + b.y, w: b.w, h: b.h }));

// ---------- the ground ----------

/** A stretch of trodden earth where it is in the town: one of a piece's from its anchor. */
function stretched(path: Trodden | PathOn): Trodden {
  if (!("piece" in path)) return path;
  const a = pointOf({ piece: path.piece, ...path.from });
  const b = pointOf({ piece: path.piece, ...path.to });
  return [a.x, a.y, b.x, b.y, path.half];
}

/** All the trodden earth: the areas' paths, and each clearing as a stretch with both ends at its middle. */
const TRODDEN: readonly Trodden[] = [
  ...AREAS.flatMap((a) => a.paths).map(stretched),
  ...AREAS.flatMap((a) => a.clearings).map((c): Trodden => {
    const { x, y } = pointOf(c);
    return [x, y, x, y, c.r];
  }),
];

/** How far outside the town's trodden earth a point is (negative: on a path), with a ragged edge. */
export const pathD = (x: number, y: number): number => troddenD(TRODDEN, x, y);

/** All the water, each ellipse where it is in the town. */
const WATER = PIECES.flatMap((p) =>
  (kindOf(p.kind).water ?? []).map((w) => ({ x: p.x + w.x, y: p.y + w.y, rx: w.rx, ry: w.ry })),
);

/** How far outside the water a point is (negative: in it). */
export function pondD(x: number, y: number): number {
  let d = 999;
  for (const { x: cx, y: cy, rx, ry } of WATER)
    d = Math.min(d, (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry));
  return d + (vnoise(x / 11, y / 11, 9) - 0.5) * 6;
}

/** The gateways in the far hedge: each one's middle across, the y the hedge drops to there, and its reach. */
const GATEWAYS = PIECES.flatMap((p) => {
  const g = kindOf(p.kind).gateway;
  return g ? [{ x: p.x, y: p.y + g.y, half: g.half, soft: g.soft }] : [];
});

/** The gateway a column is furthest into, and how far, 0 to 1: there the ground drops away and the sun comes through. */
function opening(x: number): { y: number; k: number } {
  let best = { y: 0, k: 0 };
  for (const g of GATEWAYS) {
    const k = clamp((g.half - Math.abs(x - g.x)) / g.soft, 0, 1);
    const smooth = k * k * (3 - 2 * k);
    if (smooth > best.k) best = { y: g.y, k: smooth };
  }
  return best;
}

/** How far into a gateway a column is, 0 to 1. */
export const gateway = (x: number): number => opening(x).k;

/** Where the far hedge tops out: the clearing ends there and the sunset shows above it. */
export function hedgeY(x: number): number {
  const top = GROUND.hedge + vnoise(x / 13, 0, 21) * 7 + vnoise(x / 5, 3, 22) * 3;
  const gate = opening(x);
  return Math.round(top + (gate.y - top) * gate.k);
}

/** The boxes of ground a piece stops walkers on, where they are in the town: its look's, or its kind's. */
export function blocksOf(p: Piece): Rect[] {
  const k = kindOf(p.kind);
  return placed(p, k.looks?.[p.look]?.blocks ?? k.blocks ?? []);
}

/** The squares a box overlaps: the first and last across and down (none if the last is before the first). */
export const squaresOf = (b: Rect): { x0: number; y0: number; x1: number; y1: number } => ({
  x0: Math.floor((b.x - BOUNDS.x) / CELL),
  y0: Math.floor((b.y - BOUNDS.y) / CELL),
  x1: Math.ceil((b.x + b.w - BOUNDS.x) / CELL) - 1,
  y1: Math.ceil((b.y + b.h - BOUNDS.y) / CELL) - 1,
});

/**
 * The town's own ground: the water, the walls but where a piece opens a way through them, and
 * whatever the pieces stand on are blocked, and a step onto trodden earth is easier than one onto
 * grass; each square as at its middle.
 */
export const TOWN: Ground = (() => {
  const g = makeGround(BOUNDS.w / CELL, BOUNDS.h / CELL, pathD, BOUNDS);
  for (let cy = 0; cy < g.gh; cy++) {
    for (let cx = 0; cx < g.gw; cx++) {
      const px = BOUNDS.x + cx * CELL + 4;
      const py = BOUNDS.y + cy * CELL + 4;
      g.blocked[cy * g.gw + cx] = pondD(px, py) < 3 ? 1 : 0;
      g.cost[cy * g.gw + cx] = pathD(px, py) < 1 ? 1 : 1.7;
    }
  }
  const fill = (b: Rect, v: number): void => {
    const s = squaresOf(b);
    g.fill(s.x0, s.y0, s.x1, s.y1, v);
  };
  for (const b of GROUND.walls) fill(b, 1);
  for (const p of PIECES) for (const b of placed(p, kindOf(p.kind).opens ?? [])) fill(b, 0);
  for (const b of PIECES.flatMap(blocksOf)) fill(b, 1);
  return g;
})();

// ---------- somewhere to rest ----------

/** Somewhere to rest: where the sitter is drawn and faces, the clear spot they step up from, who rests there, and whether it is the member's. */
export interface RestSpot extends Spot {
  /** The piece's id and the spot's place in its list: `fire-log-north:1`. */
  id: string;
  piece: string;
  from: Pt;
  at: SeatAt;
  yours: boolean;
}

function restsOn(p: Piece): RestSpot[] {
  const { face, at } = p;
  if (face === null || at === null) return [];
  return (kindOf(p.kind).rests?.[face] ?? []).map((r, i) => ({
    id: `${p.id}:${i}`,
    piece: p.id,
    x: p.x + r.x,
    y: p.y + r.y,
    dir: face,
    from: { x: p.x + r.from.x, y: p.y + r.from.y },
    at,
    yours: p.yours === i,
  }));
}

/** Every rest spot, those by the fire first, then on the garden bench, the Works' bench and at the stump (`SEAT_AT`), each in the table's order. */
export const RESTS: readonly RestSpot[] = SEAT_AT.flatMap((at) => PIECES.filter((p) => p.at === at).flatMap(restsOn));

// ---------- places ----------

export interface Place extends Omit<PlaceRow, "stand" | "prompt"> {
  /** Where to stand to use it, and where its prompt floats, in the town. */
  stand: Pt;
  prompt: Pt;
}

/** A place's row, its stand and prompt where they are in the town. */
const placeOf = (pl: PlaceRow): Place => ({
  ...pl,
  stand: pointOf({ piece: pl.piece, ...pl.stand }),
  prompt: pointOf({ piece: pl.piece, ...pl.prompt }),
});

/** Every place, in the order they are listed (`PLACE_IDS`), wherever its area is. */
export const PLACES: readonly Place[] = PLACE_IDS.flatMap((id) =>
  AREAS.flatMap((a) => a.places)
    .filter((pl) => pl.id === id)
    .map(placeOf),
);

export function place(id: PlaceId): Place {
  const p = PLACES.find((q) => q.id === id);
  if (!p) throw new Error(`no place ${id}`);
  return p;
}

// ---------- lights and shadows ----------

/** A light in town: the piece giving it, its name if the page finds it, its middle, reach and strength. */
export interface TownLight {
  /** Its piece's id and its name, or its number among the piece's lights: `works:door`, `treasury:1`. */
  id: string;
  piece: string;
  name: string | null;
  x: number;
  y: number;
  r: number;
  power: number;
}

/** Every light the pieces give, in the pieces' order. */
export const LIGHTS: readonly TownLight[] = PIECES.flatMap((p) =>
  (kindOf(p.kind).lights ?? []).map((l, i) => ({
    id: `${p.id}:${l.name ?? i}`,
    piece: p.id,
    name: l.name ?? null,
    x: p.x + l.x,
    y: p.y + l.y,
    r: l.r,
    power: l.power,
  })),
);

/** The light of a piece by its name. */
export function lightOf(id: string, name: string): TownLight {
  const l = LIGHTS.find((q) => q.piece === id && q.name === name);
  if (!l) throw new Error(`${id} gives no light called ${name}`);
  return l;
}

/** Every shadow under the pieces, in the pieces' order: an ellipse's middle and radii, its look's or its kind's. */
export const SHADOWS: readonly ({ piece: string } & Pt & { rx: number; ry: number })[] = PIECES.flatMap((p) => {
  const k = kindOf(p.kind);
  const s = k.looks?.[p.look]?.shadow ?? k.shadow;
  return s ? [{ piece: p.id, x: p.x + s.x, y: p.y + s.y, rx: s.rx, ry: s.ry }] : [];
});

// ---------- spots ----------

const busy = (at: Stand): { middle: Pt; spots: Some<Spot> } => ({
  middle: pointOf(TOWN_MAP.busy[at].middle),
  spots: each(TOWN_MAP.busy[at].spots, spotOf),
});

/** Where members busy at each game stand, laid by hand, the first wanted most; and the middle of the place. */
export const BUSY: Readonly<Record<Stand, { middle: Pt; spots: Some<Spot> }>> = {
  works: busy("works"),
  table: busy("table"),
  grove: busy("grove"),
};

const errands = (post: Post): Some<Spot> => each(TOWN_MAP.errands[post], spotOf);

/** Where the town's own go to be busy: on each errand, on the Works' doorstep and at the fire's edge. */
export const ERRANDS: Readonly<Record<Post, Some<Spot>>> = {
  crabs: errands("crabs"),
  board: errands("board"),
  gate: errands("gate"),
  works: errands("works"),
  fire: errands("fire"),
};

/** Where each crab lives, by its turn at roll call, and whether that is on a rock out in the water. */
export const CRAB_HOMES: Some<Pt & { perched: boolean }> = each(TOWN_MAP.crabs, (c) => ({
  ...pointOf(c),
  perched: c.perched ?? false,
}));

/** Somewhere the missing crab hides: where, and how far down the town it is sorted among what stands there. */
export interface Hide extends Pt {
  z: number;
}

const hideOf = (h: At & { z: number }): Hide => ({ ...pointOf(h), z: piece(h.piece).y + h.z });
const [HIDE_A, HIDE_B, ...HIDE_REST] = TOWN_MAP.hides;
/** Where the missing crab hides, in turn: at least one place for even stretches and one for odd. */
export const HIDES: readonly [Hide, Hide, ...Hide[]] = [hideOf(HIDE_A), hideOf(HIDE_B), ...HIDE_REST.map(hideOf)];

/** A keeper's spot: where they stand, and how far up they are drawn. */
const keeperOf = (k: At & { lift: number }): Pt & { lift: number } => ({ ...pointOf(k), lift: k.lift });

/** Cinfy behind the Treasury's counter; and for each stall by its number, its piece, its keeper, and where a keeper who naps lies. */
export const KEEPERS = {
  counter: keeperOf(TOWN_MAP.keepers.counter),
  stalls: each(TOWN_MAP.keepers.stalls, (k) => ({
    piece: k.piece,
    keeper: keeperOf(k),
    nap: keeperOf({ piece: k.piece, ...k.nap }),
  })),
};

/** The trail through the gate, in the town (`TownMap.trail`). */
export const TRAIL = {
  out: pointOf(TOWN_MAP.trail.out),
  way: pointOf(TOWN_MAP.trail.way),
  in: pointOf(TOWN_MAP.trail.in),
  back: pointOf(TOWN_MAP.trail.back),
};

/** Where glints are looked for on the pond, and where fireflies rise: over the pond, then over the garden. */
export const GLINTS: Rect = boxOf(TOWN_MAP.glints);
export const FIREFLIES: readonly [pond: Rect, garden: Rect] = [
  boxOf(TOWN_MAP.fireflies[0]),
  boxOf(TOWN_MAP.fireflies[1]),
];

/** A string of lights: where its two ends are tied, and how far its middle sags below the line between them. */
export interface Strand {
  from: Pt;
  to: Pt;
  sag: number;
}

/** The strings of lights, each end where the piece it is tied to has it. */
export const STRINGS: readonly Strand[] = TOWN_MAP.strings.map((s) => ({
  from: pointOf(s.from),
  to: pointOf(s.to),
  sag: s.sag,
}));
