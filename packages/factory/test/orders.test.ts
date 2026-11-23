/**
 * Standing orders: sized by the tier reached; counting only from 50 ticks after they are hung, until
 * when the depot gives them nothing, the check leaves them out, they hold nothing and cannot be handed
 * over; a fresh one hung at the end of the board; and what the answer to a batch carries.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { give, must } from "./yards.ts";

/** Fills an order by hand. */
const fill = (o: F.Standing): void => {
  for (const n of F.ALL_ITEMS) o.filled[n] = o.want[n] ?? 0;
};
/** A kept order with another id. */
const withId = (o: unknown, id: number): unknown => (typeof o === "object" ? { ...o, id } : o);
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
    // Past the minute for which the answer carries the orders the board went up with.
    for (let k = 0; k < F.ORDER_TOLD; k++) F.step(y);
    const first = y.board[0];
    if (!first) throw new Error("no board");
    must(y, { do: "swap", order: first.id });
    const hung = y.board.at(-1);
    if (!hung) throw new Error("nothing hung");
    expect([y.board.length, hung.starts]).toEqual([y.open.hooks, y.tick + F.ORDER_WAITS]);
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
    // It counts now, and the answer still carries it: a batch may have run past this tick.
    expect(F.answer(y).hung).toEqual([hung]);
    F.deliver(y, thing, 1);
    expect(hung.filled[thing]).toBe(1);
    for (let k = F.ORDER_WAITS; k < F.ORDER_TOLD; k++) F.step(y);
    expect(F.answer(y).hung).toEqual([]);
  });

  test("one that does not count yet cannot be handed over, and is read back holding nothing; one kept without the tick it counts from is left out", () => {
    const y = F.create({ seed: 3, tier: 4 });
    const early = y.board[0];
    if (!early) throw new Error("no board");
    fill(early);
    expect(give(y, { do: "handOver", order: early.id })).toMatchObject({ refused: "not_filled" });
    expect(F.decode(F.encode(y), y.land)?.board[0]?.filled).toEqual(F.counts());
    for (let k = 0; k < F.ORDER_WAITS; k++) F.step(y);
    const rec: unknown = JSON.parse(F.encode(y));
    if (typeof rec !== "object" || rec === null || !("board" in rec) || !Array.isArray(rec.board))
      throw new Error("no board kept");
    const board: unknown[] = rec.board.map((o: unknown, k: number) =>
      k === 0 && typeof o === "object" && o !== null ? { ...o, starts: undefined } : o,
    );
    const back = F.decode(JSON.stringify({ ...rec, board }), y.land);
    expect(back?.board.some((o) => o.id === early.id)).toBe(false);
    expect(back && give(back, { do: "handOver", order: early.id })).toMatchObject({ refused: "not_filled" });
    expect(give(y, { do: "handOver", order: early.id })).not.toHaveProperty("refused");
  });

  test("a kept board reads back as play hangs one, ids rising and each below the count ever hung, so handing over, swapping and the answer act on one order once", () => {
    const y = F.create({ seed: 3, tier: 4 });
    for (let k = 0; k < F.ORDER_WAITS; k++) F.step(y);
    const rec: unknown = JSON.parse(F.encode(y));
    if (typeof rec !== "object" || rec === null || !("board" in rec) || !Array.isArray(rec.board))
      throw new Error("no board kept");
    const [a, b, c]: unknown[] = rec.board;
    // Two with one id, one with an id not hung yet, and two out of order.
    for (const board of [
      [a, withId(b, 0), c],
      [a, b, withId(c, 3)],
      [b, a, c],
    ]) {
      const text = JSON.stringify({ ...rec, board });
      const back = F.decode(text, y.land);
      if (!back) throw new Error("the yard does not read back");
      const ids = back.board.map((o) => o.id);
      expect(ids.every((id, k) => id < back.serial && id > (ids[k - 1] ?? -1))).toBe(true);
      // Every order was hung within the minute: the answer carries each once.
      expect(F.answer(back).hung.map((o) => o.id)).toEqual(ids);
      // Swapping one takes that one down; handing each over pays it once.
      const first = ids[0] ?? -1;
      expect(give(back, { do: "swap", order: first })).not.toHaveProperty("refused");
      expect(back.board.some((o) => o.id === first)).toBe(false);
      for (let k = 0; k < F.ORDER_WAITS; k++) F.step(back);
      for (const order of back.board.slice(0, 2)) {
        fill(order);
        expect(give(back, { do: "handOver", order: order.id })).toMatchObject({
          log: [{ kind: "works_order", data: { order: order.id, pay: order.pay } }],
        });
        expect(give(back, { do: "handOver", order: order.id })).toMatchObject({ refused: "not_filled" });
      }
      expect(new Set(back.board.map((o) => o.id)).size).toBe(back.board.length);
      // Read back twice, the same yard.
      expect(F.encode(F.decode(text, y.land) ?? y)).toBe(F.encode(F.decode(text, y.land) ?? y));
    }
  });

  test("a yard with no seed, as the page's copy is, hangs none", () => {
    const y = F.create({ seed: 3, tier: 4 });
    for (let k = 0; k < F.ORDER_WAITS; k++) F.step(y);
    const page = F.decode(F.encode(y, { seed: false }), y.land);
    if (!page) throw new Error("no copy");
    const order = page.board[0];
    if (!order) throw new Error("no board");
    for (const n of F.ALL_ITEMS) order.filled[n] = order.want[n] ?? 0;
    expect(give(page, { do: "handOver", order: order.id })).not.toHaveProperty("refused");
    expect(page.board.length).toBe(page.open.hooks - 1);
  });
});
