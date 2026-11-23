/**
 * The planner: what a piece makes and needs a minute, how many of the piece before it that is, and
 * the whole tree for a thing at a pace; and that the yard, run, does what it says. Every number is
 * read from the tables, so these hold whatever the recipes count and however fast the pieces work.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

const plank = F.item("plank");
const hamper = F.RECIPE[F.item("hamper")];
const mill = F.RECIPE[plank];

/**
 * A yard of tier 4 on bare land, a machine on (6, 4) of a grade, which hands into a shut crate at
 * (7, 4), fed by a crate at (5, 4) and one at (6, 3): one for each part, as a crate lets out
 * whatever it holds most of.
 */
function fed(kind: F.KindName, grade: number, item: F.ItemName | null): F.Yard {
  const y = F.create({ land: bareLand(13, 9, [], [9, 4]), tier: 4, seed: 1 });
  must(y, { do: "build", kind: "crate", x: 5, y: 4, dir: 0 });
  must(y, { do: "build", kind: "crate", x: 6, y: 3, dir: 1 });
  must(y, { do: "build", kind, x: 6, y: 4, dir: 0, grade });
  if (item) must(y, { do: "recipe", x: 6, y: 4, item });
  must(y, { do: "build", kind: "crate", x: 7, y: 4, dir: 0 });
  must(y, { do: "crate", x: 7, y: 4, open: false });
  return y;
}
const heldAt = (y: F.Yard, x: number, n: F.Item, z = 4): number => F.held(y.holders, y.row[F.at(y, x, z)] ?? -1, n);

