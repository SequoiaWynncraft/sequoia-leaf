import { describe, expect, test } from "bun:test";

import { type Move, moveAt } from "./move.ts";

const hop: Move = { from: { x: 0, y: 10 }, to: { x: 20, y: 30 }, t0: 5, dur: 2, arc: 8, smooth: true };
const walk: Move = { ...hop, smooth: false };

describe("a figure's move", () => {
  test("starts where it set off, ends where it was going, and stays there", () => {
    expect(moveAt(hop, 4)).toEqual({ x: 0, y: 10, lift: 0, k: 0 });
    expect(moveAt(hop, 7)).toMatchObject({ x: 20, y: 30, k: 1 });
    expect(moveAt(hop, 99)).toMatchObject({ x: 20, y: 30, k: 1 });
    expect(moveAt(hop, 7).lift).toBeCloseTo(0, 9);
  });
  test("is highest at the middle of the way, an arc's height up", () => {
    expect(moveAt(hop, 6).lift).toBeCloseTo(8, 9);
    expect(moveAt(walk, 6)).toMatchObject({ x: 10, y: 20, k: 0.5 });
  });
  test("a hop eases in and out; a walk goes at an even pace", () => {
    expect(moveAt(hop, 5.5).x).toBeLessThan(moveAt(walk, 5.5).x);
    expect(moveAt(walk, 5.5).x).toBeCloseTo(5, 9);
  });
});
