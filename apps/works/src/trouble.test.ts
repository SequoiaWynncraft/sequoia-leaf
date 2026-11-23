import { beforeEach, describe, expect, test } from "bun:test";

import { at, create, item, put, step, type Yard } from "@sequoia-leaf/factory";
import { bareLand } from "@sequoia-leaf/factory/test/land.ts";
import { lay, must } from "@sequoia-leaf/factory/test/yards.ts";

import { forgetTrouble, troubled, troubleGroups } from "./trouble.ts";

const deadfall = item("deadfall");

/** The tiles listed as in trouble, as (x, y). */
const listed = (y: Yard, rev = 0): string[] => {
  const f = troubled(y, rev);
  return Array.from(f.tiles.subarray(0, f.count), (i) => `${i % y.land.w},${Math.floor(i / y.land.w)}`);
};
/** Runs a yard on so many ticks, looking for trouble after each, as the screen does. */
function watch(y: Yard, ticks: number, rev = 0): void {
  for (let k = 0; k < ticks; k++) {
    step(y);
    troubled(y, rev);
  }
}

/**
 * A yard of tier 4 on bare land with the depot at (9, 4) and deadfall at (3, 4), (3, 6) and, out of
 * the depot's reach, at (0, 4): nothing built.
 */
const yard = (): Yard =>
  create({
    land: bareLand(
      15,
      9,
      [
        [3, 4, "deadfall"],
        [3, 6, "deadfall"],
        [0, 4, "deadfall"],
      ],
      [9, 4],
    ),
    tier: 4,
    seed: 1,
  });

beforeEach(forgetTrouble);

describe("the pieces in trouble", () => {
  test("the first look at a yard takes its trouble as it finds it; after that, trouble is listed once it has lasted a second and a half", () => {
    const y = yard();
    // A gatherer where no power reaches: in trouble from the moment it stands.
    must(y, { do: "build", kind: "gatherer", x: 0, y: 4, dir: 0 });
    expect(listed(y)).toEqual(["0,4"]);
    // A boiler with nothing to burn, built while the yard is watched: listed 15 ticks on.
    must(y, { do: "build", kind: "boiler", x: 9, y: 7, dir: 0 });
    expect(listed(y, 1)).toEqual(["0,4"]);
    watch(y, 14, 1);
    expect(listed(y, 1)).toEqual(["0,4"]);
    watch(y, 6, 1);
    expect(listed(y, 1)).toEqual(["0,4", "9,7"]);
  });

  test("a piece that goes in and out of trouble every few seconds stays listed; six seconds out of it, it is dropped", () => {
    const y = yard();
    must(y, { do: "build", kind: "boiler", x: 9, y: 7, dir: 0 });
    const row = y.row[at(y, 9, 7)] ?? -1;
    expect(listed(y)).toEqual(["9,7"]);
    // One piece of deadfall burns for two seconds: the boiler runs, and is still listed.
    put(y.holders, row, deadfall);
    watch(y, 12);
    expect(listed(y)).toEqual(["9,7"]);
    // Cold again, and fed again: still one line of the list.
    watch(y, 30);
    put(y.holders, row, deadfall);
    watch(y, 12);
    expect(listed(y)).toEqual(["9,7"]);
    // Kept burning for more than six seconds, it is in trouble no longer.
    for (let n = 0; n < 6; n++) put(y.holders, row, deadfall);
    watch(y, 80);
    expect(listed(y)).toEqual([]);
  });

  test("what a change to the yard mended is dropped at once", () => {
    const y = yard();
    must(y, { do: "build", kind: "gatherer", x: 0, y: 4, dir: 0 });
    expect(listed(y)).toEqual(["0,4"]);
    // A pylon within the depot's reach, whose light reaches the gatherer.
    must(y, { do: "build", kind: "pylon", x: 3, y: 4, dir: 0 });
    expect(listed(y, 1)).toEqual([]);
  });

  test("the yard is looked at once for each second of its clock, and when what stands has changed", () => {
    const y = yard();
    must(y, { do: "build", kind: "boiler", x: 9, y: 7, dir: 0 });
    const turn = troubled(y, 0).turn;
    // The same second, asked again and again: nothing is looked at.
    for (let k = 0; k < 5; k++) expect(troubled(y, 0).turn).toBe(turn);
    while (y.tick % 10 !== 9) step(y);
    expect(troubled(y, 0).turn).toBe(turn);
    step(y);
    expect(troubled(y, 0).turn).toBe(turn + 1);
    expect(troubled(y, 1).turn).toBe(turn + 2);
  });
});

describe("what is wrong, in groups", () => {
  test("pieces are grouped by the rules' own words for what is wrong, the largest group first, each with its kinds", () => {
    const y = yard();
    // No power: two gatherers and a mill out of reach. No fuel: a boiler. Nowhere to send: a gatherer handing to bare ground.
    must(y, { do: "build", kind: "gatherer", x: 0, y: 4, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 1, y: 4, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 1, y: 5, dir: 0 });
    must(y, { do: "build", kind: "boiler", x: 9, y: 7, dir: 0 });
    must(y, { do: "build", kind: "gatherer", x: 3, y: 6, dir: 0 });
    // The gatherer in reach gathers one thing, and has nowhere to put it.
    for (let k = 0; k < 40; k++) step(y);
    const groups = troubleGroups(y, 0);
    expect(groups.map((g) => [g.title, g.tiles.length])).toEqual([
      ["No power here", 3],
      ["Nowhere to send its deadfall", 1],
      ["Out of fuel", 1],
    ]);
    expect(groups[0]?.kinds.length).toBe(2);
    // The list's pieces are the count's.
    expect(groups.reduce((n, g) => n + g.tiles.length, 0)).toBe(troubled(y, 0).count);
  });

  test("a bench full of one part and waiting for another is a group by both; with a line to send to, a gatherer is in no group", () => {
    const y = yard();
    must(y, { do: "build", kind: "gatherer", x: 3, y: 4, dir: 0 });
    lay(y, [4, 4], y.land.depot);
    must(y, { do: "build", kind: "bench", x: 9, y: 7, dir: 0 });
    must(y, { do: "recipe", x: 9, y: 7, item: "tool" });
    const row = y.row[at(y, 9, 7)] ?? -1;
    for (let n = 0; n < 4; n++) put(y.holders, row, item("plank"));
    for (let k = 0; k < 40; k++) step(y);
    expect(troubleGroups(y, 0).map((g) => g.title)).toEqual(["Full of planks and waiting for ingots"]);
  });
});
