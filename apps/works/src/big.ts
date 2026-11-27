/**
 * Pieces of more than one tile on the page (the rules' `sizes.ts`): the box of tiles one covers, where
 * it is drawn (once, from its own tile, over the box), where its ways out are, and the box its marks
 * go round. A piece of one tile is its tile, and nothing here changes how it is drawn.
 */
import { cornerOf, DX, DY, FACING, OWN, pieceOf, sizeOf, type Yard } from "@sequoia-leaf/factory";

import { TILE } from "./art/belts.ts";
import type { Drawn } from "./kinds/kind.ts";

/** A box of tiles: its top-left corner and its size, in tiles. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The box of tiles a kind facing `d` covers standing on (tx, ty). */
export function boxAt(k: number, d: number, tx: number, ty: number): Box {
  const [w, h] = sizeOf(k, d & 3);
  const [cx, cy] = cornerOf(k, d & 3);
  return { x: tx + cx, y: ty + cy, w, h };
}

/** The box of the piece standing on a tile: its own, whichever of its tiles is named; the tile alone where nothing stands. */
export function pieceBox(y: Yard, i: number): Box {
  const own = pieceOf(y, i);
  const W = y.land.w;
  return boxAt(y.kind[own] ?? 0, y.dir[own] ?? 0, own % W, Math.floor(own / W));
}

/** Whether a piece is drawn from a tile: its own tile, for one of more than one; every tile of one of one. */
export const drawnFrom = (y: Yard, i: number): boolean => y.part[i] === 0 || y.part[i] === OWN;

/** Sets where a piece is drawn, from its own tile's top-left corner in the picture (`x`, `top`): over its box, its foot the box's foot. */
export function boxIn(at: Drawn, k: number, d: number, x: number, top: number): void {
  const b = boxAt(k, d, 0, 0);
  at.x = x + b.x * TILE;
  at.top = top + b.y * TILE;
  at.w = b.w * TILE;
  at.h = b.h * TILE;
  at.foot = at.top + at.h;
  at.cx = at.x + (at.w >> 1);
}

/** A way out in the picture: the middle of the edge of the tile it leaves by, the way it leaves, and whether it sends a by-product. */
export interface WayOut {
  readonly x: number;
  readonly y: number;
  readonly d: number;
  readonly also: boolean;
}

/**
 * The ways out of a piece drawn over its box (`boxIn`): for one of one tile, ahead; for one of more,
 * each of its kind's (`KindDef.ports`).
 */
export function waysOutOf(at: Drawn, k: number, d: number): WayOut[] {
  const outs = FACING[k]?.[d & 3]?.outs ?? [];
  const [cx, cy] = cornerOf(k, d & 3);
  // Its own tile, from the box's corner.
  const ox = at.x - cx * TILE;
  const oy = at.top - cy * TILE;
  if (outs.length === 0) return [{ x: ox + 8 + (DX[d] ?? 0) * 8, y: oy + 8 + (DY[d] ?? 0) * 8, d, also: false }];
  return outs.map((o) => ({
    x: ox + o.dx * TILE + 8 + (DX[o.way] ?? 0) * 8,
    y: oy + o.dy * TILE + 8 + (DY[o.way] ?? 0) * 8,
    d: o.way,
    also: o.also,
  }));
}
