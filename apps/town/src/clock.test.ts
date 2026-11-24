import { describe, expect, test } from "bun:test";

import { DAY_MS } from "@sequoia-leaf/core";
import { EVERY } from "@sequoia-leaf/kit/presence.ts";
import { dist } from "@sequoia-leaf/kit/util.ts";
import { folkAt, SITS_AFTER } from "@sequoia-leaf/town/clock.ts";
import { folk } from "@sequoia-leaf/town/folk.ts";

import { walkAt } from "./actors.ts";
import { SEED } from "./game.ts";
import { LAID } from "./spots.ts";
import { TOWN } from "./world.ts";

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
  test("every page has asked who is about between Leaf listing somebody as gone, at 90 seconds, and their dozing or going", () => {
    expect(SITS_AFTER - EVERY).toBe(90_000);
  });

  test("every spot laid by hand at the games is open ground", () => {
    for (const stand of [...LAID.works, ...LAID.table, ...LAID.grove])
      expect(TOWN.footBlocked(stand.x, stand.y)).toBe(false);
  });
});
