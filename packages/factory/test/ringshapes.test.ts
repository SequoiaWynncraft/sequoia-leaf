/**
 * Lines that run into rings, as a grower's status judges them from what the yard holds now
 * (`kinds/say.ts`), and the rings the plumbing names (`ringsOf`), shapes from tier 7's reviews: a loop
 * only an unset sorter's side closes; a full ring with an unset or a set sorter and a crate beside it,
 * with a drain into a full shut crate, with an open crate on it; a junction just before a ring; a
 * tunnel on the line, flowing or into a stopped ring.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bare, drain, fill, PLANK, ring, sending } from "./ringyard.ts";
import { must } from "./yards.ts";

/** A grower's state and whether it is in trouble, after `ticks` ticks. */
function after(y: F.Yard, g: number, ticks = 600): [string | undefined, boolean | undefined] {
  while (y.tick < ticks) F.step(y);
  const s = F.status(y, g);
  return [s?.state, s?.trouble];
}

/** A grower at (3, 5) facing east, a belt of two from its way out to (7, 5): the grower's own tile and the belt's. */
function fed(y: F.Yard): { g: number; belt: number[] } {
  const g = sending(y, 3, 5);
  for (const x of [5, 6]) must(y, { do: "build", kind: "belt", x, y: 5, dir: 0 });
  return { g, belt: [F.at(y, 5, 5), F.at(y, 6, 5)] };
}

/** A tunnel's way-in mouth at (x, z) facing east, its far mouth 2 east: the mouth's tile, with a plank across it and under the ground. */
function fullTunnel(y: F.Yard, x: number, z: number): number {
  must(y, { do: "build", kind: "tunnel", x, y: z, dir: 0 });
  const mouth = F.at(y, x, z);
  const u = F.tunnelOf(y, mouth) * F.SPAN_MOST;
  y.tunnels.under[u] = PLANK;
  y.tunnels.along[u] = 8;
  return mouth;
}

describe("a ring", () => {
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
    expect([after(y, g), y.holders.count[crate]]).toEqual([["blocked", true], 0]);
  });

  test("whose one way off is a drain into a full shut crate: the grower is stopped", () => {
    const y = bare();
    const tiles = ring(y, 7, 2, 7, 7);
    const bin = drain(y, 10, 2, 0);
    for (let k = 0; k < y.open.crate; k++) F.put(y.holders, bin, PLANK);
    const g = sending(y, 3, 5);
    for (const x of [5, 6]) must(y, { do: "build", kind: "belt", x, y: 5, dir: 0 });
    fill(y, [...tiles, F.at(y, 10, 1), F.at(y, 5, 5), F.at(y, 6, 5)]);
    expect(after(y, g)).toEqual(["blocked", true]);
  });

  test("through a splitter or a sorter set to nothing just before the ring, only its straight way joined: the grower is stopped", () => {
    const shapes = (["splitter", "sorter"] as const).map((kind) => {
      const y = bare();
      const tiles = ring(y, 7, 2, 7, 7);
      const g = sending(y, 3, 5);
      must(y, { do: "build", kind: "belt", x: 5, y: 5, dir: 0 });
      must(y, { do: "build", kind, x: 6, y: 5, dir: 0 });
      fill(y, [...tiles, F.at(y, 5, 5), F.at(y, 6, 5)]);
      const [state, trouble] = after(y, g);
      return [kind, state, trouble];
    });
    expect(shapes).toEqual([
      ["splitter", "blocked", true],
      ["sorter", "blocked", true],
    ]);
  });
  test("with a sorter on it set to stone and an empty crate by its side: no stone is on the ring, so the grower is stopped", () => {
    const y = bare();
    const tiles = ring(y, 7, 2, 7, 7);
    must(y, { do: "remove", x: 10, y: 2 });
    must(y, { do: "build", kind: "sorter", x: 10, y: 2, dir: 0 });
    must(y, { do: "sort", x: 10, y: 2, item: "stone" });
    must(y, { do: "build", kind: "crate", x: 10, y: 1, dir: 3 });
    const { g, belt } = fed(y);
    fill(y, [...tiles, ...belt]);
    expect([F.ringsOf(y).rings, after(y, g)]).toEqual([1, ["blocked", true]]);
  });

  test("with an open crate on it that has room: the ring is not full, and the grower waits, not in trouble", () => {
    const y = bare();
    const tiles = ring(y, 7, 2, 7, 7);
    must(y, { do: "remove", x: 10, y: 2 });
    must(y, { do: "build", kind: "crate", x: 10, y: 2, dir: 0 });
    const { g, belt } = fed(y);
    fill(y, [...tiles.filter((i) => i !== F.at(y, 10, 2)), ...belt]);
    expect(after(y, g, 1)).toEqual(["waiting", false]);
  });
});

describe("a grower whose line runs through a tunnel", () => {
  test("into an open crate with room: the line flows, and the grower is not in trouble", () => {
    const y = bare();
    const g = sending(y, 3, 5);
    must(y, { do: "build", kind: "belt", x: 5, y: 5, dir: 0 });
    const mouth = fullTunnel(y, 6, 5);
    must(y, { do: "build", kind: "belt", x: 9, y: 5, dir: 0 });
    must(y, { do: "build", kind: "crate", x: 10, y: 5, dir: 0 });
    fill(y, [F.at(y, 5, 5), mouth, F.at(y, 8, 5), F.at(y, 9, 5)]);
    expect(after(y, g, 1)).toEqual(["waiting", false]);
  });

  test("into a full ring with no way off: the grower is stopped", () => {
    const y = bare();
    const tiles = ring(y, 10, 2, 7, 7);
    const g = sending(y, 3, 5);
    must(y, { do: "build", kind: "belt", x: 5, y: 5, dir: 0 });
    const mouth = fullTunnel(y, 6, 5);
    must(y, { do: "build", kind: "belt", x: 9, y: 5, dir: 0 });
    fill(y, [...tiles, F.at(y, 5, 5), mouth, F.at(y, 8, 5), F.at(y, 9, 5)]);
    expect(after(y, g)).toEqual(["blocked", true]);
  });
});
