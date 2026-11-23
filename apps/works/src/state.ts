/**
 * What the screen keeps in mind: the yard itself, where the member is looking, what they have in
 * hand, and what is being shown about it. Everything the screen's parts share lives here.
 */

import {
  DEPOT,
  type Dir,
  emptyYard,
  type Kind,
  kind,
  KIND_COUNT,
  LAND,
  type Leg,
  type Piece,
  type Plot,
  type Yard,
} from "@sequoia-leaf/factory";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./art/belts.ts";

/**
 * The kinds of piece this page draws and builds, in the order they sit in the dock (which is also
 * the order of the number keys). Any other (the Study, the cart stop, the sorter, which a yard has
 * only further on) is drawn as a plain post with nothing of a belt about it, is not in the dock, and
 * is not taken up as a tool. The dock, the pick and the drawing all read this list.
 */
export const DRAWN: readonly Kind[] = (
  [
    "belt",
    "gatherer",
    "mill",
    "bench",
    "workshop",
    "splitter",
    "joiner",
    "tunnel",
    "crate",
    "pylon",
    "wheel",
    "boiler",
  ] as const
).map(kind);
const drawn = new Uint8Array(KIND_COUNT);
for (const k of DRAWN) drawn[k] = 1;
// The depot is drawn, and has its card, though nobody builds one: it is not in the dock.
drawn[DEPOT] = 1;
/** Whether this page draws a kind of piece: those it builds (`DRAWN`), and the depot. */
export const draws = (k: number): boolean => drawn[k] === 1;

/**
 * What is in the member's hand: a kind of piece to build (by its number), the spade that takes
 * things away, Select for many pieces at once, the brush that colours lines, or nothing.
 */
export type Tool = Kind | "remove" | "select" | "paint" | null;
/** Whether a tool is something to build. */
export const builds = (tool: Tool): tool is Kind => typeof tool === "number";

/**
 * What an aim or a run was worked out from, beside its tile, the tool and what is in hand: the
 * yard's count of changes (`S.rev`) and the Coins to hand then, and what it costs. Of the purse it
 * reads only whether the Coins cover the cost, and when they do not, by how much. When the yard has
 * changed, or the Coins to hand have in a way it reads, it is worked out again for the same tile
 * (`keepAim`, in `tools.ts`).
 */
export interface Reckoned {
  rev: number;
  coins: number;
  cost: number;
}

/** A place being pointed at to build on, and what would come of it. */
export interface Aim extends Reckoned {
  x: number;
  y: number;
  /** Why it cannot go there, or nothing if it can. */
  why: string | null;
  /** What it would cost. */
  cost: number;
  /** For a tunnel, the tile its far mouth would come up on: worked out once for the aim, not each frame. */
  far?: number;
}

/** A run of belt shown before it is laid. */
export interface Run extends Reckoned {
  legs: Leg[];
  /** Belts already standing that the run would turn, as tile and way. */
  turns: { x: number; y: number; dir: Dir }[];
  cost: number;
  why: string | null;
}

/** An area marked with Select: its corners, the tiles of the pieces in it, the pieces, and what they cost. */
export interface Mark {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  tiles: number[];
  pieces: Piece[];
  cost: number;
}

/** A set of pieces in hand, to be set down as one. */
export interface Group {
  /** The marked pieces being moved, a copy of them, or the blueprint in a place (by its number). */
  as: "move" | "copy" | number;
  /** For a move or a copy, the tiles of the pieces taken up: what stands there is what is set down, as the rules do it. */
  tiles: readonly number[];
  /** Quarter turns to the right it has been given. */
  turns: Dir;
  /** Where it is aimed (`S.aim`): the pieces as they would stand, and why each cannot. */
  at: Piece[];
  why: (string | null)[];
}

export const S: {
  /** The page's copy of Leaf's yard (`yard.ts`), as the rules hold it: flat arrays, read where it is drawn and decided. */
  world: Yard;
  /**
   * Whose yard it is when it is not the member's own: a visit, where they look about and change
   * nothing. Each part of the screen that acts on the yard asks this.
   */
  visiting: { readonly id: string; name: string } | null;
  /**
   * The yard was handed to the page by a review page of its own (`review/bench.ts`), not opened from
   * Leaf: nothing is opened, sent or kept, and the yard is not run on but by `works.bench`.
   */
  alone: boolean;
  /**
   * Counts every change to the yard that is not a tick's: a command done, a yard taken from Leaf, a
   * goal finished (what is open changes with it). What is worked out from the yard and kept (an aim,
   * the layout) is looked at again when it moves, and worked out again if what it reads differs.
   * Only `yard.ts` moves it.
   */
  rev: number;
  /** Seconds the screen has been running, and whether its clock is being stepped by hand from outside. */
  t: number;
  held: boolean;
  /** The top-left corner of what is on screen, in the yard's pixels. */
  cam: Pt;
  /** The picture's size in the yard's pixels, how many screen pixels to each, and the screen's own ratio. */
  view: { w: number; h: number; z: number; dpr: number };
  tool: Tool;
  dir: Dir;
  /** The colour on the brush, 1 to 6, or 0 to take colour off: kept while the page is open. */
  tint: number;
  /** The tile the mouse is over, if it is over the yard. */
  hover: { x: number; y: number } | null;
  /** The last touch was a finger, so building is aimed first and built on a second tap. */
  finger: boolean;
  /** Where the next piece is aimed, and for a belt the run that would be laid. */
  aim: Aim | null;
  from: { x: number; y: number } | null;
  run: Run | null;
  /** With Select in hand: the area marked, the first corner of one being marked, and the pieces in hand. */
  mark: Mark | null;
  corner: { x: number; y: number } | null;
  group: Group | null;
  /** Save was pressed: the line over the dock is asking which place to keep the marked pieces in. */
  saving: boolean;
  /** The tile whose card is open. */
  picked: number;
  /** Plots being cleared before the member's eyes: when each began, in screen seconds, and where from. */
  clearing: Map<Plot, { at: number; x: number; y: number }>;
  /** Which panel is open. */
  panel: string | null;
  /** The tile a nudge is pointing at, and what it says; and the tool it wants picked up. */
  nudge: { x: number; y: number; text: string; id: string } | null;
  nudgeTool: Tool;
} = {
  world: emptyYard(LAND),
  visiting: null,
  alone: false,
  rev: 0,
  t: 0,
  held: false,
  cam: { x: 0, y: 0 },
  view: { w: 320, h: 200, z: 4, dpr: 1 },
  tool: null,
  dir: 0,
  tint: 1,
  hover: null,
  finger: false,
  aim: null,
  from: null,
  run: null,
  mark: null,
  corner: null,
  group: null,
  saving: false,
  picked: -1,
  clearing: new Map(),
  panel: null,
  nudge: null,
  nudgeTool: null,
};

/** A point on the page as a point in the yard, in the yard's pixels. */
export function toYard(pageX: number, pageY: number): Pt {
  const k = S.view.dpr / S.view.z;
  return { x: pageX * k + Math.round(S.cam.x), y: pageY * k + Math.round(S.cam.y) };
}

/** A point in the yard as a point on the page. */
export function toPage(x: number, y: number): Pt {
  const k = S.view.z / S.view.dpr;
  return { x: (x - Math.round(S.cam.x)) * k, y: (y - Math.round(S.cam.y)) * k };
}

/** The tile a point on the page is over. */
export function tileAt(pageX: number, pageY: number): { x: number; y: number } {
  const p = toYard(pageX, pageY);
  return { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
}

/** The middle of a tile, in the yard's pixels. */
export const mid = (x: number, y: number): Pt => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
