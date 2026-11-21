/**
 * Where things are on the table, in art pixels. The board is the rules' own board (seven hexes
 * across, eight rows, odd rows half a hex to the right) drawn with squat pointy-topped hexes, so it
 * reads as a table seen from a little above. Everything here is measured from the board's top-left
 * corner as it lies in a fight, with the two halves pushed together.
 *
 * While planning, the far half (rows 0 to 3) sits `gap` pixels further away; the near half, the
 * member's own, never moves. The bench is a plank of nine hollows under the near half.
 */
import { COLS, HOME_ROWS, ROWS, SEATS } from "../game/hex.ts";

/** A hex is this wide and this tall, point to point; its slanted edges rise `SLOPE` pixels. */
export const HEX_W = 20;
export const HEX_H = 20;
export const SLOPE = 5;
/** Rows are this far apart. */
export const ROW = HEX_H - SLOPE;
export const BOARD_W = COLS * HEX_W + HEX_W / 2;
export const BOARD_H = (ROWS - 1) * ROW + HEX_H;
/** How far apart the two halves sit while planning. */
export const GAP = 10;

export const BENCH_SLOTS = 9;
export const SLOT_W = 20;
export const BENCH_W = BENCH_SLOTS * SLOT_W;
export const BENCH_H = 22;
/** The bench's top-left corner, from the board's. */
export const BENCH_X = Math.round((BOARD_W - BENCH_W) / 2);
export const BENCH_Y = BOARD_H + 9;

export interface Pt {
  x: number;
  y: number;
}

/** The middle of a fight cell, with the far half `gap` pixels further away. */
export function cellXY(cell: number, gap = 0): Pt {
  const row = Math.floor(cell / COLS);
  const col = cell % COLS;
  return {
    x: col * HEX_W + (row % 2 === 1 ? HEX_W / 2 : 0) + HEX_W / 2,
    y: row * ROW + HEX_H / 2 - (row < HOME_ROWS ? gap : 0),
  };
}
/** The middle of one of the member's own seats (row 0 is their front line). */
export const seatXY = (seat: number): Pt => cellXY(seat + SEATS);
/** Where a figure on the bench stands: the middle of its hollow, at foot height. */
export const slotXY = (slot: number): Pt => ({
  x: BENCH_X + slot * SLOT_W + SLOT_W / 2,
  y: BENCH_Y + BENCH_H - 8,
});

/** Whether a point is inside the hex whose middle is at `c`. */
export function inHex(c: Pt, x: number, y: number): boolean {
  const dx = Math.abs(x - c.x);
  const dy = Math.abs(y - c.y);
  return dx <= HEX_W / 2 && dy <= HEX_H / 2 - (dx * SLOPE) / (HEX_W / 2);
}

/** The fight cell under a point, or -1. `gap` is how far away the far half sits. */
export function cellAtPoint(x: number, y: number, gap = 0): number {
  for (let cell = 0; cell < COLS * ROWS; cell++) {
    if (inHex(cellXY(cell, gap), x, y)) return cell;
  }
  return -1;
}
/** The member's seat under a point, or -1. */
export function seatAtPoint(x: number, y: number): number {
  const cell = cellAtPoint(x, y);
  return cell >= SEATS ? cell - SEATS : -1;
}
/** The bench hollow under a point, or -1. A little generous above, where the figures' heads are. */
export function slotAtPoint(x: number, y: number): number {
  if (y < BENCH_Y - 6 || y >= BENCH_Y + BENCH_H + 2) return -1;
  const slot = Math.floor((x - BENCH_X) / SLOT_W);
  return slot >= 0 && slot < BENCH_SLOTS ? slot : -1;
}

/** The corners of a hex round the origin, clockwise from the top point. */
export const HEX_CORNERS: readonly (readonly [number, number])[] = [
  [0, -HEX_H / 2],
  [HEX_W / 2, -HEX_H / 2 + SLOPE],
  [HEX_W / 2, HEX_H / 2 - SLOPE],
  [0, HEX_H / 2],
  [-HEX_W / 2, HEX_H / 2 - SLOPE],
  [-HEX_W / 2, -HEX_H / 2 + SLOPE],
];
