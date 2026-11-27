import { describe, expect, test } from "bun:test";

import { aim, at, item, makes, MILL, RECIPE, step } from "@sequoia-leaf/factory";
import { near, xy } from "@sequoia-leaf/factory/test/near.ts";
import { delivering, must } from "@sequoia-leaf/factory/test/yards.ts";

import { cellOf, flowRows, said, yardFlows } from "./flows.ts";

const plank = item("plank");
const ore = item("ore");
const clay = item("clay");
const ingot = item("ingot");

describe("makes and needs", () => {
  test("a number a minute is said as a quantity is (`num`), and none is faint", () => {
    expect([40, 37.5, 1234.4, 10, 9.96].map((v) => said(cellOf(v)))).toEqual(["40", "38", "1,234", "10", "10"]);
    expect([2.5, 0.3, 9.94, 3, 0.04].map((v) => said(cellOf(v)))).toEqual(["2.5", "0.3", "9.9", "3", "0"]);
    expect([cellOf(0), cellOf(0.04), cellOf(-2), cellOf(3)]).toEqual([
      ["0", "faint"],
      ["0", "faint"],
      ["0", "faint"],
      "3",
    ]);
  });

  test("the rows are every thing made, needed or come in; what the yard is short of first, the largest shortfall first, the rest in the tables' order", () => {
    const made = new Float64Array(30);
    const needed = new Float64Array(30);
    made[plank] = 50;
    needed[plank] = 20;
    made[ore] = 40;
    needed[ore] = 100;
    needed[clay] = 650;
    made[clay] = 160;
    const rows = flowRows(made, needed, (k) => (k === ingot ? 12 : 0));
    // Clay is short by 490, ore by 60; planks are made in plenty; ingots only came in.
    expect(rows.map((f) => f.item)).toEqual([clay, ore, plank, ingot]);
    expect(rows.find((f) => f.item === ingot)).toEqual({ item: ingot, made: 0, needed: 0, reached: 12 });
    // A thing nobody makes, needs or has sent in has no row.
    expect(rows.some((f) => f.item === item("glass"))).toBe(false);
  });

  test("what the yard can make is the rules' reckoning of what stands, kept for a second of the yard's clock", () => {
    const y = delivering();
    const first = yardFlows(y);
    const sawing = RECIPE[plank];
    if (!sawing) throw new Error("no plank recipe");
    // The delivering yard has one mill, sawing.
    expect(first.made[plank]).toBe(makes(MILL, 1, sawing));
    expect(first.needed[item("deadfall")]).toBe(makes(MILL, 1, sawing));
    // Asked again in the same second it is the same reckoning; a second on, or after a change, it is worked out again.
    const before = Array.from(first.made);
    expect(Array.from(yardFlows(y).made)).toEqual(before);
    for (let k = 0; k < 10; k++) step(y);
    expect(Array.from(yardFlows(y).made)).toEqual(before);
    y.rev++;
    expect(Array.from(yardFlows(y).made)).toEqual(before);
  });

  test("a machine holding nothing for a moment is still counted for the recipe it was working on", () => {
    const y = delivering();
    const mill = at(y, ...xy(5, 2));
    for (let k = 0; k < 600 && aim(y, mill) !== null; k++) step(y);
    expect(aim(y, mill)).toBeNull();
    expect(yardFlows(y).made[plank]).toBe(makes(MILL, 1, RECIPE[plank] ?? null));
  });

  test("a machine taken away is no longer counted: a fresh one built in its place, told nothing, is counted for nothing", () => {
    const y = delivering();
    must(y, { do: "recipe", ...near(5, 2), item: "plank" });
    expect(yardFlows(y).made[plank]).toBe(makes(MILL, 1, RECIPE[plank] ?? null));
    must(y, { do: "remove", ...near(5, 2) });
    expect(yardFlows(y).made[plank]).toBe(0);
    must(y, { do: "build", kind: "mill", ...near(5, 2), dir: 2 });
    expect(aim(y, at(y, ...xy(5, 2)))).toBeNull();
    expect(yardFlows(y).made[plank]).toBe(0);
  });
});
