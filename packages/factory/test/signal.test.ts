/**
 * Tier 7's commission made by the real rules (`signal.ts`): a staged yard of ten growers III, each in
 * a loop of its own with the way back put first and seeded from the star crystal in the ground,
 * grows 22,000 star crystals and finishes "A dish for the ridge"; with plain splitters sending half
 * back, its growers run down to what the ground gives, and it makes under a third of it.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { signalYard } from "./signal.ts";

const SIGNAL = F.goal("signal");
/** What the commission has been given of each thing it wants. */
const given = (y: F.Yard): number[] =>
  (["dish", "lattice", "star"] as const).map((n) => y.got[SIGNAL]?.[F.item(n)] ?? 0);

describe("the commission of tier 7, by the real rules", () => {
  test("a staged yard of growers in loops of their own makes 1,500 dishes, 6,000 lattices and 2,000 Star folios", () => {
    const y = signalYard();
    expect(F.GOALS[y.hand]?.id).toBe("signal");
    const growers = y.kind.reduce((n, k, i) => n + (k === F.kind("grower") && y.part[i] === F.OWN ? 1 : 0), 0);
    // Once the boilers have their first deadfall, the yard has the power it draws.
    for (let k = 0; k < 600; k++) F.step(y);
    expect([growers, F.power(y).speed, F.power(y).demand]).toEqual([10, 100, 1766]);
    let ticks = 600;
    while (!y.done.includes(SIGNAL) && ticks < 400_000) {
      F.step(y);
      ticks++;
    }
    expect(y.done.includes(SIGNAL)).toBe(true);
    // About four hours of the yard's clock.
    expect(ticks).toBeLessThan(160_000);
    expect(y.news.some((n) => n.kind === "done" && n.goal === "signal")).toBe(true);
  }, 120_000);

  test("the same yard with plain splitters, half back, runs down to the star crystal in the ground, and makes under a third of it in the same time", () => {
    const y = signalYard(false);
    for (let k = 0; k < 160_000; k++) F.step(y);
    const [dishes = 0, lattices = 0, stars = 0] = given(y);
    // Each grower nets 3 for every 1 its gatherer gives (2.4 a minute), not 10: about 24 star crystals a
    // minute where the loops with the way back first make 108.
    const made = dishes * 2 + lattices + stars;
    expect([y.done.includes(SIGNAL), made > 2500 && made < 11_000 / 3]).toEqual([false, true]);
  }, 120_000);
});
