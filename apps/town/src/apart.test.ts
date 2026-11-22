import { describe, expect, test } from "bun:test";

import type { Pt } from "@sequoia-leaf/kit/util.ts";

import {
  apart,
  BACK_WITHIN,
  beside,
  crowds,
  ease,
  MOST,
  PACE,
  type Placed,
  type Someone,
  stood,
  stoodAt,
} from "./apart.ts";

/** Somebody standing still, or (`seated`) sitting, 19 pixels tall as when seen from the front. */
const still = (id: string, x: number, y: number, seated = false): Someone => ({
  id,
  x,
  y,
  tall: seated ? 19 : 21,
  seated,
  vx: 0,
  vy: 0,
});

/** Somebody walking, at so many pixels a second each way. */
const walking = (id: string, x: number, y: number, vx: number, vy: number): Someone => ({
  ...still(id, x, y),
  vx,
  vy,
});

/** `n` members on one spot, give or take a pixel, their accounts in an order of their own. */
const onOneSpot = (n: number): Someone[] =>
  Array.from({ length: n }, (_, i) => still(`m${String((i * 11) % n).padStart(2, "0")}`, 256 + (i % 2), 152));

/** Where each is drawn, by account. */
function drawn(everybody: readonly Someone[]): Map<string, Pt> {
  const aside = apart(everybody);
  return new Map(
    everybody.map((s) => [s.id, { x: s.x + (aside.get(s.id)?.x ?? 0), y: s.y + (aside.get(s.id)?.y ?? 0) }]),
  );
}

/** Whether no two of them are drawn on top of one another. */
function clear(everybody: readonly Someone[]): boolean {
  const at = drawn(everybody);
  const placed = everybody.map((s) => ({ ...s, ...at.get(s.id) }));
  return placed.every((a, i) => placed.slice(i + 1).every((b) => !crowds(a, b)));
}

/** The furthest any of them is drawn from where they are. */
const furthest = (everybody: readonly Someone[]): number =>
  Math.max(0, ...[...apart(everybody).values()].map((d) => Math.hypot(d.x, d.y)));

/** A figure with its feet at a point, so tall. */
const fig = (x: number, y: number, tall = 21): Placed => ({ x, y, tall });

describe("crowds", () => {
  test("two figures overlapping by over a third of the smaller are on top of one another", () => {
    expect(crowds(fig(100, 100), fig(106, 100))).toBe(true);
    expect(crowds(fig(100, 100), fig(107, 100))).toBe(false);
    expect(crowds(fig(100, 100), fig(100, 113))).toBe(true);
    expect(crowds(fig(100, 100), fig(100, 114))).toBe(false);
  });

  test("by how tall each is drawn: standing 12 pixels behind somebody sitting is on their head", () => {
    expect(crowds(fig(100, 100, 19), fig(100, 88))).toBe(true);
    expect(crowds(fig(100, 100, 17), fig(100, 88))).toBe(false);
  });
});

describe("beside", () => {
  test("a place nobody is on is kept; on somebody, the nearest place that is clear and fits", () => {
    const who = fig(100, 100);
    expect(beside(who, [fig(140, 100)], () => true)).toEqual(who);
    expect(beside(who, [fig(100, 100)], () => true)).toEqual(fig(93, 100));
    expect(beside(who, [fig(100, 100)], (p) => p.x >= 100)).toEqual(fig(107, 100));
  });

  test("nothing clear within MOST: where they are", () => {
    expect(beside(fig(100, 100), [fig(100, 100)], (p) => p.y > 100 + MOST)).toEqual(fig(100, 100));
  });
});

