/**
 * What the town's table is made of: a piece's row, a group of small pieces, a place, a clearing, an
 * area of the town, and the table itself (`TOWN_MAP`, in `town.ts`).
 *
 * Positions are the town's pixels, from its top-left corner; y goes down the screen. A piece's `x`
 * and `y` is its anchor, where its picture's foot goes; everything fixed to a piece is from its
 * anchor. Ways to face: 0 towards us, 1 left, 2 right, 3 away.
 */

import type { Pt, Rect } from "@sequoia-leaf/core";

import type { Errand } from "../folk.ts";
import type { Trodden } from "./grid.ts";
import type { Dir, KindId, SeatAt } from "./kinds.ts";

/** The places, in the order they are listed: the dock's buttons, left to right, and the doors a touch tries. */
export const PLACE_IDS = [
  "treasury",
  "grove",
  "quests",
  "tally",
  "market",
  "works",
  "table",
  "fire",
  "pond",
  "camp",
] as const;
export type PlaceId = (typeof PLACE_IDS)[number];

/** A list with something in it: what the town picks one of by number can never be empty. */
export type Some<T> = readonly [T, ...T[]];

/** A game a member can be in that has a place in town to stand at. */
export type Stand = "works" | "table" | "grove";

/** Where the town's own go to be busy: on each errand, on the Works' doorstep and at the fire's edge. */
export type Post = Errand | "works" | "fire";

/**
 * A piece of the town: one thing of a kind, at a point. With a `piece`, it is part of that one (the
 * Treasury's counter, the fire's logs), and its point is from that piece's anchor: moving the whole
 * moves its parts. Only one level: the piece it is part of is part of nothing.
 */
export interface Row {
  /** Its name in the town, never used for another: what everything fixed to it names it by. */
  id: string;
  kind: KindId;
  piece?: string;
  x: number;
  y: number;
  /** Which of its kind's looks, from 0. */
  look?: number;
  /** Which way whoever rests on it faces: picks the list of its kind's rest spots. */
  face?: Dir;
  /** Who rests on it, as the dozers choose: needed where its kind has rest spots. */
  at?: SeatAt;
  /** Which of its rest spots, from 0, is kept for the member: nobody else sits there. */
  yours?: number;
}

/**
 * Many small pieces of one kind, each a point and a look: `id.0`, `id.1` and so on, in turn. With
 * a `piece`, they belong to it (the lily pads to the pond), and their points are from its anchor.
 */
export interface Group {
  id: string;
  kind: KindId;
  piece?: string;
  points: readonly (readonly [x: number, y: number, look?: number])[];
}

/** A point fixed to a piece, from its anchor. */
export interface At {
  piece: string;
  x: number;
  y: number;
}

/** A point fixed to a piece, and which way somebody there faces. */
export interface Faced extends At {
  dir: Dir;
}

/** A box fixed to a piece: its top-left corner from the anchor, and its size. */
export interface AtBox extends At {
  w: number;
  h: number;
}

/** Trodden earth round a piece: its middle from the piece's anchor, and how far it reaches. */
export interface Clearing extends At {
  r: number;
}

/** A straight stretch of trodden earth that is part of a piece (the way in from the gate): both ends from its anchor, and half its width. */
export interface PathOn {
  piece: string;
  from: Pt;
  to: Pt;
  half: number;
}

export interface PlaceRow {
  id: PlaceId;
  name: string;
  /** What it is, in a line, for whoever points at it, where its name does not say. */
  about?: string;
  /** The piece it is: where to stand to use it and where its prompt floats are from its anchor. */
  piece: string;
  stand: Pt;
  face: Dir;
  prompt: Pt;
}

/**
 * An area of the town: its pieces, its places, the trodden earth round its pieces, and its paths,
 * straight stretches of trodden earth from one point of the town to another (x1, y1, x2, y2 and
 * half-width), or part of a piece. The town grows by whole areas.
 */
export interface Area {
  pieces: readonly (Row | Group)[];
  places: readonly PlaceRow[];
  clearings: readonly Clearing[];
  paths: readonly (Trodden | PathOn)[];
}

/** Somebody who keeps a counter or a stall: where they stand, and how far up they are drawn (on the counter's top). */
export interface Keeper extends At {
  lift: number;
}

export interface TownMap {
  /** The town's ground, in pixels: what can be walked on, and the size of Leaf's live room for it. */
  bounds: Rect;
  ground: {
    /** Where the far hedge tops out, but for gateways in it (a kind's `gateway`). */
    hedge: number;
    /** The town's edges, which are nobody's piece: boxes, blocking the squares they overlap as a kind's do. */
    walls: readonly (Rect & { id: string })[];
  };
  areas: readonly Area[];
  /**
   * Where members busy at each game stand, laid by hand, the first wanted most; and the middle of
   * the place, which the spots worked out past these face and are nearest to.
   */
  busy: Readonly<Record<Stand, { middle: At; spots: Some<Faced> }>>;
  /** Where the town's own go to be busy, a spot of the list each time they go. */
  errands: Readonly<Record<Post, Some<Faced>>>;
  /** Where each crab lives, by its turn at roll call (the missing one has none); some on rocks out in the water. */
  crabs: Some<At & { perched?: true }>;
  /** Where the missing crab hides, in turn, at least one place for even stretches and one for odd; and how much nearer than the piece it is drawn. */
  hides: readonly [At & { z: number }, At & { z: number }, ...(At & { z: number })[]];
  /** Cinfy behind the Treasury's counter; each stall's keeper, by the stall's number, and where a keeper who naps lies. */
  keepers: { counter: Keeper; stalls: Some<Keeper & { nap: Pt & { lift: number } }> };
  /**
   * The trail through the gate: where somebody walking in from it is put (`out`) and where a walk
   * out ends; the gate, walked through on the way out (`way`); where a member arriving walks to
   * (`in`), and one back from their camp (`back`).
   */
  trail: { out: At; way: At; in: At; back: At };
  /** Where glints are looked for on the pond, and where fireflies rise: over the pond, then over the garden. */
  glints: AtBox;
  fireflies: readonly [pond: AtBox, garden: AtBox];
  /** The strings of lights: each end tied to a piece, and how far the middle sags below the line between them. */
  strings: readonly { from: At; to: At; sag: number }[];
}
