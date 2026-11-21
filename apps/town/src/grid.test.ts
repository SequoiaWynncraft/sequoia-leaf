import { describe, expect, test } from "bun:test";

import { CELL, makeGround } from "./grid.ts";

const open = (): number => 9;

describe("ground to walk on", () => {
  test("a clear field is crossed in one stride", () => {
    const g = makeGround(20, 12, open);
    expect(g.findPath({ x: 12, y: 12 }, { x: 140, y: 80 }, true)).toEqual([{ x: 140, y: 80 }]);
  });

  test("a wall is walked round, never through", () => {
    const g = makeGround(20, 12, open);
    g.fill(10, 0, 10, 8, 1);
    const way = g.findPath({ x: 20, y: 20 }, { x: 140, y: 20 }, true);
    expect(way.length).toBeGreaterThan(1);
    expect(way.at(-1)).toEqual({ x: 140, y: 20 });
    for (const p of way) expect(g.footBlocked(p.x, p.y)).toBe(false);
    // It has to go below the wall's foot.
    expect(Math.max(...way.map((p) => p.y))).toBeGreaterThan(9 * CELL);
  });

  test("somewhere shut in cannot be reached", () => {
    const g = makeGround(20, 12, open);
    g.fill(10, 0, 10, 11, 1);
    expect(g.findPath({ x: 20, y: 20 }, { x: 140, y: 20 }, true)).toEqual([]);
  });

  test("a blocked spot gives the clear one beside it", () => {
    const g = makeGround(20, 12, open);
    g.fill(4, 4, 6, 6, 1);
    const p = g.nearestFree(5 * CELL + 4, 5 * CELL + 4);
    expect(g.footBlocked(p.x, p.y)).toBe(false);
    expect(Math.hypot(p.x - 44, p.y - 44)).toBeLessThan(3 * CELL);
  });

  test("off the sheet counts as blocked", () => {
    const g = makeGround(4, 4, open);
    expect(g.cellBlocked(-1, 0)).toBe(true);
    expect(g.cellBlocked(0, 4)).toBe(true);
    expect(g.cellBlocked(3, 3)).toBe(false);
  });

  test("ambling keeps to the squares", () => {
    const g = makeGround(20, 12, open);
    const way = g.findPath({ x: 12, y: 12 }, { x: 100, y: 12 }, false);
    expect(way.length).toBeGreaterThan(5);
  });
});
