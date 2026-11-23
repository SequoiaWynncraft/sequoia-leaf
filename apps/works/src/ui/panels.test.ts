import { expect, test } from "bun:test";

import type { Standing } from "@sequoia-leaf/yard";

import { placed } from "./panels.ts";

const order = (id: number, planks: number): Standing => ({
  id,
  title: "",
  from: "",
  line: "",
  want: { plank: 10 },
  pay: 1,
  filled: { plank: planks },
  starts: 0,
});
const ids = (list: readonly Standing[]): number[] => list.map((s) => s.id);

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
