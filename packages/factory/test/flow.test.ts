/**
 * What a yard can make and needs a minute (`flow`): the planner's numbers for the pieces that stand,
 * at the share of ticks the yard's power lets them work; and that the yard, run, brings the depot no
 * more of a thing than it says the yard can make. Every number is read from the tables.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { folioOf, freeResearch, idOf } from "./goals.ts";
import { bareLand } from "./land.ts";
import { lay, must } from "./yards.ts";

const deadfall = F.item("deadfall");
const plank = F.item("plank");
const sawing = F.RECIPE[plank];
const gathers = F.makes(F.GATHERER, 1, null);

/** What a yard can make and needs of each thing a minute, as `flow` adds them up. */
function flows(y: F.Yard): { made: F.Counts; needed: F.Counts } {
  const made = F.counts();
  const needed = F.counts();
  F.flow(y, made, needed);
  return { made, needed };
}
const run = (y: F.Yard, ticks: number): void => {
  for (let k = 0; k < ticks; k++) F.step(y);
};

/** A yard of tier 4 with deadfall at (3, 4) and the depot at (9, 4): a gatherer there, a mill beside it, and belts on to the depot. */
function sawmill(): F.Yard {
  const y = F.create({ land: bareLand(15, 9, [[3, 4, "deadfall"]], [9, 4]), tier: 4, seed: 1 });
  must(y, { do: "build", kind: "gatherer", x: 3, y: 4, dir: 0 });
  must(y, { do: "build", kind: "mill", x: 4, y: 4, dir: 0 });
  lay(y, [5, 4], y.land.depot);
  return y;
}

