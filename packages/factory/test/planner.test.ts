/**
 * The planner: what a piece makes and needs a minute, how many of the piece before it that is, and
 * the whole tree for a thing at a pace; and that the yard, run, does what it says.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

const plank = F.item("plank");
const hamper = F.RECIPE[F.item("hamper")];
const mill = F.RECIPE[plank];

describe("the planner", () => {
  test("a mill makes 50 planks a minute at grade 1 and 75 at grade 2, from as much deadfall: 1.25 gatherers at grade 1", () => {
    if (!mill) throw new Error("no plank recipe");
    expect([F.makes(F.MILL, 1, mill), F.makes(F.MILL, 2, mill), F.makes(F.MILL, 3, mill)]).toEqual([50, 75, 100]);
    expect(F.needs(1, mill)).toEqual([{ item: F.item("deadfall"), perMinute: 50 }]);
    expect(F.feeders(1, mill)).toEqual([{ item: F.item("deadfall"), kind: F.GATHERER, count: 1.25 }]);
    expect(F.feeders(1, mill, 2)[0]?.count).toBeCloseTo(50 / 60);
  });

  test("a bench making hampers needs 60 planks and 30 pots a minute: 1.2 mills and 0.6", () => {
    if (!hamper) throw new Error("no hamper recipe");
    expect(F.makes(F.BENCH, 1, hamper)).toBe(30);
    expect(F.feeders(1, hamper).map((f) => [F.itemName(f.item), f.count])).toEqual([
      ["plank", 1.2],
      ["pot", 0.6],
    ]);
  });

  test("the whole tree for 30 hampers a minute, and what it takes of each piece", () => {
    const tree = F.tree(F.item("hamper"), 30);
    expect(tree.count).toBe(1);
    expect(F.bill(tree).map((b) => [F.kindName(b.kind), F.itemName(b.item), b.count])).toEqual([
      ["mill", "plank", 1.2],
      ["gatherer", "deadfall", 1.5],
      ["mill", "pot", 0.6],
      ["gatherer", "clay", 0.75],
    ]);
    expect(F.makes(F.STUDY, 1, null)).toBe(12);
  });

  test("a mill kept fed in a yard makes what the planner says it makes, at each grade", () => {
    for (const grade of [1, 2]) {
      const y = F.create({ land: bareLand(13, 9, [], [9, 4]), tier: 4, seed: 1 });
      must(y, { do: "build", kind: "crate", x: 5, y: 4, dir: 0 });
      must(y, { do: "build", kind: "mill", x: 6, y: 4, dir: 0, grade });
      must(y, { do: "build", kind: "crate", x: 7, y: 4, dir: 0 });
      must(y, { do: "crate", x: 7, y: 4, open: false });
      const feed = y.row[F.at(y, 5, 4)] ?? -1;
      for (let k = 0; k < 120; k++) F.put(y.holders, feed, F.item("deadfall"));
      const planks = (): number => F.held(y.holders, y.row[F.at(y, 7, 4)] ?? -1, plank);
      // A minute once it is going: its first plank waits on its first deadfall.
      for (let k = 0; k < 60; k++) F.step(y);
      const before = planks();
      for (let k = 0; k < F.MINUTE; k++) F.step(y);
      expect(planks() - before).toBe(mill ? F.makes(F.MILL, grade, mill) : 0);
    }
  });
});
