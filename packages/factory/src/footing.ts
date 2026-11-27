/**
 * Where somebody may stand in a yard, and how a figure's walking is checked: the one rule a page
 * walks its player's figure by, and Leaf will check visitors' walking by. Places are where a figure's
 * feet are, in pixels of the art, sixteen to a tile, counted from the map's corner, and kept to
 * sixteenths of a pixel so that a page and Leaf mean the same number by one.
 *
 * What is solid goes by the yard's tiles: off the map, land the yard has not bought (the fence keeps
 * to it), the stream, a standing redwood, the depot, and every piece but those that lie flat, which
 * are walked over: belts, splitters, joiners, sorters and tunnel mouths. A figure that something is
 * built on is put on the nearest clear ground (`freed`), by the same rule on every side.
 *
 * Carried over from Outworks' region package (`walk.ts`, `solid.ts`), over the Works' tiles.
 */
import { type KindName, KINDS } from "./content/machines.ts";
import { NONE } from "./tables.ts";
import { redwoodAt, type Yard } from "./yard.ts";

/** Pixels of the art to a tile. */
export const TILE_PX = 16;
/** How fast a figure walks, in pixels a second: four tiles, the town's pace. */
export const WALK = 64;
/** How fast it runs: eight tiles a second, the most anyone goes. */
export const RUN = 128;
/** A place is kept to this many parts of a pixel. */
export const SUB = 16;
/** Half the width of a figure's feet, and how far up from its feet they reach, in pixels. */
export const FOOT = 3;
/** The side of the squares clear ground is looked for in, in pixels: half a tile. */
export const SQUARE = 8;
/** How far apart the looks along a stretch are, in pixels: nothing solid is narrower. */
const LOOK_EVERY = 2;
/** How many rings of squares are looked through for clear ground: 32 tiles. */
const RINGS = 64;

/** Why nothing may stand at a place: off the map, on land not the yard's, on water, or where something stands. */
export const EDGE = "edge";
export const OUTSIDE = "outside";
export const WATER = "water";
export const IN_THE_WAY = "in-the-way";

/** The pieces that lie flat and are walked over. */
const WALKED_OVER: ReadonlySet<KindName> = new Set(["belt", "splitter", "joiner", "sorter", "tunnel"]);
/** 1 for each kind of piece that stands up and is walked round, by kind. */
const STANDS = Uint8Array.from(KINDS, (k) => (WALKED_OVER.has(k) ? 0 : 1));

/** A place: where a figure's feet are, in pixels of the art. */
export interface Place {
  readonly x: number;
  readonly y: number;
}

/** What is solid. */
export interface Solid {
  /** Why nothing may be at a point (pixels of the art), or null where it is clear. */
  at(x: number, y: number): string | null;
  /** A number that changes whenever what is solid may have: whoever has worked something out from it knows to look again. */
  version(): number;
}

/**
 * What is solid in a yard as it stands now: read from its tiles each time it is asked, so a piece
 * built or a plot bought counts at once. Its version is the rules' count of the yard's changes.
 */
export function yardSolid(y: Yard): Solid {
  const { land } = y;
  return {
    version: () => y.rev,
    at(x: number, py: number): string | null {
      if (!(x >= 0 && py >= 0 && x < land.w * TILE_PX && py < land.h * TILE_PX)) return EDGE;
      const i = Math.floor(py / TILE_PX) * land.w + Math.floor(x / TILE_PX);
      const plot = land.plots[land.plot[i] ?? NONE];
      if (!plot || !y.plots.includes(plot.plot)) return OUTSIDE;
      if (land.water[i] === 1) return WATER;
      const k = y.kind[i] ?? NONE;
      return (k !== NONE && STANDS[k] === 1) || redwoodAt(y, i) ? IN_THE_WAY : null;
    },
  };
}

/** A number kept to sixteenths, as a place is. */
export const kept = (v: number): number => Math.round(v * SUB) / SUB;

/**
 * Why a figure's feet do not fit at a place, or null: a little box round the point must be clear.
 * `foot` is half the box's width and its height: a figure's own, unless more room is asked for.
 */
export function unsound(solid: Solid, x: number, y: number, foot = FOOT): string | null {
  return (
    solid.at(x, y) ??
    solid.at(x - foot, y) ??
    solid.at(x + foot, y) ??
    solid.at(x, y - foot) ??
    solid.at(x - foot, y - foot) ??
    solid.at(x + foot, y - foot)
  );
}

/**
 * Why a figure cannot walk straight from one place to another, or null: its feet must fit every
 * two pixels of the way, and at its end. `foot` asks for more room than feet need (`unsound`).
 */
export function blocked(solid: Solid, ax: number, ay: number, bx: number, by: number, foot = FOOT): string | null {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / LOOK_EVERY));
  for (let k = 1; k <= steps; k++) {
    const why = unsound(solid, ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps, foot);
    if (why !== null) return why;
  }
  return null;
}

/** Where a figure stands on a square: a little below its middle. */
export const standOn = (cx: number, cy: number): Place => ({ x: cx * SQUARE + 4, y: cy * SQUARE + 5 });

/**
 * The clear ground nearest a place: the place itself where a figure's feet fit, else the nearest
 * square they fit on, looking outward in rings. A figure shut in by something built is put there.
 */
export function freed(solid: Solid, x: number, y: number): Place {
  if (unsound(solid, x, y) === null) return { x, y };
  const [cx, cy] = [Math.floor(x / SQUARE), Math.floor(y / SQUARE)];
  for (let r = 0; r <= RINGS; r++) {
    let best: Place | null = null;
    let near = Number.POSITIVE_INFINITY;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx += Math.abs(dy) === r ? 1 : Math.max(1, 2 * r)) {
        const p = standOn(cx + dx, cy + dy);
        const far = Math.hypot(p.x - x, p.y - y);
        if (far < near && unsound(solid, p.x, p.y) === null) [best, near] = [p, far];
      }
    if (best !== null) return best;
  }
  return { x, y };
}
