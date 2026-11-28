/**
 * The piece whose card is pinned, marked on the yard: every tile it covers (both mouths of a tunnel)
 * in the pointer's gold brackets, held steady and edged in ink, so that it can be found in a crowded
 * yard. For a moment after the view is brought to it (a walk of the Trouble list, a tap on the map:
 * `S.brought`), the brackets close in on it from further out. On a phone, where a card would cover
 * the piece, the view is brought to it with no card, and it is marked all the same.
 */

import { FIXED, NONE, otherMouth, pieceOf, piecesTiles, type Yard } from "@sequoia-leaf/factory";
import { GOLD, INK } from "@sequoia-leaf/kit/palette.ts";
import type { Pen } from "@sequoia-leaf/kit/pix.ts";

import { TILE } from "./art/belts.ts";
import { type Box, pieceBox } from "./big.ts";
import { S } from "./state.ts";

/** The tile of the piece marked: the one whose card is pinned; else one the view was brought to with no card (a phone's). -1 for none. */
function markedTile(): number {
  const b = S.brought;
  if (S.picked >= 0 || b === null || b.card) return S.picked;
  return (S.world.kind[b.tile] ?? NONE) === NONE ? -1 : b.tile;
}

/** The tiles of the piece marked (`markedTile`): every tile it covers, and a tunnel's other mouth. */
export function markedTiles(): number[] {
  const i = markedTile();
  const far = i < 0 ? -1 : otherMouth(S.world, i);
  return i < 0 ? [] : far >= 0 ? [i, far] : piecesTiles(S.world, i);
}

/** Seconds each of the two times the brackets close in. */
const CLOSING = 0.45;
/**
 * How far out from its box the mark on the piece stands, in the yard's pixels:
 * after the view is brought to that piece, it closes in from 6 out, twice; else 0.
 */
export function pinPulse(): number {
  const b = S.brought;
  const n = b !== null && markedTiles().includes(b.tile) ? (S.t - b.at) / CLOSING : 2;
  return n >= 0 && n < 2 ? Math.round(6 * (1 - (n % 1)) ** 2) : 0;
}

/**
 * The brackets round a box in the picture (a tile, or the depot's): gold, edged in ink, `t` of the
 * yard's pixels thick, and `pinPulse` further out.
 */
function pinBox(g: Pen, x: number, y: number, w: number, h: number, t: number): void {
  const out = pinPulse() * t;
  const arm = 4 * t;
  const x0 = x - 1 - out;
  const y0 = y - 1 - out;
  const x1 = x + w + out;
  const y1 = y + h + out;
  for (const [col, e] of [
    [INK, 1],
    [GOLD[2], 0],
  ] as const)
    for (const [px, py, dx, dy] of [
      [x0, y0, 1, 1],
      [x1, y0, -1, 1],
      [x0, y1, 1, -1],
      [x1, y1, -1, -1],
    ] as const) {
      g.rect((dx > 0 ? px : px - arm + 1) - e, (dy > 0 ? py : py - t + 1) - e, arm + 2 * e, t + 2 * e, col);
      g.rect((dx > 0 ? px : px - t + 1) - e, (dy > 0 ? py : py - arm + 1) - e, t + 2 * e, arm + 2 * e, col);
    }
}

/**
 * The boxes the mark near goes round, in the picture: the box of the piece (every tile of one of more
 * than one, as one), each mouth of a tunnel, or the depot's box (its corner at `dx`, `dy`).
 */
export function pinBoxes(w: Yard, cx: number, cy: number, dx: number, dy: number): Box[] {
  const out: Box[] = [];
  const done = new Set<number>();
  for (const i of markedTiles()) {
    const own = pieceOf(w, i);
    if (done.has(own)) continue;
    done.add(own);
    if (FIXED[w.kind[own] ?? NONE] === 1) out.push({ x: dx, y: dy, w: 48, h: 48 });
    else {
      const b = pieceBox(w, own);
      out.push({ x: b.x * TILE - cx, y: b.y * TILE - cy, w: b.w * TILE, h: b.h * TILE });
    }
  }
  return out;
}

/** The mark near: brackets round each of its boxes (`pinBoxes`), at least 3 of the screen's pixels thick at any zoom. */
export function pinMark(g: Pen, w: Yard, cx: number, cy: number, dx: number, dy: number): void {
  const t = Math.max(1, Math.ceil(3 / S.view.z));
  for (const b of pinBoxes(w, cx, cy, dx, dy)) pinBox(g, b.x, b.y, b.w, b.h, t);
}