describe("what a yard can make and needs a minute", () => {
  test("a gatherer and the mill it feeds: the deadfall one gathers, the planks one mill saws, and the deadfall that takes, as the planner has them", () => {
    if (!sawing) throw new Error("no plank recipe");
    const y = sawmill();
    // The mill is told nothing: it is sawing once it holds deadfall.
    run(y, 60);
    const { made, needed } = flows(y);
    expect(made[deadfall]).toBe(gathers);
    expect(made[plank]).toBe(F.makes(F.MILL, 1, sawing));
    expect(needed[deadfall]).toBe(F.needs(1, sawing)[0]?.perMinute ?? -1);
    // Nothing else is made or needed, and nobody needs planks.
    expect(made.reduce((n, v) => n + v, 0)).toBe(gathers + F.makes(F.MILL, 1, sawing));
    expect(needed.reduce((n, v) => n + v, 0)).toBe(needed[deadfall] ?? -1);
  });

  test("a higher grade makes and needs more, as its pace is", () => {
    if (!sawing) throw new Error("no plank recipe");
    const y = sawmill();
    must(y, { do: "build", kind: "mill", x: 4, y: 4, dir: 0, grade: 2 });
    run(y, 60);
    const { made, needed } = flows(y);
    expect(made[plank]).toBe(F.makes(F.MILL, 2, sawing));
    expect(needed[deadfall]).toBe(F.needs(2, sawing)[0]?.perMinute ?? -1);
  });

  test("a machine told what to make is counted holding nothing; one told nothing, once it holds a part, and after it is empty again for what it last began, until it is taken away", () => {
    if (!sawing) throw new Error("no plank recipe");
    const y = sawmill();
    // Nothing has reached the mill yet.
    expect(flows(y).made[plank]).toBe(0);
    run(y, 60);
    expect(flows(y).made[plank]).toBe(F.makes(F.MILL, 1, sawing));
    // Its gatherer gone and the last of its deadfall sawn, it holds nothing and is told nothing.
    must(y, { do: "remove", x: 3, y: 4 });
    run(y, 200);
    expect(F.aim(y, F.at(y, 4, 4))).toBeNull();
    const kept = flows(y);
    expect([kept.made[plank], kept.needed[deadfall]]).toEqual([
      F.makes(F.MILL, 1, sawing),
      F.needs(1, sawing)[0]?.perMinute ?? -1,
    ]);
    // Taken away, and another mill built on its tile: that one has begun nothing.
    must(y, { do: "remove", x: 4, y: 4 });
    must(y, { do: "build", kind: "mill", x: 4, y: 4, dir: 0 });
    expect(flows(y).made[plank]).toBe(0);
    // Nor is it a bench's, on the same tile.
    must(y, { do: "remove", x: 4, y: 4 });
    must(y, { do: "build", kind: "bench", x: 4, y: 4, dir: 0 });
    expect(flows(y).made[plank]).toBe(0);
    // Told what to make, a machine is counted at once.
    const tool = F.RECIPE[F.item("tool")];
    if (!tool) throw new Error("no tool recipe");
    must(y, { do: "recipe", x: 4, y: 4, item: "tool" });
    const told = flows(y);
    expect(told.made[F.item("tool")]).toBe(F.makes(F.BENCH, 1, tool));
    for (const part of F.needs(1, tool)) expect(told.needed[part.item]).toBe(part.perMinute);
  });

  test("what power does not reach makes and needs nothing", () => {
    // Deadfall 9 tiles from the depot, beyond its reach.
    const y = F.create({ land: bareLand(15, 9, [[0, 4, "deadfall"]], [9, 4]), tier: 4, seed: 1 });
    must(y, { do: "build", kind: "gatherer", x: 0, y: 4, dir: 0 });
    expect(F.litOf(y)[F.at(y, 0, 4)]).toBe(0);
    expect(flows(y).made[deadfall]).toBe(0);
  });

  test("short of power, every piece is counted for the share of ticks it works", () => {
    const deposits: [number, number, "deadfall"][] = [];
    for (let z = 0; z < 11; z++) for (let x = 0; x < 11; x++) deposits.push([x, z, "deadfall"]);
    const y = F.create({ land: bareLand(11, 11, deposits, [5, 5]), tier: 2 });
    let built = 0;
    for (let z = 0; z < 11; z++)
      for (let x = 0; x < 11; x++)
        if (F.litOf(y)[F.at(y, x, z)] === 1 && F.build(y, F.GATHERER, x, z, 0, Infinity).ok) built++;
    F.rewire(y);
    const share = F.power(y).pace;
    expect(share).toBeLessThan(1);
    expect(flows(y).made[deadfall]).toBeCloseTo(built * gathers * share);
  });

  test("a boiler in reach needs the deadfall it burns", () => {
    const y = sawmill();
    must(y, { do: "build", kind: "boiler", x: 9, y: 7, dir: 0 });
    expect(flows(y).needed[deadfall]).toBe(F.MINUTE / F.TICKS.burn);
  });

  test("a Study needs the folios the research first in line still wants, at a Study's pace; with nothing studied, none", () => {
    const tier = Math.min(...F.GOALS.filter((g) => g.kind === "research").map((g) => g.tier));
    const research = freeResearch(tier)[0];
    if (research === undefined) throw new Error("no research");
    const { folio } = folioOf(research);
    const y = F.create({ land: bareLand(13, 9, [], [9, 4]), tier, seed: 1 });
    must(y, { do: "build", kind: "study", x: 5, y: 7, dir: 0 });
    expect(flows(y).needed[folio]).toBe(0);
    must(y, { do: "study", research: idOf(research) });
    const { needed } = flows(y);
    expect(needed[folio]).toBe(F.makes(F.STUDY, 1, null));
    expect(needed.reduce((n, v) => n + v, 0)).toBe(F.makes(F.STUDY, 1, null));
  });

  test("it makes nothing: the tallies it is given are all it writes", () => {
    const y = sawmill();
    run(y, 60);
    const made = F.counts();
    const needed = F.counts();
    F.flow(y, made, needed);
    const before = F.check(y);
    F.flow(y, made, needed);
    // Added to what was there, twice over; and the yard is as it was.
    expect(made[plank]).toBe(2 * F.makes(F.MILL, 1, sawing ?? null));
    expect(F.check(y)).toBe(before);
  });

  test("run, the yard brings the depot what it can make where nothing holds a line up, and never more", () => {
    if (!sawing) throw new Error("no plank recipe");
    const y = sawmill();
    // A minute to fill the line, then a minute counted.
    run(y, F.MINUTE);
    const before = y.depot[plank] ?? 0;
    run(y, F.MINUTE);
    const came = (y.depot[plank] ?? 0) - before;
    const { made } = flows(y);
    // One gatherer feeds a mill that could saw more: every thing gathered arrives as a plank.
    expect(came).toBe(gathers);
    expect(came).toBeLessThanOrEqual(made[plank] ?? 0);
  });
});
