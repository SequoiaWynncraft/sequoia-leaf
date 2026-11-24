/**
 * Every kind of thing that stands in town, as data: the ground it stops walkers on, where somebody
 * may rest on it, the lights it gives, the shadow it casts, and the water and openings some have. A
 * piece of the town (a row of an area, `areas/`) is one of these at a point, its anchor: where its
 * picture's foot goes. Everything here is in pixels from that point. How each kind is drawn and what
 * it does when touched is the page's (`apps/town/src/townart.ts`).
 */

import type { Pt, Rect } from "@sequoia-leaf/core";

/** Which way somebody faces: 0 towards us, 1 left, 2 right, 3 away. */
export type Dir = 0 | 1 | 2 | 3;

/** Who rests where, as the town's seats are kept in order: by the fire, on the garden bench, on the bench by the Works' door, at the stump. */
export const SEAT_AT = ["fire", "bench", "works", "table"] as const;
export type SeatAt = (typeof SEAT_AT)[number];

/** Somewhere to rest on a piece: where the sitter is drawn, and the clear spot they step up from. */
export interface Rest {
  x: number;
  y: number;
  from: Pt;
}

/** A light a piece gives: its middle, how far it reaches and how strong it is. One the page finds has a `name`. */
export interface KindLight {
  x: number;
  y: number;
  r: number;
  power: number;
  name?: string;
}

