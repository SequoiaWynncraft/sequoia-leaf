/**
 * Pieces of more than one tile on the page (the rules' `sizes.ts`): the box of tiles one covers, where
 * it is drawn (once, from its own tile, over the box), where its ways out are, and the box its marks
 * go round. A piece of one tile is its tile, and nothing here changes how it is drawn.
 */
import {
  cornerOf,
  DX,
  DY,
  FACING,
  isItem,
  NONE,
  OWN,
  pieceOf,
  piecesTiles,
  sizeOf,
  tileAt,
  type Yard,
} from "@sequoia-leaf/factory";

import { TILE } from "./art/belts.ts";
import type { Art } from "./art/index.ts";
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

/** The box a tool's aim marks on (tx, ty), at any zoom: the spade, the whole piece there; a kind in hand facing `d`, every tile it would cover. */
export const aimBox = (y: Yard, tool: number | "remove", d: number, tx: number, ty: number): Box =>
  tool === "remove" ? pieceBox(y, ty * y.land.w + tx) : boxAt(tool, d, tx, ty);

/**
 * The piece standing on a tile, by its own tile, whichever of its tiles (tx, ty) names (a piece of more
 * than one tile keeps everything of it there): its tile (-1 off the map), its kind (`NONE` for none),
 * and where it is. Every tool that reads the piece under the pointer reads it through this.
 */
export function pieceOn(y: Yard, tx: number, ty: number): { i: number; k: number; x: number; y: number } {
  const W = y.land.w;
  const t = tileAt(y.land, tx, ty);
  const i = t < 0 ? t : pieceOf(y, t);
  const k = y.kind[i] ?? NONE;
  return i < 0 ? { i, k, x: tx, y: ty } : { i, k, x: i % W, y: Math.floor(i / W) };
}

interface Covers {
  readonly all: readonly number[];
  readonly on: Uint8Array;
  /** The yard and its `rev` it was worked out on. */
  readonly y: Yard;
  readonly rev: number;
}

/** What a mark covers, by its tiles, worked out again only when the yard changes (`markCovers`). */
const COVERS = new WeakMap<readonly number[], Covers>();

/**
 * Every tile the pieces marked on some tiles cover (a mark's, `Mark.tiles`), each once, a piece of
 * more than one by all its tiles, which a mark may name by any of them: the tiles, and a byte a tile,
 * 1 where one is. What every zoom lights for a mark, and dims for pieces moved. Kept for each mark
 * until the yard changes (`Yard.rev`), as a copy turned and set back over its own tiles changes it.
 */
export function markCovers(y: Yard, tiles: readonly number[]): Covers {
  const known = COVERS.get(tiles);
  if (known && known.y === y && known.rev === y.rev) return known;
  const on = new Uint8Array(y.kind.length);
  const all: number[] = [];
  for (const t of tiles)
    for (const i of piecesTiles(y, t))
      if (on[i] === 0) {
        on[i] = 1;
        all.push(i);
      }
  const covers = { all, on, y, rev: y.rev };
  COVERS.set(tiles, covers);
  return covers;
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

/**
 * The brass pointer on each way out of a piece drawn (`at`), lit while it is in hand or its card is
 * open; with `holding`, what waits there to leave (its finished thing, or at a by-product's way out
 * its by-product).
 */
export function pointersOn(art: Art, at: Drawn, k: number, holding: boolean, lit: boolean): void {
  for (const way of waysOutOf(at, k, at.d)) {
    const p = (lit ? art.m.pointerLit : art.m.pointer)[way.d];
    if (p) at.put(p, way.x - Math.floor(p.width / 2), way.y - Math.floor(p.height / 2), at.z + 0.4, at.a);
    const sends = way.also ? at.also : at.out;
    if (!at.real || !holding || !isItem(sends)) continue;
    const pic = art.item(sends);
    const [dx, dy] = [DX[way.d] ?? 0, DY[way.d] ?? 0];
    at.put(
      pic,
      way.x - dx * 4 - Math.floor(pic.width / 2),
      way.y - dy * 4 - Math.floor(pic.height / 2) - 2,
      at.z + 0.5,
    );
  }
}

/** Sets what a piece drawn holds and is doing, from its row in `holders` (`r`, -1 for one with none or not yet built). */
export function heldIn(at: Drawn, y: Yard, r: number): void {
  const h = y.holders;
  const has = r >= 0;
  at.r = r;
  at.out = has ? (h.out[r] ?? NONE) : NONE;
  at.also = has ? (h.also[r] ?? NONE) : NONE;
  at.making = has ? (h.making[r] ?? NONE) : NONE;
  at.work = has ? (h.work[r] ?? 0) : 0;
}
