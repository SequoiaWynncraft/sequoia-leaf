/**
 * A machine's rate and the yard's power, as every screen reads them: one projection each, from the
 * rules. `machineRate` says what a piece makes at full power, what it makes now (nothing where power
 * does not reach) and what it draws; `powerSummary` says what each kind in reach draws, which adds up
 * to the power drawn; `power(y).speed` is the whole per cent machines work at, rounded down.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { delivering, must } from "./yards.ts";

const plank = F.item("plank");
const sawing = F.RECIPE[plank] ?? null;

/** Builds a mill of a grade on the first tile, lit or dark as asked, that takes one; its tile. */
function millAt(y: F.Yard, lit: boolean, grade = 1): number {
  const on = F.litOf(y);
  for (let i = 0; i < y.kind.length; i++)
    if (
      y.kind[i] === F.NONE &&
      (on[i] === 1) === lit &&
      F.build(y, F.MILL, i % y.land.w, Math.floor(i / y.land.w), 0, Infinity, { grade }).ok
    )
      return i;
  throw new Error("no room for a mill");
}
const told = (y: F.Yard, i: number, n: F.ItemName): void => {
  if (F.setRecipe(y, i % y.land.w, Math.floor(i / y.land.w), F.item(n)) !== null) throw new Error("not told");
};

describe("a machine's rate", () => {
  test("where power does not reach: its recipe's at full power, nothing now, and it draws nothing", () => {
    const y = F.create({ seed: 5, tier: 2 });
    const i = millAt(y, false);
    told(y, i, "plank");
    expect(F.machineRate(y, i)).toEqual({ nominal: F.makes(F.MILL, 1, sawing), share: 0, effective: 0, draw: 0 });
  });

  test("short of power: the yard's pace of its full rate, drawing its grade's power", () => {
    const y = F.create({ seed: 5, tier: 4 });
    const mills = Array.from({ length: 9 }, () => millAt(y, true, 2));
    const i = mills[0] ?? -1;
    told(y, i, "plank");
    const { pace } = F.power(y);
    expect(pace).toBeLessThan(1);
    expect(F.machineRate(y, i)).toEqual({
      nominal: F.makes(F.MILL, 2, sawing),
      share: pace,
      effective: F.makes(F.MILL, 2, sawing) * pace,
      draw: 4.5,
    });
  });
});

describe("the power summary", () => {
  test("counts each kind in reach and in the dark, and what those in reach draw, which adds up to the power drawn", () => {
    const y = F.create({ seed: 5, tier: 4 });
    millAt(y, true, 2);
    millAt(y, true, 1);
    millAt(y, false, 1);
    const s = F.powerSummary(y);
    // Each mill draws 3 at grade I and 4.5 at grade II; the one in the dark draws none.
    expect(s.draws.find((d) => d.kind === F.MILL)).toEqual({
      kind: F.MILL,
      lit: 2,
      dark: 1,
      drawn: 7.5,
      each: [3, 4.5],
    });
    expect(s.draws.reduce((n, d) => n + d.drawn, 0)).toBe(s.demand);
    expect(s.demand).toBe(F.power(y).demand);
  });

  test("says what one in reach draws from those in reach only: one in the dark draws nothing, whatever its grade", () => {
    const y = F.create({ seed: 5, tier: 4 });
    millAt(y, false, 2);
    const dark = F.powerSummary(y).draws.find((d) => d.kind === F.MILL);
    expect(dark).toEqual({ kind: F.MILL, lit: 0, dark: 1, drawn: 0, each: [0, 0] });
    millAt(y, true, 1);
    const mixed = F.powerSummary(y).draws.find((d) => d.kind === F.MILL);
    expect(mixed).toEqual({ kind: F.MILL, lit: 1, dark: 1, drawn: 3, each: [3, 3] });
  });

  test("says what the depot and the waterwheels give and the boilers burning, which adds up to the power made", () => {
    const y = delivering();
    const s = F.powerSummary(y);
    expect(s.depot + s.wheels.turning * (F.GIVES[F.WHEEL] ?? 0) + s.boilers.burning * (F.GIVES[F.BOILER] ?? 0)).toBe(
      s.supply,
    );
  });
});

describe("speed", () => {
  test("is the whole per cent of the power drawn that is made, rounded down, so a yard a little short is never at 100%", () => {
    const y = F.create({ seed: 5, tier: 4 });
    for (let k = 0; k < 9; k++) millAt(y, true, 2);
    expect(F.power(y)).toMatchObject({ supply: 40, demand: 40.5, speed: 98 });
    // In halves: 200 made of 201 drawn, and 29 of 100, which a float times 100 would put below 29.
    y.supply = 400;
    y.demand = 402;
    expect(F.power(y).speed).toBe(99);
    y.supply = 29;
    y.demand = 100;
    expect(F.power(y).speed).toBe(29);
    y.supply = 100;
    expect(F.power(y).speed).toBe(100);
  });
});

describe("a machine's last recipe", () => {
  test("is the one it last began, kept while it holds nothing, and goes with it when it is taken away", () => {
    const y = delivering();
    const mill = F.at(y, 29, 20);
    for (let k = 0; k < 600 && F.aim(y, mill) !== null; k++) F.step(y);
    expect([F.aim(y, mill), F.lastRecipe(y, mill)]).toEqual([null, sawing]);
    must(y, { do: "remove", x: 29, y: 20 });
    must(y, { do: "build", kind: "mill", x: 29, y: 20, dir: 2 });
    expect(F.lastRecipe(y, mill)).toBeNull();
  });

  test("is not kept in a save, so a yard read afresh takes it from the copy it replaces, where the same machine still stands", () => {
    const y = delivering();
    const mill = F.at(y, 29, 20);
    for (let k = 0; k < 600 && F.aim(y, mill) !== null; k++) F.step(y);
    expect(F.lastRecipe(y, mill)).toBe(sawing);
    const read = (): F.Yard => {
      const fresh = F.decode(F.encode(y), y.land);
      if (!fresh) throw new Error("the yard did not read back");
      return fresh;
    };
    expect(F.lastRecipe(read(), mill)).toBeNull();
    const kept = read();
    F.keepLast(y, kept);
    expect(F.lastRecipe(kept, mill)).toBe(sawing);
    // A bench where the mill stood, in the yard as read, takes nothing of the mill's.
    const other = read();
    must(other, { do: "remove", x: 29, y: 20 });
    must(other, { do: "build", kind: "bench", x: 29, y: 20, dir: 2 });
    F.keepLast(y, other);
    expect(F.lastRecipe(other, mill)).toBeNull();
  });
});
