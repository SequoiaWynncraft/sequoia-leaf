import { describe, expect, test } from "bun:test";

import { CELLS, centre, SEATS } from "../game/hex.ts";
import {
  BENCH_SLOTS,
  BOARD_H,
  BOARD_W,
  cellAtPoint,
  cellXY,
  GAP,
  HEX_H,
  HEX_W,
  ROW,
  seatAtPoint,
  seatXY,
  slotAtPoint,
  slotXY,
} from "./geometry.ts";

describe("the board on the table", () => {
  test("every hex lies inside the board", () => {
    for (let cell = 0; cell < CELLS; cell++) {
      const { x, y } = cellXY(cell);
      expect(x - HEX_W / 2).toBeGreaterThanOrEqual(0);
      expect(x + HEX_W / 2).toBeLessThanOrEqual(BOARD_W);
      expect(y - HEX_H / 2).toBeGreaterThanOrEqual(0);
      expect(y + HEX_H / 2).toBeLessThanOrEqual(BOARD_H);
    }
  });

  test("hexes are laid out as the rules lay them out", () => {
    for (let cell = 0; cell < CELLS; cell++) {
      const drawn = cellXY(cell);
      const ruled = centre(cell);
      expect(drawn.x).toBe(ruled.x * HEX_W + HEX_W / 2);
      expect(drawn.y).toBe(Math.round(ruled.y / 0.8660254037844386) * ROW + HEX_H / 2);
    }
  });

  test("the middle of every hex is that hex, and only that hex", () => {
    for (let cell = 0; cell < CELLS; cell++) {
      const { x, y } = cellXY(cell);
      expect(cellAtPoint(x, y)).toBe(cell);
      expect(cellAtPoint(x + 6, y + 3)).toBe(cell);
      expect(cellAtPoint(x - 6, y - 3)).toBe(cell);
    }
  });

  test("no point belongs to two hexes, and the board has no holes inside it", () => {
    for (let y = HEX_H; y < BOARD_H - HEX_H; y += 0.5) {
      for (let x = HEX_W; x < BOARD_W - HEX_W; x += 0.5) {
        const here = cellAtPoint(x + 0.01, y + 0.01);
        expect(here).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("only the far half moves when the halves part", () => {
    for (let cell = 0; cell < CELLS; cell++) {
      const together = cellXY(cell);
      const apart = cellXY(cell, GAP);
      expect(apart.x).toBe(together.x);
      expect(apart.y).toBe(cell < SEATS ? together.y - GAP : together.y);
    }
    const far = cellXY(3, GAP);
    expect(cellAtPoint(far.x, far.y, GAP)).toBe(3);
  });

  test("a seat is a hex on the near half", () => {
    for (let seat = 0; seat < SEATS; seat++) {
      const { x, y } = seatXY(seat);
      expect(seatAtPoint(x, y)).toBe(seat);
    }
    const far = cellXY(10);
    expect(seatAtPoint(far.x, far.y)).toBe(-1);
    expect(seatAtPoint(-5, -5)).toBe(-1);
  });

  test("a figure on the bench stands in its own hollow", () => {
    for (let slot = 0; slot < BENCH_SLOTS; slot++) {
      const { x, y } = slotXY(slot);
      expect(slotAtPoint(x, y)).toBe(slot);
      expect(slotAtPoint(x, y - 12)).toBe(slot);
    }
    expect(slotAtPoint(slotXY(0).x - 30, slotXY(0).y)).toBe(-1);
    expect(slotAtPoint(slotXY(8).x + 30, slotXY(8).y)).toBe(-1);
    expect(slotAtPoint(slotXY(4).x, slotXY(4).y - 40)).toBe(-1);
  });
});
