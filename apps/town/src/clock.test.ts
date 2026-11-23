import { describe, expect, test } from "bun:test";

import { DAY_MS } from "@sequoia-leaf/core";
import { EVERY } from "@sequoia-leaf/kit/presence.ts";
import { dist } from "@sequoia-leaf/kit/util.ts";
import {
  BY_TREE,
  folkAt,
  GATE,
  GOES_FOR,
  HOME,
  homecoming,
  MUSTER,
  SITS_AFTER,
  STANDS,
  type Walk,
} from "@sequoia-leaf/town/clock.ts";
import { folk } from "@sequoia-leaf/town/folk.ts";

import { walkAt } from "./actors.ts";
import { SEED } from "./game.ts";
import { SEATS, TOWN } from "./world.ts";

/** Noon to noon, so that the UTC day turns in the middle. */
const T0 = Date.UTC(2026, 10, 25, 12);

describe("the town's own on the town's ground, by Leaf's clock", () => {
  test("over a whole day nobody is asked to go faster than its pace, to be in two places, or to speak on the way", () => {
    // A gnome goes 22 pixels a second and a cat 26 (`makeFolk`).
    for (const [id, pace] of [
      ["pipwick", 22],
      ["embertoe", 26],
    ] as const) {
      const at = (now: number) => {
        const f = folkAt(SEED, folk(id), now);
        if (!f.from || !f.to) throw new Error(`${id} does not get about`);
        return { ...walkAt({ from: f.from, to: f.to, at: f.at }, pace, now), f };
      };
      let was = at(T0);
      let walked = 0;
      for (let now = T0 + 500; now <= T0 + DAY_MS; now += 500) {
        const p = at(now);
        const went = dist(was.x, was.y, p.x, p.y);
        if (went > pace / 2 + 1e-6) throw new Error(`${id} went ${went} pixels in half a second, at ${now}`);
        if (TOWN.footBlocked(p.x, p.y)) throw new Error(`${id} is in something at ${p.x}, ${p.y}`);
        // A line finds it standing at its spot as it begins.
        if (p.f.say) expect(at(p.f.say.until - 2800).next).toBeNull();
        // Once there it stays there until it sets out again.
        if (!p.next) expect([p.x, p.y]).toEqual([p.f.to?.x ?? 0, p.f.to?.y ?? 0]);
        walked += went;
        was = p;
      }
      // It gets about: some miles of the town's paths in a day.
      expect(walked).toBeGreaterThan(100_000);
    }
  });
});

describe("members on the town's ground, by Leaf's clock", () => {
  /** A member's pace, in pixels a second. */
  const PACE = 32;
  /** How long a walk takes at a member's pace, in milliseconds. */
  const takes = (from: Walk["from"], to: Walk["to"]): number => {
    let ms = 0;
    while (walkAt({ from, to, at: 0 }, PACE, ms).next) ms += 50;
    return ms;
  };

  test("every page has asked who is about between Leaf listing somebody as gone, at 90 seconds, and their sitting down or going", () => {
    expect(SITS_AFTER - EVERY).toBe(90_000);
  });

  test("every spot a visitor stands at is open ground, and from each the way to any seat's step and out through the gate is clear", () => {
    for (const stand of [...STANDS.works, ...STANDS.table]) {
      expect(TOWN.footBlocked(stand.x, stand.y)).toBe(false);
      for (const s of SEATS) {
        const end = walkAt({ from: stand, to: { ...s.from, dir: s.dir }, at: 0 }, PACE, 60_000);
        expect([end.x, end.y, end.next]).toEqual([s.from.x, s.from.y, null]);
      }
      // Whoever goes is out through the gate before they are taken away.
      expect(takes(stand, GATE)).toBeLessThan(GOES_FOR);
    }
  });

  test("a raid party's walks fit a member's pace: each is where the next walk sets out from in time, and never in anything", () => {
    for (let i = 0; i < MUSTER.length; i++) {
      let was: { x: number; y: number } | null = null;
      for (let now = T0; now < T0 + HOME.over; now += 100) {
        const w = homecoming(SEED, T0, i, now);
        if (!w) throw new Error("gone before it is over");
        const p = walkAt(w, PACE, now);
        if (TOWN.footBlocked(p.x, p.y)) throw new Error(`in something at ${p.x}, ${p.y}`);
        if (was && dist(was.x, was.y, p.x, p.y) > PACE / 10 + 1e-6)
          throw new Error(`${i} went ${dist(was.x, was.y, p.x, p.y)} pixels in a tenth of a second`);
        was = p;
      }
      // Out through the gate, in the dark, by the time it is over.
      expect([was?.x, was?.y]).toEqual([GATE.x, GATE.y]);
    }
    // The first is by the tree as the lantern goes up, and everybody before the gate as the town cheers.
    const first = homecoming(SEED, T0, 0, T0 + HOME.hang);
    expect(first && walkAt(first, PACE, T0 + HOME.hang)).toEqual({ x: BY_TREE.x, y: BY_TREE.y, next: null });
    const lead = homecoming(SEED, T0, 0, T0 + HOME.cheer);
    expect(lead && walkAt(lead, PACE, T0 + HOME.cheer).next).toBeNull();
  });
});