describe("the planner", () => {
  test("what a machine makes a minute goes up with its grade as its pace does, and it needs of each part that times the recipe's count", () => {
    for (const r of F.RECIPES_N)
      for (const grade of [1, 2, 3]) {
        const makes = F.makes(r.by, grade, r);
        expect(makes).toBeCloseTo((F.makes(r.by, 1, r) * (F.PACE[grade] ?? 0)) / (F.PACE[1] ?? 1));
        expect(F.needs(grade, r)).toEqual(r.from.map((item, k) => ({ item, perMinute: makes * (r.need[k] ?? 0) })));
      }
  });

  test("the feeders of a machine are what it needs of each part over what one of the piece before makes of it", () => {
    for (const r of F.RECIPES_N)
      for (const [before, grade] of [
        [1, 1],
        [2, 1],
        [1, 2],
      ] as const)
        for (const [k, f] of F.feeders(grade, r, before).entries()) {
          const need = F.needs(grade, r)[k]?.perMinute ?? 0;
          const { kind, recipe } = F.makerOf(f.item);
          const part = r.from[k];
          if (part === undefined) throw new Error("a feeder for no part");
          expect([f.item, f.kind]).toEqual([part, kind]);
          expect(f.count).toBeCloseTo(need / F.makes(kind, before, recipe));
        }
  });

  test("the whole tree for a thing at the pace of one machine: one of it, and below, each part's pieces at what their parent needs", () => {
    if (!hamper) throw new Error("no hamper recipe");
    const pace = F.makes(F.BENCH, 1, hamper);
    const tree = F.tree(F.item("hamper"), pace);
    expect(tree.count).toBe(1);
    const check = (b: F.Branch): void => {
      const { recipe } = F.makerOf(b.item);
      expect(b.count).toBeCloseTo(b.perMinute / F.makes(b.kind, 1, recipe));
      for (const [k, part] of b.from.entries()) {
        expect(part.perMinute).toBeCloseTo(b.perMinute * (recipe?.need[k] ?? 0));
        check(part);
      }
    };
    check(tree);
    // The bill sums the tree's pieces below the root, by kind and thing, in the order the tree names them.
    expect(F.bill(tree).map((b) => [F.kindName(b.kind), F.itemName(b.item)])).toEqual([
      ["mill", "plank"],
      ["gatherer", "deadfall"],
      ["mill", "pot"],
      ["gatherer", "clay"],
    ]);
  });

  test("a line of belt of each grade, fed flat out, carries what the planner says: a minute over the whole ticks a thing takes across a tile", () => {
    expect([1, 2, 3].map(F.carried)).toEqual([1, 2, 3].map((g) => F.MINUTE / Math.ceil(8 / (F.PACE[g] ?? 1))));
    for (const grade of [1, 2, 3])
      // Fed by a crate, and through a splitter, which hands on at the top grade's pace.
      for (const first of ["belt", "splitter"] as const) {
        const y = F.create({ land: bareLand(13, 9, [], [9, 4]), tier: 4, seed: 1 });
        must(y, { do: "build", kind: "crate", x: 1, y: 4, dir: 0 });
        must(y, { do: "build", kind: first, x: 2, y: 4, dir: 0 });
        for (let x = 3; x <= 7; x++) must(y, { do: "build", kind: "belt", x, y: 4, dir: 0 });
        // A grade the slice does not unlock is set on the piece, as the tests of grades set it.
        for (let x = first === "belt" ? 2 : 3; x <= 7; x++) y.grade[F.at(y, x, 4)] = grade;
        F.changed(y);
        const crate = F.holderOf(y, F.at(y, 1, 4));
        const top = (): void => {
          while (F.held(y.holders, crate, plank) < 8) F.put(y.holders, crate, plank);
        };
        const run = (ticks: number): void => {
          for (let k = 0; k < ticks; k++) {
            top();
            F.step(y);
          }
        };
        // A minute once the line is full to its end.
        run(120);
        const before = y.depot[plank] ?? 0;
        run(F.MINUTE);
        expect((y.depot[plank] ?? 0) - before).toBe(F.carried(grade));
      }
  });

  test("a mill kept fed in a yard makes what the planner says it makes, at each grade", () => {
    if (!mill) throw new Error("no plank recipe");
    for (const grade of [1, 2]) {
      const y = fed("mill", grade, null);
      const each = F.makes(F.MILL, grade, mill);
      const feed = y.row[F.at(y, 5, 4)] ?? -1;
      for (let k = 0; k < 2 * each + 20; k++) F.put(y.holders, feed, F.item("deadfall"));
      // A minute once it is going: its first plank waits on its first deadfall.
      for (let k = 0; k < 60; k++) F.step(y);
      const before = heldAt(y, 7, plank);
      for (let k = 0; k < F.MINUTE; k++) F.step(y);
      expect(heldAt(y, 7, plank) - before).toBe(each);
    }
  });

  test("a bench kept fed in a yard makes what the planner says, and takes of each part what it says it needs", () => {
    if (!hamper) throw new Error("no hamper recipe");
    const y = fed("bench", 1, "hamper");
    const needs = F.needs(1, hamper);
    const feeds: [number, number][] = [
      [5, 4],
      [6, 3],
    ];
    for (const [k, { item, perMinute }] of needs.entries()) {
      const [x, z] = feeds[k] ?? [5, 4];
      for (let n = 0; n < 2 * perMinute + 20; n++) F.put(y.holders, y.row[F.at(y, x, z)] ?? -1, item);
    }
    const left = (): number[] => needs.map((n, k) => heldAt(y, feeds[k]?.[0] ?? 5, n.item, feeds[k]?.[1] ?? 4));
    for (let k = 0; k < 120; k++) F.step(y);
    const made = heldAt(y, 7, F.item("hamper"));
    const before = left();
    for (let k = 0; k < F.MINUTE; k++) F.step(y);
    expect(heldAt(y, 7, F.item("hamper")) - made).toBe(F.makes(F.BENCH, 1, hamper));
    const after = left();
    expect(needs.map((_, k) => (before[k] ?? 0) - (after[k] ?? 0))).toEqual(needs.map((n) => n.perMinute));
  });
});
