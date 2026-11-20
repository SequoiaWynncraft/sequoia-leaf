/**
 * The Forest's geometry, from the bundle's manifest (grove/forest.py): how wide each parallax layer
 * is, where each sits for a camera, what a screen shows, and which member stands on which spot.
 *
 * The valley's ground is `valley` pixels wide (1024) and the bundle's picture `view` wide (256). The
 * camera's centre `cx` runs from `view / 2` to `valley - view / 2`, and a layer at depth f starts
 * `(cx - view / 2) * f` pixels into itself, so the ground (f = 1) slides past one for one, the far
 * valley (0.35) slowly and the near ferns and trunks (1.3) faster. A layer is just wide enough for
 * that: `view + (valley - view) * f`.
 */

import { variantOf } from "../../bundle/manifest.ts";

/** A layer's width: what a view `view` wide sees of it as the camera crosses the whole valley. */
export const layerWidth = (depth: number, valley: number, view: number): number =>
  Math.ceil(view + (valley - view) * depth);

/** How many columns into a layer at `depth` the picture starts, for a camera centred on ground `cx`. */
export const layerOffset = (cx: number, depth: number, view: number): number => Math.round((cx - view / 2) * depth);

/** The camera's centre, kept to where the picture never shows past the valley's ends. */
export const clampCamera = (cx: number, valley: number, view: number): number =>
  Math.max(view / 2, Math.min(valley - view / 2, cx));

export interface Look {
  /** The layers' camera. */
  cx: number;
  /** The picture's first column on screen. */
  cropX: number;
}

/** Where a screen `shown` columns wide may look: the ground x at its middle, end to end. */
export function lookRange(shown: number, valley: number): [number, number] {
  return [shown / 2, valley - shown / 2];
}

/**
 * What a screen `shown` columns wide (at most the picture's width) sees, its middle on ground x
 * `at`: the layers' camera, and the columns of the picture it shows. A narrow screen (a phone) sees
 * the middle of the picture; past the camera's range its crop slides on, so it reaches the valley's
 * ends too.
 */
export function look(at: number, shown: number, valley: number, view: number): Look {
  const w = Math.min(shown, view);
  const [lo, hi] = lookRange(w, valley);
  const a = Math.max(lo, Math.min(hi, at));
  const cx = clampCamera(a, valley, view);
  const cropX = Math.round(a - cx + (view - w) / 2);
  return { cx, cropX: Math.max(0, Math.min(view - w, cropX)) };
}

/** A ground x's column in the picture for a camera on `cx`; a far or near x's with its depth. */
export const toPicture = (x: number, cx: number, view: number, depth = 1): number => x - layerOffset(cx, depth, view);

/** A picture column's ground x for a camera on `cx`. */
export const toGround = (px: number, cx: number, view: number): number => px + layerOffset(cx, 1, view);

// ---------------------------------------------------------------------------------------------
// Members on spots.

export interface Grower {
  /** Stable: the member's UUID in the real game. */
  seed: string;
  level: number;
  /** 0 is the guild's oldest member. */
  tenure: number;
}

export interface Spot {
  row: string;
  x: number;
}

export interface Planted<M extends Grower> {
  member: M;
  /** Its place in the manifest's spots, nearest the heart first. */
  spot: number;
  row: string;
  x: number;
  /** Its tree in the row's atlas: `L<level>-v<variant>`. */
  key: string;
}

/** The order members stand in from the heart outward: the highest trees first, the older member first among equals. */
export const byStanding = <M extends Grower>(a: M, b: M): number =>
  b.level - a.level || a.tenure - b.tenure || (a.seed < b.seed ? -1 : a.seed > b.seed ? 1 : 0);

/** A member's tree in the atlases: their level (1 to 13) and their stable variant of three. */
export const treeKey = (m: Grower, levels = 13, variants = 3): string =>
  `L${String(Math.max(1, Math.min(levels, Math.round(m.level)))).padStart(2, "0")}-v${variantOf(m.seed, variants)}`;

/**
 * Every member on a spot, the highest and oldest trees nearest the heart, as a real grove grows.
 * The same members always land on the same spots, whatever order they come in. Members past the
 * last spot have none yet (the bundle has as many spots as it has room for).
 */
export function plant<M extends Grower>(members: readonly M[], spots: readonly Spot[]): Planted<M>[] {
  return members
    .toSorted(byStanding)
    .slice(0, spots.length)
    .flatMap((member, i): Planted<M>[] => {
      const spot = spots[i];
      return spot ? [{ member, spot: i, row: spot.row, x: spot.x, key: treeKey(member) }] : [];
    });
}
