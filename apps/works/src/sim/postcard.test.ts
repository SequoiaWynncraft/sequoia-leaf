import { describe, expect, test } from "bun:test";

import { create } from "./create.ts";
import { postcard } from "./postcard.ts";

describe("the postcard for the town", () => {
  test("a new yard is working on its first order, has made nothing and has nothing in the till", () => {
    const w = create({ seed: 3 });
    w.till = 0;
    expect(postcard(w)).toEqual({ waiting: "The yard is working on planks for the Treasury.", trophies: [], till: 0 });
  });

  test("the capstones ever made, and the whole Coins in the till", () => {
    const w = create({ seed: 3 });
    w.depot.crab = 1;
    w.till = 41.7;
    expect(postcard(w).trophies).toEqual(["crab"]);
    expect(postcard(w).till).toBe(41);
    w.depot.beacon = 2;
    expect(postcard(w).trophies).toEqual(["crab", "beacon"]);
  });

  test("filled orders waiting at the gate come first", () => {
    const w = create({ seed: 3 });
    w.board = [
      { id: 1, title: "Lanterns", from: "Tindra", line: "", want: { lantern: 2 }, pay: 50, filled: { lantern: 2 } },
      { id: 2, title: "Pots", from: "Pipwick", line: "", want: { pot: 2 }, pay: 50, filled: { pot: 2 } },
    ];
    expect(postcard(w).waiting).toBe("2 orders are filled and waiting at the gate.");
  });
});
