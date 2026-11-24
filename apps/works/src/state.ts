/**
 * What the screen keeps in mind: the yard itself, where the member is looking, what they have in
 * hand, and what is being shown about it. Everything the screen's parts share lives here.
 */

import {
  DEPOT,
  type Dir,
  emptyYard,
  highest,
  type Kind,
  kind,
  KIND_COUNT,
  LAND,
  type Leg,
  type Piece,
  type Plot,
  type Yard,
} from "@sequoia-leaf/factory";
import { shown } from "@sequoia-leaf/kit/card.ts";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

import { TILE } from "./art/belts.ts";
import { aimOf, groupOf, type Hand, IDLE, markOf, runOf, type Tile, toolOf } from "./hand.ts";
import type { Nudge } from "./teach.ts";

/**
 * The kinds of piece this page draws and builds, in the order they sit in the dock (which is also
 * the order of the number keys, as far as the keys go): what makes, what carries, what gives power.
 * The dock, the pick and the drawing all read this list; a test holds it to every kind in the
 * tables but the depot, which is never built.
 */
export const DRAWN: readonly Kind[] = (
  [
    "belt",
    "gatherer",
    "mill",
    "bench",
    "workshop",
    "study",
    "splitter",
    "joiner",
    "sorter",
    "tunnel",
    "stop",
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
 * What an aim or a run was worked out from, beside its tile, the tool and what is in hand: the yard
 * and the rules' count of its changes then (`y.rev`), the Coins to hand then, and what it costs. Of
 * the purse it reads only whether the Coins cover the cost, and when they do not, by how much. When
 * the yard has changed, or the Coins to hand have in a way it reads, it is worked out again for the
 * same tile (`keepAim`, in `tools.ts`).
 */
export interface Reckoned {
  yard: Yard;
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
  /**
   * The grade the piece would stand at: the one in hand, or over a piece of its kind of a higher
   * grade, that piece's, which is only turned. Not said for a tool that builds nothing.
   */
  grade?: number;
  /** Over a piece of its kind of a lower grade: the grade that piece has, which this would raise. */
  raises?: number;
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

/** The tile whose card is pinned open, as the kit's cards have it: the one source of what the yard marks. -1 for none. */
function pinnedTile(): number {
  const card = shown();
  const id = card?.pinned && card.ref.startsWith("tile:") ? card.ref.slice(5) : "";
  return /^\d+$/.test(id) ? Number(id) : -1;
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
  /** Seconds the screen has been running, and whether its clock is being stepped by hand from outside. */
  t: number;
  held: boolean;
  /** The top-left corner of what is on screen, in the yard's pixels. */
  cam: Pt;
  /**
   * The view's size in the yard's pixels, how many screen pixels to each, and the screen's own
   * ratio. `z` is a whole number, but for a step of the plan (`zoom.ts`), where it is under 1: a
   * half or a quarter.
   */
  view: { w: number; h: number; z: number; dpr: number };
  /** What is in hand (`hand.ts`): the one value the tool, its aim, a run, a mark and the pieces held are read from. */
  hand: Hand;
  readonly tool: Tool;
  readonly aim: Aim | null;
  readonly run: Run | null;
  /** A finger's run: the tile it starts from. */
  readonly from: Tile | null;
  /** With Select in hand: the area marked, the first corner of one being marked, the pieces held, and whether Save is asking where. */
  readonly mark: Mark | null;
  readonly corner: Tile | null;
  readonly group: Group | null;
  readonly saving: boolean;
  /** The way a piece in hand faces, and for a sorter, whether it sends the thing it is set to to its right. */
  dir: Dir;
  right: boolean;
  /** The grade each kind of piece is built at when it is in hand, by kind: 0 for one never chosen, which is the first (`gradeInHand`). */
  grades: Uint8Array;
  /** The colour on the brush, 1 to 6, or 0 to take colour off: kept while the page is open. */
  tint: number;
  /** The tile the mouse is over, if it is over the yard. */
  hover: { x: number; y: number } | null;
  /** The last touch was a finger, so building is aimed first and built on a second tap. */
  finger: boolean;
  /** The tile whose card is pinned open (the kit's pinned card is the one source of it), or -1. */
  readonly picked: number;
  /** Plots being cleared before the member's eyes: when each began, in screen seconds, and where from. */
  clearing: Map<Plot, { at: number; x: number; y: number }>;
  /** Which panel is open. */
  panel: string | null;
  /** The nudge being said (`teach.ts`): over its tile, or beside the part of the interface it is about. */
  nudge: Nudge | null;
} = {
  world: emptyYard(LAND),
  visiting: null,
  alone: false,
  t: 0,
  held: false,
  cam: { x: 0, y: 0 },
  view: { w: 320, h: 200, z: 4, dpr: 1 },
  hand: IDLE,
  get tool() {
    return toolOf(S.hand);
  },
  get aim() {
    return aimOf(S.hand);
  },
  get run() {
    return runOf(S.hand);
  },
  get from() {
    return S.hand.is === "beltTaps" ? S.hand.from : null;
  },
  get mark() {
    return markOf(S.hand);
  },
  get corner() {
    return S.hand.is === "select" && S.hand.stage.is === "marking" ? S.hand.stage.corner : null;
  },
  get group() {
    return groupOf(S.hand);
  },
  get saving() {
    return S.hand.is === "select" && S.hand.stage.is === "saving";
  },
  dir: 0,
  right: false,
  grades: new Uint8Array(KIND_COUNT),
  tint: 1,
  hover: null,
  finger: false,
  get picked() {
    return pinnedTile();
  },
  clearing: new Map(),
  panel: null,
  nudge: null,
};

/** The nudge being said over a tile of the yard, if the one being said is. */
export const tileNudge = (): Nudge | null => (S.nudge?.part === undefined ? S.nudge : null);

/**
 * The grade a kind of piece is built at when it is in hand: the one chosen for it, no higher than
 * the yard may build; the first for a kind never chosen, and 1 too for a kind with no grade.
 */
export function gradeInHand(k: Kind): number {
  return Math.max(1, Math.min(S.grades[k] ?? 1, highest(S.world.open, k)));
}
/** The grade the tool in hand builds at: 1 for a tool that builds nothing. */
export const handGrade = (): number => (builds(S.tool) ? gradeInHand(S.tool) : 1);
/**
 * Where the camera is drawn from, along one way, in the yard's pixels: on a whole pixel of the
 * screen. That is a whole pixel of the yard, but for a step of the plan, where a screen pixel is
 * several of the yard's.
 */
export const seenFrom = (cam: number): number =>
  S.view.z >= 1 ? Math.round(cam) : Math.round(cam * S.view.z) / S.view.z;

/** A point on the page as a point in the yard, in the yard's pixels. */
export function toYard(pageX: number, pageY: number): Pt {
  const k = S.view.dpr / S.view.z;
  return { x: pageX * k + seenFrom(S.cam.x), y: pageY * k + seenFrom(S.cam.y) };
}

/** A point in the yard as a point on the page. */
export function toPage(x: number, y: number): Pt {
  const k = S.view.z / S.view.dpr;
  return { x: (x - seenFrom(S.cam.x)) * k, y: (y - seenFrom(S.cam.y)) * k };
}

/** The tile a point on the page is over. */
export function tileAt(pageX: number, pageY: number): { x: number; y: number } {
  const p = toYard(pageX, pageY);
  return { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
}

/** The middle of a tile, in the yard's pixels. */
export const mid = (x: number, y: number): Pt => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
