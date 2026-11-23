import { beforeEach, describe, expect, test } from "bun:test";

import { counts, create, item, step, type Yard } from "@sequoia-leaf/factory";
import { delivering } from "@sequoia-leaf/factory/test/yards.ts";

import { countedOver, forgetArrivals, noteArrivals, reached } from "./arrivals.ts";

const plank = item("plank");
const deadfall = item("deadfall");

/** Runs a yard on so many ticks, looking at its books after each, as a frame does. */
function watch(y: Yard, ticks: number): void {
  for (let k = 0; k < ticks; k++) {
    step(y);
    noteArrivals(y);
  }
}

/** A yard whose books are whatever a test writes in them: nothing stands in it. */
function books(tick: number, planks: number): Yard {
  const y = create({ seed: 1 });
  y.tick = tick;
  y.depot = counts();
  y.depot[plank] = planks;
  return y;
}

beforeEach(forgetArrivals);

describe("what reached the depot in the last minute", () => {
  test("is the depot's own count over the yard's last 600 ticks, for each thing", () => {
    const y = delivering();
    noteArrivals(y);
    // More than a minute, to a tick that begins a second: the newest row is taken there.
    watch(y, 900 - (y.tick % 10));
    const now = Array.from(y.depot);
    const then = delivering();
    while (then.tick < y.tick - 600) step(then);
    for (const k of [plank, deadfall, item("ore")]) {
      expect(reached(k)).toBe((now[k] ?? 0) - (then.depot[k] ?? 0));
      expect(reached(k)).toBeGreaterThan(0);
    }
    expect(countedOver()).toBe(60);
  });

  test("in the first minute, is what was seen so far as a minute's worth, and says over how many seconds", () => {
    const y = books(1000, 50);
    noteArrivals(y);
    expect([reached(plank), countedOver()]).toEqual([0, 0]);
    // Twenty seconds on, 7 more planks: 21 a minute.
    y.tick = 1200;
    y.depot[plank] = 57;
    noteArrivals(y);
    expect(reached(plank)).toBeCloseTo(21);
    expect(countedOver()).toBe(20);
  });

  test("does not begin again when the yard is changed, or when the copy becomes Leaf's yard at the same tick", () => {
    const y = books(1000, 0);
    for (let t = 0; t <= 600; t += 10) {
      y.tick = 1000 + t;
      y.depot[plank] = t / 10;
      noteArrivals(y);
    }
    expect([reached(plank), countedOver()]).toEqual([60, 60]);
    // Leaf's yard, read at the next second: another yard on the page, the same books a second on.
    const leafs = books(1610, 61);
    noteArrivals(leafs);
    expect([reached(plank), countedOver()]).toEqual([60, 60]);
  });

  test("a row a few ticks late, as a copy catching up takes it, still gives a minute's worth", () => {
    const y = books(1000, 0);
    noteArrivals(y);
    // One thing a second; the page looks only every 13 ticks.
    for (let t = 13; t <= 1300; t += 13) {
      y.tick = 1000 + t;
      y.depot[plank] = Math.floor(t / 10);
      noteArrivals(y);
    }
    expect(reached(plank)).toBeGreaterThan(58);
    expect(reached(plank)).toBeLessThan(62);
    expect(countedOver()).toBe(60);
  });

  test("another yard, or one that ran on more than a minute unseen, begins the count again", () => {
    const y = books(1000, 0);
    for (let t = 0; t <= 600; t += 10) {
      y.tick = 1000 + t;
      y.depot[plank] = t;
      noteArrivals(y);
    }
    expect(reached(plank)).toBe(600);
    // An hour away: Leaf ran the yard on meanwhile.
    noteArrivals(books(40_000, 5000));
    expect([reached(plank), countedOver()]).toEqual([0, 0]);
    // A yard staged in its place, its books holding less.
    noteArrivals(books(40_010, 3));
    expect([reached(plank), countedOver()]).toEqual([0, 0]);
    noteArrivals(books(40_020, 5));
    expect(reached(plank)).toBeCloseTo(120);
  });
});
