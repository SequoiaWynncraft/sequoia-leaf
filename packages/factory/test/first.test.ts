/**
 * A yard kept by the Works' first design reads back as a new yard at the tier its story had
 * reached, no further than tier 2, with the plots it owned that the tier sells, and its totals (and
 * so its place on the board); its pieces, orders and blueprints are let go.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";

const ALL_PLOTS = ["yard", "meadow", "bank", "stream", "grove", "hollow", "seam", "quarry", "pond"];

/** A yard as the first design kept it: the fields it wrote, with a few pieces, filled to `story` of its twenty story orders. */
function first(story: number, plots: readonly string[] = ["yard"]): string {
  return JSON.stringify({
    v: 3,
    seed: 77,
    tick: 5000,
    at: 1_763_900_000_000,
    till: 40,
    bank: 12,
    told: story,
    seen: { tick: 4000, till: 0, depot: { plank: 30 } },
    plots,
    plans: ["boiler"],
    story,
    filled: { plank: 3 },
    board: [{ id: 4, want: { plank: 10 }, filled: { plank: 2 }, pay: 60 }],
    serial: 5,
    done: 3,
    swapAt: 0,
    depot: { plank: 300, ingot: 120 },
    given: {},
    sold: 16_567.419,
    paid: 40_230,
    pace: { ticks: 0, warm: 0, made: {} },
    cells: [
      { i: 2000, k: "gatherer", d: 0 },
      { i: 2001, k: "belt", d: 0, it: "log", p: 3, v: 2 },
      { i: 2002, k: "mill", d: 0, r: "plank" },
    ],
  });
}

const read = (text: string): F.Yard => {
  const y = F.decode(text);
  if (!y) throw new Error("the first design's yard does not read");
  return y;
};

describe("a yard kept by the first design", () => {
  test("begins the tier its story had reached: tier 0 before the fourth order, 1 from it, 2 from the tenth and to the end", () => {
    const tiers = [0, 3, 4, 9, 10, 14, 20].map((story) => read(first(story)).open.tier);
    expect(tiers).toEqual([0, 0, 1, 1, 2, 2, 2]);
  });

  test("has every goal below its tier done, as a new yard of that tier has, and nothing else of the first design", () => {
    const y = read(first(20));
    const fresh = F.create({ seed: 77, tier: 2 });
    expect([y.done, y.hand]).toEqual([fresh.done, fresh.hand]);
    // No piece stands but the depot; the depot's books and the till begin again.
    expect(y.kind.filter((k) => k !== F.NONE && k !== F.DEPOT).length).toBe(0);
    expect([y.till, F.ALL_ITEMS.every((n) => (y.depot[n] ?? 0) === 0)]).toEqual([0, true]);
  });

  test("owns again each plot it owned that its tier sells, and only those", () => {
    const y = read(first(20, ALL_PLOTS));
    const owned = y.plots.map(F.plotName);
    expect(owned.length).toBeGreaterThan(1);
    expect(owned.every((name) => ALL_PLOTS.includes(name))).toBe(true);
    // Nothing it owned is still for sale: every plot it could take, it took.
    for (const plot of F.LAND.plots) {
      const name = F.plotName(plot.plot);
      if (!owned.includes(name)) expect([name, F.plotState(y, plot.plot).state === "for sale"]).toEqual([name, false]);
    }
    // A yard at the fourth order owns what tier 1 sells of them, which is less.
    expect(read(first(4, ALL_PLOTS)).plots.length).toBeLessThan(owned.length);
  });

  test("is paid back, into its till, what the plots its tier does not sell yet would cost again, and is not told it earned it", () => {
    const y = read(first(20, ALL_PLOTS));
    const unsold = F.LAND.plots.filter((p) => !y.plots.includes(p.plot));
    expect(unsold.length).toBeGreaterThan(0);
    expect(y.till).toBe(unsold.reduce((sum, p) => sum + p.price, 0) * F.MILLI);
    expect(F.postcard(y).till).toBe(y.till / F.MILLI);
    // The letter for time away counts only what the till gains from here.
    expect(y.seen.till).toBe(y.till);
    expect(read(first(20, ["yard"])).till).toBe(0);
  });

  test("keeps what it was paid, what it sold and the side orders it handed over, and so its score on the board", () => {
    const y = read(first(20));
    expect(F.FACTORY.standing?.(y)).toEqual({ score: 56_797, also: { tier: 2 } });
    expect(y.handed).toBe(3);
  });

  test("is kept and read back as a yard of this design, the same", () => {
    const y = read(first(14, ALL_PLOTS));
    const text = F.encode(y);
    expect(F.encode(read(text))).toBe(text);
    expect(F.check(read(text))).toBe(F.check(y));
  });

  test("with its story or its totals missing, is not a yard", () => {
    const raw: Record<string, unknown> = JSON.parse(first(20));
    for (const field of ["story", "paid", "sold", "plots"]) {
      expect(F.decode(JSON.stringify({ ...raw, [field]: undefined }))).toBeNull();
    }
    expect(F.decode(JSON.stringify({ ...raw, story: -1 }))).toBeNull();
  });
});
