/**
 * The panels: the side orders keep their places in the list, and each panel is kept by what it
 * prints (`shows`), so a value it shows that changes alone, such as the minutes before an order may
 * be swapped again or what the depot has taken in, changes what it is kept by.
 */
import { describe, expect, test } from "bun:test";

import { create, deliver, item, play, power } from "@sequoia-leaf/factory";

import { S } from "../state.ts";
import { depotPrint, ordersPrint, placed, powerPrint } from "./panels.ts";

const order = (id: number, planks: number): { id: number; full: boolean } => ({ id, full: planks >= 10 });
const ids = (list: readonly { id: number }[]): number[] => list.map((s) => s.id);
/** Why each order on the board cannot be swapped now, as the orders panel prints it. */
const why = (): (string | null)[] => ordersPrint().orders.map((o) => o.why);

test("filled orders are first when the list opens, and an order keeps its place until one leaves", () => {
  const open = ids(placed([], [order(1, 0), order(2, 10), order(3, 4), order(4, 10)]));
  expect(open).toEqual([2, 4, 1, 3]);
  // Order 3 fills while the list is open: it stays where it is.
  const board = [order(1, 0), order(2, 10), order(3, 10), order(4, 10)];
  expect(ids(placed(open, board))).toEqual(open);
  // Order 2 is handed over: the filled ones that stay are first, in the order they were in.
  const handed = ids(placed(open, board.slice(2).concat(order(1, 0))));
  expect(handed).toEqual([4, 3, 1]);
  // Leaf hangs a fresh order in the first slot of the board: the list shows it last.
  expect(ids(placed(handed, [order(5, 0), order(1, 0), order(3, 10), order(4, 10)]))).toEqual([4, 3, 1, 5]);
});

describe("a panel is kept by what it prints", () => {
  test("the orders: an order just swapped says how many minutes until the next, and the minutes count down", () => {
    const y = create({ seed: 5, tier: 1 });
    const first = y.board[0];
    if (!first) throw new Error("no board");
    const did = play(y, { do: "swap", order: first.id, tick: y.tick });
    if ("refused" in did) throw new Error(did.why);
    S.world = y;
    const now = JSON.stringify(ordersPrint());
    expect(why()[0]).toMatch(/^You can replace an order again in \d+ minutes$/);
    // A minute on, nothing else about the board changed.
    y.tick += 600;
    expect(why()[0]).not.toBe(JSON.parse(now).orders[0].why);
    expect(JSON.stringify(ordersPrint())).not.toBe(now);
  });

  test("power: a yard a little short is never printed as at 100%", () => {
    const y = create({ seed: 5, tier: 1 });
    // Worked out once, then set a hair short: 200 power made, 201 drawn.
    power(y);
    y.supply = 400;
    y.demand = 402;
    S.world = y;
    expect([power(y).pace < 1, Math.round(power(y).pace * 100), powerPrint().pace]).toEqual([true, 100, 99]);
  });

  test("the depot's book: each thing taken in counts, as it is printed", () => {
    const y = create({ seed: 5, tier: 1 });
    S.world = y;
    const before = JSON.stringify(depotPrint());
    deliver(y, item("plank"), 1);
    expect(depotPrint().rows.find(([k]) => k === item("plank"))?.[2]).toBe("1");
    expect(JSON.stringify(depotPrint())).not.toBe(before);
  });
});
