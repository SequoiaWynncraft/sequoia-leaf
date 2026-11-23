import { describe, expect, test } from "bun:test";

import { at, BELT, create, item, NONE, step, type Yard } from "@sequoia-leaf/factory";
import { bareLand } from "@sequoia-leaf/factory/test/land.ts";
import { lay, must } from "@sequoia-leaf/factory/test/yards.ts";

import { carriedAt } from "./plan.ts";

const plank = item("plank");

/** A yard with deadfall at (2, 4): a gatherer there, a mill beside it, and a line of belt from (4, 4) to the depot at (12, 4). */
function sawmill(): Yard {
  const y = create({ land: bareLand(18, 9, [[2, 4, "deadfall"]], [12, 4]), tier: 4, seed: 1 });
  must(y, { do: "build", kind: "pylon", x: 6, y: 6, dir: 0 });
  must(y, { do: "build", kind: "gatherer", x: 2, y: 4, dir: 0 });
  must(y, { do: "build", kind: "mill", x: 3, y: 4, dir: 0 });
  lay(y, [4, 4], y.land.depot);
  return y;
}
/** The tiles of the line, from the mill to the depot. */
const line = (y: Yard): number[] => {
  const tiles: number[] = [];
  for (let x = 4; x < 12; x++) if (y.kind[at(y, x, 4)] === BELT) tiles.push(at(y, x, 4));
  return tiles;
};
/** Runs a yard on so many ticks, looking at it after each as a plan on screen does. */
function watch(y: Yard, ticks: number): void {
  for (let k = 0; k < ticks; k++) {
    step(y);
    carriedAt(y, 0);
  }
}

describe("what a plan's lines carry", () => {
  test("a line is the thing it carries along its whole length, though most of its tiles are empty at any moment", () => {
    const y = sawmill();
    const tiles = line(y);
    expect(tiles.length).toBeGreaterThan(5);
    // Nothing has been carried yet: wood.
    expect(tiles.map((i) => carriedAt(y, i))).toEqual(tiles.map(() => NONE));
    watch(y, 300);
    // One plank every second and a half, four ticks to a tile: most tiles hold nothing now.
    expect(tiles.filter((i) => y.item[i] === NONE).length).toBeGreaterThan(tiles.length / 2);
    expect(tiles.map((i) => carriedAt(y, i))).toEqual(tiles.map(() => plank));
  });

  test("the first plank seen colours the line ahead of it at once, down to where things are handed on", () => {
    const y = sawmill();
    const tiles = line(y);
    // Until the first plank is on the first belt.
    for (let k = 0; k < 200 && y.item[tiles[0] ?? 0] === NONE; k++) step(y);
    expect(y.item[tiles[0] ?? 0]).toBe(plank);
    // One look: every belt after it is taken to carry the same.
    expect(tiles.map((i) => carriedAt(y, i))).toEqual(tiles.map(() => plank));
  });

  test("a line that has carried nothing for a minute is wood again", () => {
    const y = sawmill();
    const tiles = line(y);
    watch(y, 300);
    must(y, { do: "remove", x: 2, y: 4 });
    // What the mill held is sawn and carried off; then a minute with nothing on the line.
    watch(y, 400);
    expect(tiles.map((i) => carriedAt(y, i))).toEqual(tiles.map(() => plank));
    watch(y, 500);
    expect(tiles.map((i) => carriedAt(y, i))).toEqual(tiles.map(() => NONE));
  });

  test("a tile that carries no longer keeps nothing of what it carried", () => {
    const y = sawmill();
    const tiles = line(y);
    watch(y, 300);
    const gone = tiles[2] ?? 0;
    must(y, { do: "remove", x: gone % y.land.w, y: Math.floor(gone / y.land.w) });
    expect(carriedAt(y, gone)).toBe(NONE);
  });
});
