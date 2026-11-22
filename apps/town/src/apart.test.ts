import { describe, expect, test } from "bun:test";

import type { Pt } from "@sequoia-leaf/kit/util.ts";

import { apart, BACK_WITHIN, EASE, ease, NEAR, STEP, type Still, stood, stoodAt } from "./apart.ts";

/** `n` members on one spot, give or take a pixel, their accounts in an order of their own. */
const onOneSpot = (n: number): Still[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${String((i * 11) % n).padStart(2, "0")}`, x: 256 + (i % 2), y: 152 }));

/** Where each is drawn, by account. */
function drawn(still: readonly Still[]): Map<string, Pt> {
  const aside = apart(still);
  return new Map(still.map((s) => [s.id, { x: s.x + (aside.get(s.id)?.x ?? 0), y: s.y + (aside.get(s.id)?.y ?? 0) }]));
}

const closest = (at: readonly Pt[]): number =>
  Math.min(...at.flatMap((a, i) => at.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));

describe("apart", () => {
  test("several on one spot come apart, and no two share a place", () => {
    const at = [...drawn(onOneSpot(5)).values()];
    expect(closest(at)).toBeGreaterThanOrEqual(STEP);
  });

  test("the first by account keeps the spot; the rest step right, left, down, up", () => {
    const at = drawn([
      { id: "c", x: 100, y: 100 },
      { id: "a", x: 101, y: 100 },
      { id: "e", x: 100, y: 101 },
      { id: "b", x: 100, y: 100 },
      { id: "d", x: 99, y: 100 },
    ]);
    expect(at.get("a")).toEqual({ x: 101, y: 100 });
    expect(at.get("b")).toEqual({ x: 108, y: 100 });
    expect(at.get("c")).toEqual({ x: 94, y: 100 });
    expect(at.get("d")).toEqual({ x: 101, y: 107 });
    expect(at.get("e")).toEqual({ x: 101, y: 93 });
  });

  test("the answer is the same however they are listed", () => {
    const still = onOneSpot(7);
    const answer = Object.fromEntries(apart(still));
    for (const order of [still.toReversed(), [...still.slice(3), ...still.slice(0, 3)]])
      expect(Object.fromEntries(apart(order))).toEqual(answer);
  });

  test("figures already apart are not moved", () => {
    const still = [
      { id: "a", x: 100, y: 100 },
      { id: "b", x: 100 + NEAR + 1, y: 100 },
      { id: "c", x: 100, y: 100 - NEAR - 1 },
    ];
    expect(apart(still).size).toBe(0);
  });

  test("one standing close to somebody on the spot is on it too", () => {
    const at = drawn([
      { id: "a", x: 100, y: 100 },
      { id: "b", x: 105, y: 100 },
      { id: "c", x: 110, y: 100 },
    ]);
    expect(closest([...at.values()])).toBeGreaterThanOrEqual(STEP);
  });

  test("nobody steps aside onto somebody standing just beside the spot", () => {
    // `c` stands a step to the right of where `a` and `b` are: `b` takes the next place round.
    const at = drawn([
      { id: "a", x: 100, y: 100 },
      { id: "b", x: 100, y: 100 },
      { id: "c", x: 100 + STEP, y: 100 },
    ]);
    expect(at.get("c")).toEqual({ x: 100 + STEP, y: 100 });
    expect(at.get("b")).toEqual({ x: 100 - STEP, y: 100 });
    expect(closest([...at.values()])).toBeGreaterThanOrEqual(STEP);
    // Two spots side by side do not step into each other either.
    const two = drawn(["a", "b", "c", "d"].map((id, n) => ({ id, x: n < 2 ? 100 : 100 + 2 * STEP, y: 100 })));
    expect(closest([...two.values()])).toBeGreaterThanOrEqual(STEP);
  });

  test("nine on one spot fill the eight places round it; the tenth steps twice as far", () => {
    const nine = [...drawn(onOneSpot(9)).values()];
    expect(closest(nine)).toBeGreaterThanOrEqual(STEP);
    expect(Math.max(...nine.map((p) => Math.max(Math.abs(p.x - 256), Math.abs(p.y - 152))))).toBe(STEP);
    const ten = drawn(onOneSpot(10));
    expect(closest([...ten.values()])).toBeGreaterThanOrEqual(STEP);
    expect(ten.get("m09")).toEqual({ x: 256 + 2 * STEP, y: 152 });
  });
});

describe("ease", () => {
  test("a whole step aside takes a fifth of a second, and back again as long", () => {
    const at = { x: 0, y: 0 };
    ease(at, { x: STEP, y: 0 }, EASE / 2);
    expect(at.x).toBeCloseTo(STEP / 2);
    ease(at, { x: STEP, y: 0 }, EASE / 2);
    expect(at).toEqual({ x: STEP, y: 0 });
    ease(at, { x: 0, y: 0 }, EASE);
    expect(at).toEqual({ x: 0, y: 0 });
  });
});

describe("stoodAt", () => {
  const at = { x: 300, y: 210, dir: 2 } as const;

  test("a page loaded again soon after is back where the last one stood, facing as it was", () => {
    expect(stoodAt(stood(at, 1000), 1000 + BACK_WITHIN)).toEqual(at);
  });

  test("after ten minutes, or with nothing kept, or nonsense, nowhere", () => {
    expect(stoodAt(stood(at, 1000), 1001 + BACK_WITHIN)).toBeNull();
    expect(stoodAt(stood(at, 1000), 999)).toBeNull();
    expect(stoodAt(null, 1000)).toBeNull();
    expect(stoodAt("{", 1000)).toBeNull();
    expect(stoodAt('{"x":1,"y":"2","dir":0,"at":1000}', 1000)).toBeNull();
  });
});
