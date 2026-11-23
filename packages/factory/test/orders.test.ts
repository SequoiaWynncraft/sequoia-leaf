/**
 * Standing orders: sized by the tier reached; counting only from 50 ticks after they are hung, until
 * when the depot gives them nothing and the check leaves them out; a fresh one hung at the end of the
 * board; and what the answer to a batch carries.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { give, must } from "./yards.ts";

/** The work in an order: every tick a gatherer and machine at grade 1 spends on what it wants. */
const work = (o: F.Standing): number => F.ALL_ITEMS.reduce((sum, n) => sum + (o.want[n] ?? 0) * F.workOf(n), 0);

describe("the size of a standing order", () => {
  test("is 6,000 ticks of work and 3,000 more for each tier open beyond the first, shared out as today", () => {
    for (const tier of [1, 2, 3, 4]) {
      const y = F.create({ seed: 7, tier });
      const budget = 6000 + 3000 * y.open.tier;
      // Orders for one thing machines make: within a fifth of the budget, and rounding.
      const single = Array.from({ length: 60 }, () => F.fresh(y, 7)).filter((o) => {
        const asked = F.ALL_ITEMS.filter((n) => (o.want[n] ?? 0) > 0);
        const step = F.ITEM_INFO[asked[0] ?? 0]?.step ?? 0;
        return asked.length === 1 && step > 0 && step < 4;
      });
      expect(single.length).toBeGreaterThan(10);
      for (const o of single) {
        expect(work(o)).toBeGreaterThan(budget * 0.75);
        expect(work(o)).toBeLessThan(budget * 1.25);
      }
    }
  });
});

describe("an order hung", () => {
  test("goes at the end of the board, and counts only from 50 ticks after: until then the depot gives it nothing and the check leaves it out", () => {
    const y = F.create({ seed: 3, tier: 4 });
    for (let k = 0; k < 60; k++) F.step(y);
    const first = y.board[0];
    if (!first) throw new Error("no board");
    must(y, { do: "swap", order: first.id });
    const hung = y.board.at(-1);
    if (!hung) throw new Error("nothing hung");
    expect([y.board.length, hung.starts]).toEqual([3, y.tick + F.ORDER_WAITS]);
    expect(y.board.some((o) => o.id === first.id)).toBe(false);
    // Left out of the check: the same as the yard without it, and as the page's copy, which has no seed.
    const without = F.decode(F.encode(y), y.land);
    if (!without) throw new Error("no copy");
    without.board = without.board.filter((o) => o.id !== hung.id);
    expect(F.check(y)).toBe(F.check(without));
    expect(F.answer(y)).toEqual({ tick: y.tick, check: F.check(y), hung: [hung] });
    // The depot gives it nothing yet: with it alone on the board, what it wants goes to nothing.
    const thing = F.ALL_ITEMS.find((n) => (hung.want[n] ?? 0) > 0) ?? F.item("plank");
    y.board = [hung];
    F.deliver(y, thing, 1);
    expect(hung.filled[thing] ?? 0).toBe(0);
    for (let k = 0; k < F.ORDER_WAITS; k++) F.step(y);
    expect(F.answer(y).hung).toEqual([]);
    F.deliver(y, thing, 1);
    expect(hung.filled[thing]).toBe(1);
  });

  test("a yard with no seed, as the page's copy is, hangs none", () => {
    const y = F.create({ seed: 3, tier: 4 });
    const page = F.decode(F.encode(y, { seed: false }), y.land);
    if (!page) throw new Error("no copy");
    const order = page.board[0];
    if (!order) throw new Error("no board");
    for (const n of F.ALL_ITEMS) order.filled[n] = order.want[n] ?? 0;
    expect(give(page, { do: "handOver", order: order.id })).not.toHaveProperty("refused");
    expect(page.board.length).toBe(2);
  });
});
