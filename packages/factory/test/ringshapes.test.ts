/**
 * Astra's shapes from tier 7's second review (`round.ts`, `rings.ts`, `kinds/say.ts`): a feeder beside
 * a sparse ring, a crate on a ring of four, a loop only an unset sorter's side closes, and growers whose
 * line runs into a full ring by an unset sorter with an empty crate beside it, through a drain into a
 * full shut crate, or through a junction just before the ring.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bare, drain, drained, fill, PLANK, ring, sending, stock } from "./ringyard.ts";
import { must } from "./yards.ts";

/** A grower's state and whether it is in trouble, 600 ticks on. */
function after600(y: F.Yard, g: number): [string | undefined, boolean | undefined] {
  while (y.tick < 600) F.step(y);
  const s = F.status(y, g);
  return [s?.state, s?.trouble];
}

describe("a ring", () => {
  test("fed from a sorter below a splitter on it, whose side faces the sorter, brings its drain the feeder's 150 a minute", () => {
    const y = bare();
    // A clockwise ring 5 by 4 from (4, 4); on its top row a splitter facing east, over a sorter facing east.
    ring(y, 4, 4, 5, 4);
    must(y, { do: "build", kind: "splitter", x: 6, y: 4, dir: 0 });
    must(y, { do: "build", kind: "sorter", x: 6, y: 5, dir: 0 });
    // The sorter is fed from a stocked crate behind it, and feeds the ring's east side by one belt.
    must(y, { do: "build", kind: "crate", x: 5, y: 5, dir: 0 });
    stock(y, F.at(y, 5, 5), 400);
    must(y, { do: "build", kind: "belt", x: 7, y: 5, dir: 0 });
    // The next tile of the ring sends everything it can east into a shut crate.
    const bin = drain(y, 8, 6, 1);
    expect([F.ringsOf(y), drained(y, bin, 10, 20)]).toEqual([{ rings: 1, tiles: 14 }, 25]);
  });

  test("of four, an empty crate in it, moves a plank a tile a tick: into the crate, not on through it", () => {
    const y = bare();
    must(y, { do: "build", kind: "crate", x: 4, y: 4, dir: 0 });
    for (const [x, z, dir] of [
      [5, 4, 1],
      [5, 5, 2],
      [4, 5, 3],
    ] as const)
      must(y, { do: "build", kind: "belt", x, y: z, dir });
    fill(y, [F.at(y, 4, 5)]);
    F.step(y);
    const crate = F.holderOf(y, F.at(y, 4, 4));
    const on = [F.at(y, 5, 4), F.at(y, 4, 5)].map((i) => y.item[i]);
    expect([F.ringsOf(y), F.held(y.holders, crate, PLANK), on]).toEqual([{ rings: 1, tiles: 4 }, 1, [F.NONE, F.NONE]]);
  });

  test("full, two crates in it, the first handing into the second, empty: the second hands on nothing it was handed in the tick", () => {
    const y = bare();
    // A ring round 6 by 5 from (4, 4), full; at its first tile an empty crate facing east, below it a crate of stone facing north into it.
    const tiles = ring(y, 4, 4, 6, 5);
    for (const [x, z, dir] of [
      [4, 4, 0],
      [4, 5, 3],
    ] as const) {
      must(y, { do: "remove", x, y: z });
      must(y, { do: "build", kind: "crate", x, y: z, dir });
    }
    const [second, first] = [F.at(y, 4, 4), F.at(y, 4, 5)];
    for (let k = 0; k < 3; k++) F.put(y.holders, F.holderOf(y, first), F.item("stone"));
    fill(
      y,
      tiles.filter((i) => i !== first && i !== second),
    );
    F.step(y);
    // The stone went into the second crate, and no further: the belt after it has moved its plank on, and
    // nothing has come out of the crate onto it.
    const after = y.item[F.at(y, 5, 4)];
    expect([F.held(y.holders, F.holderOf(y, second), F.item("stone")), after]).toEqual([1, F.NONE]);
  });

  test("closed only by a sorter's side is none while the sorter is set to nothing, as everything goes straight on", () => {
    const y = bare();
    must(y, { do: "build", kind: "sorter", x: 5, y: 5, dir: 0 });
    for (const [x, z, dir] of [
      [5, 4, 2],
      [4, 4, 1],
      [4, 5, 0],
      [6, 5, 0],
    ] as const)
      must(y, { do: "build", kind: "belt", x, y: z, dir });
    const unset = F.ringsOf(y);
    must(y, { do: "sort", x: 5, y: 5, item: "plank" });
    expect([unset, F.ringsOf(y)]).toEqual([
      { rings: 0, tiles: 0 },
      { rings: 1, tiles: 4 },
    ]);
  });
});

describe("a grower whose line runs into a full ring", () => {
  test("with a sorter set to nothing on the ring and an empty crate beside it: the crate takes nothing, and the grower is stopped", () => {
    const y = bare();
    const tiles = ring(y, 7, 2, 7, 7);
    must(y, { do: "remove", x: 10, y: 2 });
    must(y, { do: "build", kind: "sorter", x: 10, y: 2, dir: 0 });
    must(y, { do: "build", kind: "crate", x: 10, y: 1, dir: 3 });
    const g = sending(y, 3, 5);
    for (const x of [5, 6]) must(y, { do: "build", kind: "belt", x, y: 5, dir: 0 });
    fill(y, [...tiles, F.at(y, 5, 5), F.at(y, 6, 5)]);
    const crate = F.holderOf(y, F.at(y, 10, 1));
    expect([after600(y, g), y.holders.count[crate]]).toEqual([["blocked", true], 0]);
  });

  test("whose one way off is a drain into a full shut crate: the grower is stopped", () => {
    const y = bare();
    const tiles = ring(y, 7, 2, 7, 7);
    const bin = drain(y, 10, 2, 0);
    for (let k = 0; k < y.open.crate; k++) F.put(y.holders, bin, PLANK);
    const g = sending(y, 3, 5);
    for (const x of [5, 6]) must(y, { do: "build", kind: "belt", x, y: 5, dir: 0 });
    fill(y, [...tiles, F.at(y, 10, 1), F.at(y, 5, 5), F.at(y, 6, 5)]);
    expect(after600(y, g)).toEqual(["blocked", true]);
  });

  test("through a splitter or a sorter set to nothing just before the ring, only its straight way joined: the grower is stopped", () => {
    const shapes = (["splitter", "sorter"] as const).map((kind) => {
      const y = bare();
      const tiles = ring(y, 7, 2, 7, 7);
      const g = sending(y, 3, 5);
      must(y, { do: "build", kind: "belt", x: 5, y: 5, dir: 0 });
      must(y, { do: "build", kind, x: 6, y: 5, dir: 0 });
      fill(y, [...tiles, F.at(y, 5, 5), F.at(y, 6, 5)]);
      const [state, trouble] = after600(y, g);
      return [kind, state, trouble];
    });
    expect(shapes).toEqual([
      ["splitter", "blocked", true],
      ["sorter", "blocked", true],
    ]);
  });
});