describe("apart", () => {
  test("several on one spot come apart, and none is drawn on top of another", () => {
    expect(clear(onOneSpot(5))).toBe(true);
    expect(clear(onOneSpot(14))).toBe(true);
  });

  test("the first by account keeps the spot; the rest take the nearest places round it", () => {
    const at = drawn([still("c", 100, 100), still("a", 100, 100), still("b", 100, 100)]);
    expect(at.get("a")).toEqual({ x: 100, y: 100 });
    expect(at.get("b")).toEqual({ x: 93, y: 100 });
    expect(at.get("c")).toEqual({ x: 107, y: 100 });
  });

  test("the answer is the same however they are listed", () => {
    const some = onOneSpot(7);
    const answer = Object.fromEntries(apart(some));
    for (const order of [some.toReversed(), [...some.slice(3), ...some.slice(0, 3)]])
      expect(Object.fromEntries(apart(order))).toEqual(answer);
  });

  test("figures side by side, or one in front of another, are not moved", () => {
    expect(apart([still("a", 100, 100), still("b", 107, 100), still("c", 100, 114)]).size).toBe(0);
  });

  test("two walking along together are drawn apart, and whoever walks goes round whoever has stopped", () => {
    // In line up the path, 4 pixels apart, at the same pace: the later by account steps aside.
    const line = [walking("a", 256, 150, 0, -40), walking("b", 256, 154, 0, -40)];
    expect([...apart(line).keys()]).toEqual(["b"]);
    expect(clear(line)).toBe(true);
    // Whoever walks goes round whoever has stopped, whatever their accounts: nobody standing steps out of the way.
    const round = [walking("a", 256, 154, 0, -40), still("b", 256, 150)];
    expect([...apart(round).keys()]).toEqual(["a"]);
    expect(clear(round)).toBe(true);
    // Two walking head on past each other are through in a moment: neither steps.
    expect(apart([walking("a", 256, 150, 0, 40), walking("b", 256, 154, 0, -40)]).size).toBe(0);
    // Overtaking is not passing: at twice the pace, the same way, they are still kept apart.
    expect(clear([walking("a", 256, 150, 0, -32), walking("b", 256, 154, 0, -64)])).toBe(true);
    // Somebody walking by never moves anybody who has stopped: the one aside stays on their side.
    const two = [still("a", 100, 100), still("b", 100, 100)];
    const side = apart(two).get("b");
    expect(apart([...two, walking("c", 100 + (side?.x ?? 0), 100, 0, -40)]).get("b")).toEqual(side);
    // And a passer-by moves nobody who has stopped: two standing on one spot step apart as if alone.
    const passed = [still("a", 256, 150), still("b", 256, 151), walking("c", 263, 150, -40, 0)];
    expect(apart(passed).get("b")).toEqual(apart(passed.slice(0, 2)).get("b"));
  });

  test("somebody sitting keeps their seat; whoever stands on them steps aside", () => {
    const on = [still("a", 100, 88), still("z", 100, 100, true)];
    expect(drawn(on).get("z")).toEqual({ x: 100, y: 100 });
    expect(drawn(on).get("a")).not.toEqual({ x: 100, y: 88 });
    expect(clear(on)).toBe(true);
  });

  test("six in a row, 13 apart, each step aside from where they stand, 3 pixels at most", () => {
    const row = Array.from({ length: 6 }, (_, i) => still(`r${i}`, 100, 100 + 13 * i));
    expect(clear(row)).toBe(true);
    expect(furthest(row)).toBeLessThanOrEqual(3);
  });

  test("nobody steps aside onto somebody standing just beside the spot", () => {
    // `c` stands just left of where `a` and `b` are: `b` takes the place on the other side.
    const at = drawn([still("a", 100, 100), still("b", 100, 100), still("c", 93, 100)]);
    expect(at.get("c")).toEqual({ x: 93, y: 100 });
    expect(at.get("b")).toEqual({ x: 107, y: 100 });
  });

  test("however many are on one spot, nobody is drawn further than MOST from it", () => {
    expect(furthest(onOneSpot(20))).toBeLessThanOrEqual(MOST);
    expect(clear(onOneSpot(16))).toBe(true);
  });
});

describe("ease", () => {
  test("a figure steps aside at PACE, and back again as fast", () => {
    const at = { x: 0, y: 0 };
    ease(at, { x: 10, y: 0 }, 0.1);
    expect(at.x).toBeCloseTo(PACE / 10);
    ease(at, { x: 10, y: 0 }, 1);
    expect(at).toEqual({ x: 10, y: 0 });
    ease(at, { x: 0, y: 0 }, 10 / PACE);
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
