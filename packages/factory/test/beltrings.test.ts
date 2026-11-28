/**
 * Rings of belts (SPEC-2 0.5, item 2): the handing order walks each tile once, so round a ring one
 * tile comes before the tile it hands to. A full ring with no way off it does not move, and every
 * tick ends; with a way off it, it moves as one at the belt's own pace, as a full belt does
 * (`tick.ts`, a ring's tiles that waited trying once more after the rest). The plumbing names the
 * rings it has (`ringsOf`), and a yard with none hands on exactly as before.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

const PLANK = F.item("plank");

/** A bare yard with tier 7 done, the depot far to the east. */
const bare = (): F.Yard => F.create({ land: bareLand(40, 30, [], [35, 5]), tier: 8, seed: 1 });

/** A ring of belts round a box `w` by `h` with its corner at (x0, z0), clockwise from that corner: its tiles in order. */
function ring(y: F.Yard, x0: number, z0: number, w: number, h: number, grade = 1): number[] {
  const tiles: number[] = [];
  const lay = (x: number, z: number, dir: number): void => {
    must(y, { do: "build", kind: "belt", x, y: z, dir, ...(grade > 1 ? { grade } : {}) });
    tiles.push(F.at(y, x, z));
  };
  for (let x = x0; x < x0 + w - 1; x++) lay(x, z0, 0);
  for (let z = z0; z < z0 + h - 1; z++) lay(x0 + w - 1, z, 1);
  for (let x = x0 + w - 1; x > x0; x--) lay(x, z0 + h - 1, 2);
  for (let z = z0 + h - 1; z > z0; z--) lay(x0, z, 3);
  return tiles;
}

/** Puts a plank on every tile, at the end of its tile, as a ring that has filled stands. */
function fill(y: F.Yard, tiles: readonly number[]): void {
  for (const i of tiles) {
    y.item[i] = PLANK;
    y.prog[i] = 8;
  }
  F.changed(y);
}

/** What is on each tile and how far across it, in order. */
const where = (y: F.Yard, tiles: readonly number[]): string => tiles.map((i) => `${y.item[i]}:${y.prog[i]}`).join(" ");

describe("a ring of belts", () => {
  test("with no tile free and no way off it does not move, and every tick ends", () => {
    const y = bare();
    const tiles = ring(y, 2, 2, 11, 11);
    fill(y, tiles);
    expect([tiles.length, F.ringsOf(y)]).toEqual([40, { rings: 1, tiles: 40 }]);
    const was = where(y, tiles);
    for (let k = 0; k < 2000; k++) F.step(y);
    expect([y.tick, where(y, tiles)]).toEqual([2000, was]);
  });

  test("with a way off it moves as one at the belt's pace: 150, 225 and 300 a minute at grades I, II and III", () => {
    for (const grade of [1, 2, 3]) {
      const y = bare();
      const tiles = ring(y, 2, 4, 21, 21, grade);
      // A splitter on the ring's top row sends everything that reaches it off the ring first, north to a shut crate.
      must(y, { do: "build", kind: "splitter", x: 8, y: 4, dir: 0, grade });
      must(y, { do: "build", kind: "belt", x: 8, y: 3, dir: 3, grade });
      must(y, { do: "build", kind: "crate", x: 8, y: 2, dir: 0 });
      must(y, { do: "crate", x: 8, y: 2, open: false });
      must(y, { do: "first", x: 8, y: 4, way: 1 });
      fill(y, tiles);
      const bin = F.holderOf(y, F.at(y, 8, 2));
      const after = (seconds: number): number => {
        while (y.tick < seconds * 10) F.step(y);
        return F.held(y.holders, bin, PLANK);
      };
      // Six seconds once it is moving: a belt carries 8 eighths of a tile a thing, at its grade's pace a tick.
      const [from, to] = [after(2), after(8)];
      const pace = (F.MINUTE * (F.PACE[grade] ?? 0)) / 8;
      expect([grade, tiles.length, Math.abs(to - from - pace / 10) <= 1]).toEqual([grade, 80, true]);
    }
  });

  test("with one tile free turns as one at the belt's pace: every thing on it moves on a tile each 4 ticks at grade I", () => {
    const y = bare();
    const tiles = ring(y, 2, 2, 11, 11);
    fill(y, tiles.slice(1));
    // Where the free tile is every 4 ticks: the whole ring has moved on one tile, so it has too.
    const free: number[] = [];
    for (let k = 1; k <= 120; k++) {
      F.step(y);
      if (k % 4 === 0) free.push(tiles.findIndex((i) => y.item[i] === F.NONE));
    }
    expect([free, tiles.filter((i) => y.item[i] === PLANK).length]).toEqual([
      Array.from({ length: 30 }, (_, n) => n + 1),
      39,
    ]);
  });

  test("a yard of belts with no ring names none, and its tiles never try twice", () => {
    const y = bare();
    for (let x = 2; x < 20; x++) must(y, { do: "build", kind: "belt", x, y: 5, dir: 0 });
    F.rewire(y);
    expect([F.ringsOf(y), y.wire?.rings.length]).toEqual([{ rings: 0, tiles: 0 }, 0]);
  });

  test("a piece sending into a full ring with no way off it is stopped, in trouble, and its words say so", () => {
    const y = bare();
    for (const x of [31, 27, 23, 19, 15, 11, 7, 3]) must(y, { do: "build", kind: "pylon", x, y: 10, dir: 0 });
    const tiles = ring(y, 7, 2, 7, 7);
    // A grower facing east beside the ring's west side: its middle way out is onto the ring's tile (7, 5).
    must(y, { do: "build", kind: "grower", x: 5, y: 5, dir: 0 });
    fill(y, tiles);
    const g = F.at(y, 5, 5);
    const r = F.holderOf(y, g);
    y.holders.out[r] = F.item("crystal");
    F.changed(y);
    F.step(y);
    expect(F.status(y, g)).toEqual({
      state: "blocked",
      trouble: true,
      line: "Stopped: its star crystals cannot leave by its middle way out. It grows nothing more until they do.",
      stuck: F.item("crystal"),
    });
  });
});