/** A shadow on the ground under a piece: the middle of an ellipse, and its radii. */
export interface Shadow {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** An ellipse of water: its middle and radii. */
export interface Water {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** What one of a kind's looks has of its own, where it differs from the kind's: its ground, its shadow. */
export interface Look {
  blocks?: readonly Rect[];
  shadow?: Shadow;
}

export interface Kind {
  /** The looks it comes in, a row's `look` from 0, each with what it has of its own. One if not said. */
  looks?: readonly Look[];
  /**
   * The ground it stops walkers on, as boxes. A square is blocked where a box overlaps it: a box
   * from x up to x + w, not including x + w, and the same down.
   */
  blocks?: readonly Rect[];
  /** Where somebody may rest on it, by the way they face: a row's `face` picks the list. */
  rests?: Partial<Record<Dir, readonly Rest[]>>;
  lights?: readonly KindLight[];
  shadow?: Shadow;
  /** The water it holds, as overlapping ellipses: blocked, and painted as water. */
  water?: readonly Water[];
  /** Ground it opens in the town's walls, as boxes as `blocks` are: a way through them. */
  opens?: readonly Rect[];
  /** The gateway it makes in the far hedge: the hedge drops to `y` over `half` either side of it, softening over `soft`. */
  gateway?: { y: number; half: number; soft: number };
  /** Painted on the ground rather than stood up: walked over, and drawn under everything. */
  flat?: true;
}

/** A look with nothing of its own. */
const PLAIN: Look = {};

/** The catalogue. A kind used by no row is fine; a row whose kind is not here does not type-check. */
export const KINDS = {
  /**
   * The enormous trunks round the clearing, each painted on its own (a look each, as the page's
   * `TRUNKS` has them), each with the ground round its foot. Where a trunk stands half outside the
   * town its ground reaches as far out as in.
   */
  trunk: {
    looks: [
      { blocks: [{ x: -38, y: -10, w: 76, h: 32 }] },
      { blocks: [{ x: -28, y: 0, w: 56, h: 8 }] },
      { blocks: [{ x: -28, y: 0, w: 56, h: 8 }] },
      { blocks: [{ x: -30, y: -12, w: 60, h: 40 }] },
      { blocks: [{ x: -52, y: -28, w: 104, h: 32 }] },
      { blocks: [{ x: -52, y: -28, w: 104, h: 32 }] },
      { blocks: [{ x: -54, y: -40, w: 108, h: 48 }] },
      { blocks: [{ x: -56, y: -36, w: 112, h: 40 }] },
    ],
  },
  treasury: {
    blocks: [{ x: 0, y: -24, w: 96, h: 24 }],
    lights: [
      { x: 48, y: -16, r: 44, power: 0.95 },
      { x: 15, y: -26, r: 20, power: 0.7 },
      { x: 80, y: -26, r: 20, power: 0.7 },
    ],
  },
  /** The Treasury's counter, a piece of its own in front of where Cinfy stands. */
  counter: {},
  chest: { blocks: [{ x: -8, y: -9, w: 8, h: 8 }] },
  barrel: {},
  works: {
    blocks: [{ x: 0, y: -24, w: 104, h: 24 }],
    lights: [
      { x: 28, y: -14, r: 40, power: 1, name: "door" },
      { x: 86, y: -30, r: 20, power: 0.7 },
    ],
  },
  belt: { blocks: [{ x: -2, y: -14, w: 56, h: 8 }] },
  /** The crates the belt feeds. */
  pile: { blocks: [{ x: -2, y: -15, w: 16, h: 8 }] },
  /** The gate out to the camps: the way through the far trees, and the gateway in the hedge behind it. */
  gate: {
    opens: [{ x: -16, y: -18, w: 32, h: 16 }],
    gateway: { y: -17, half: 25, soft: 10 },
    lights: [
      { x: -19, y: -33, r: 24, power: 0.9 },
      { x: 19, y: -33, r: 24, power: 0.9 },
      // The last of the sun, coming up the path.
      { x: 0, y: -14, r: 34, power: 0.85 },
    ],
  },
  signpost: {},
  /** The Grove's standing stone, and the young trees either side of it; a light hangs over the stone. */
  grove: {
    blocks: [
      { x: -8, y: -12, w: 16, h: 16 },
      { x: -24, y: -4, w: 8, h: 8 },
      { x: 16, y: -4, w: 8, h: 8 },
    ],
    lights: [{ x: 0, y: -26, r: 30, power: 0.9 }],
  },
  "quest-board": { blocks: [{ x: 0, y: -8, w: 40, h: 8 }] },
  tally: { blocks: [{ x: -22, y: -6, w: 48, h: 8 }] },
  "banner-pole": { blocks: [{ x: -4, y: -8, w: 8, h: 8 }] },
  /** A market stall, by the left end of its foot; each of the three is drawn on its own (a look each). */
  stall: {
    looks: [PLAIN, PLAIN, PLAIN],
    blocks: [{ x: 0, y: -8, w: 40, h: 8 }],
    lights: [{ x: 12, y: -24, r: 34, power: 0.9 }],
    shadow: { x: 20, y: 1, rx: 22, ry: 3 },
  },
  /** A lantern post: it takes the square its foot is in. */
  post: {
    blocks: [{ x: 0, y: -2, w: 1, h: 1 }],
    lights: [{ x: 8, y: -26, r: 36, power: 0.9, name: "lamp" }],
    shadow: { x: 1, y: 0, rx: 5, ry: 2 },
  },
  /**
   * The great stump with the guild's board game cut into it. Its ground leaves out the square at
   * its back left corner, which the lantern post over its board stands on.
   */
  "great-stump": {
    blocks: [
      { x: -12, y: -24, w: 32, h: 8 },
      { x: -20, y: -16, w: 40, h: 16 },
    ],
    shadow: { x: 0, y: 1, rx: 24, ry: 4 },
  },
  /** A short log by the great stump, sat on facing it. */
  "short-log": {
    blocks: [{ x: -7, y: -9, w: 14, h: 8 }],
    rests: { 3: [{ x: 0, y: -4, from: { x: 0, y: 7 } }] },
    shadow: { x: 0, y: 1, rx: 8, ry: 2 },
  },
  /** The lantern tree, which holds a lantern for every raid today. */
  "lantern-tree": {
    blocks: [{ x: -8, y: -8, w: 16, h: 8 }],
    shadow: { x: 0, y: 2, rx: 24, ry: 6 },
  },
  /** The campfire, its ring of stones and its flames. */
  fire: {
    blocks: [{ x: -8, y: -9, w: 16, h: 16 }],
    lights: [{ x: 0, y: -11, r: 64, power: 1, name: "flame" }],
  },
  /** A long log by the fire: sat on from behind it, facing us, or from in front, facing away. */
  log: {
    blocks: [{ x: -16, y: -8, w: 32, h: 8 }],
    rests: {
      0: [
        { x: -8, y: 1, from: { x: -8, y: -12 } },
        { x: 8, y: 1, from: { x: 8, y: -12 } },
      ],
      3: [
        { x: -8, y: -4, from: { x: -8, y: 6 } },
        { x: 8, y: -4, from: { x: 8, y: 6 } },
      ],
    },
    shadow: { x: 0, y: 1, rx: 18, ry: 3 },
  },
  /** A stump by the fire, sat on side on: from the left, facing right, or from the right, facing left. */
  stump: {
    blocks: [{ x: -4, y: -8, w: 8, h: 8 }],
    rests: {
      1: [{ x: -1, y: -3, from: { x: 8, y: -2 } }],
      2: [{ x: 1, y: -3, from: { x: -8, y: -2 } }],
    },
  },
  bench: {
    blocks: [{ x: -16, y: -8, w: 32, h: 8 }],
    rests: {
      0: [
        { x: -6, y: 0, from: { x: -6, y: 8 } },
        { x: 7, y: 0, from: { x: 7, y: 8 } },
      ],
    },
    shadow: { x: 0, y: 1, rx: 15, ry: 2 },
  },
  /** A mushroom: a little one, or a big one. */
  mushroom: {
    looks: [{ shadow: { x: 0, y: 0, rx: 3, ry: 1.5 } }, { shadow: { x: 0, y: 0, rx: 5, ry: 1.5 } }],
  },
  flower: { looks: [PLAIN, PLAIN, PLAIN] },
  bush: {
    looks: [
      { shadow: { x: 0, y: 0, rx: 9, ry: 2 } },
      { shadow: { x: 0, y: 0, rx: 12, ry: 2 } },
      { shadow: { x: 0, y: 0, rx: 7, ry: 2 } },
    ],
  },
  fern: { looks: [PLAIN, PLAIN, PLAIN] },
  rock: { looks: [PLAIN, PLAIN, PLAIN] },
  reeds: {},
  /** A lily pad on the water: plain, or in flower. */
  lily: { looks: [PLAIN, PLAIN], flat: true },
  /** A strip of shade where a shop meets the ground: the Treasury's, or the wider Works'. */
  shade: { looks: [PLAIN, PLAIN], flat: true },
  /** The crab pond, by the middle of its water. */
  pond: {
    water: [
      { x: 0, y: 0, rx: 58, ry: 30 },
      { x: 36, y: -13, rx: 30, ry: 21 },
      { x: -35, y: 11, rx: 29, ry: 19 },
    ],
    flat: true,
  },
} as const satisfies Record<string, Kind>;

export type KindId = keyof typeof KINDS;

/** The kinds painted on the ground, and those that stand. */
export type FlatKind = { [K in KindId]: (typeof KINDS)[K] extends { flat: true } ? K : never }[KindId];
export type StandingKind = Exclude<KindId, FlatKind>;

/** A kind as the catalogue has it, every part of it optional. */
export const kindOf = (id: KindId): Kind => KINDS[id];

export const isFlat = (id: KindId): id is FlatKind => kindOf(id).flat === true;
