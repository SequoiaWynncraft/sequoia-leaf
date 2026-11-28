/**
 * Rings of belts (SPEC-2 0.5, item 2): the handing order walks each tile once, so round a ring one
 * tile comes before the tile it hands to. Every yard hands on in that one order, rings or not: a full
 * ring with no way off it does not move, and every tick ends; a full ring with a way off it loses a
 * tick where the order breaks round it. A ring's own turn, so that it moves as a full belt does, is
 * later work, on its own (`works/ring-turn`). A yard with no ring hands on exactly as main did.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { bare, drain, drained, fill, ring, stock } from "./ringyard.ts";
import { must } from "./yards.ts";

/** What is on each tile and how far across it, in order. */
const where = (y: F.Yard, tiles: readonly number[]): string => tiles.map((i) => `${y.item[i]}:${y.prog[i]}`).join(" ");

describe("a ring of belts", () => {
  test("with no tile free and no way off it does not move, and every tick ends", () => {
    const y = bare();
    const tiles = ring(y, 2, 2, 11, 11);
    fill(y, tiles);
    expect(tiles.length).toBe(40);
    const was = where(y, tiles);
    for (let k = 0; k < 2000; k++) F.step(y);
    expect([y.tick, where(y, tiles)]).toEqual([2000, was]);
  });

  test("full, with a way off it, loses a tick where the order breaks round it: 120 a minute at grade I, not the belt's 150", () => {
    // What every yard's one handing order does with a ring (`tick.ts`): round a ring one tile must come
    // before the tile it hands to, so where the order breaks a full ring's thing waits a tick. A ring's
    // own turn, on `works/ring-turn`, makes this 150; that work changes this number knowingly.
    const y = bare();
    const tiles = ring(y, 2, 4, 21, 21);
    // A splitter on the ring's top row sends everything that reaches it off the ring first, north to a shut crate.
    const bin = drain(y, 8, 4, 0);
    fill(y, tiles);
    // 37 in the 18 seconds before its 80 run low: about 120 a minute, one each 5 ticks, where a belt
    // carries one each 4. Main's rules give the same, to the plank.
    expect([tiles.length, drained(y, bin, 2, 20)]).toEqual([80, 37]);
  });

  test("a yard with no ring hands on exactly as main did: lines through a splitter, a joiner, a sorter and a tunnel, belts facing, splitters side by side", () => {
    const y = F.create({ land: bareLand(40, 30, [], [35, 5]), tier: 6, seed: 1 });
    const b = (kind: string, x: number, z: number, dir: number): void => must(y, { do: "build", kind, x, y: z, dir });
    /** A crate at (x, z) facing `dir`, open and holding `n` planks, or shut. */
    const crate = (x: number, z: number, dir: number, n: number): void => {
      b("crate", x, z, dir);
      if (n > 0) stock(y, F.at(y, x, z), n);
      else must(y, { do: "crate", x, y: z, open: false });
    };
    crate(2, 2, 0, 300);
    for (let x = 3; x < 9; x++) b("belt", x, 2, 0);
    b("splitter", 9, 2, 0);
    for (let x = 10; x < 15; x++) b("belt", x, 2, 0);
    crate(15, 2, 0, 0);
    for (const [x, z, kind] of [
      [9, 3, "belt"],
      [9, 4, "belt"],
      [9, 5, "joiner"],
      [9, 6, "belt"],
    ] as const)
      b(kind, x, z, 1);
    crate(9, 7, 0, 0);
    crate(4, 5, 0, 300);
    for (const [x, kind] of [
      [5, "belt"],
      [6, "sorter"],
      [7, "belt"],
      [8, "belt"],
    ] as const)
      b(kind, x, 5, 0);
    must(y, { do: "sort", x: 6, y: 5, item: "plank" });
    b("belt", 6, 4, 3);
    crate(6, 3, 0, 0);
    b("belt", 2, 10, 0);
    b("belt", 3, 10, 2);
    crate(1, 14, 0, 300);
    b("splitter", 2, 14, 0);
    b("belt", 3, 14, 0);
    crate(4, 14, 0, 0);
    crate(3, 15, 2, 300);
    b("splitter", 2, 15, 2);
    b("belt", 1, 15, 2);
    crate(0, 15, 2, 0);
    crate(2, 20, 0, 300);
    b("belt", 3, 20, 0);
    b("tunnel", 4, 20, 0);
    b("belt", 7, 20, 0);
    crate(8, 20, 0, 0);
    fill(y, [F.at(y, 2, 10), F.at(y, 3, 10)]);
    for (let k = 0; k < 900; k++) F.step(y);
    // Each crate's count and whether it has a plank out; how far across its tile each plank on a line is; under the ground.
    const seen: string[] = [];
    for (let i = 0; i < y.kind.length; i++) {
      const r = F.holderOf(y, i);
      const at = `${i % y.land.w},${Math.floor(i / y.land.w)}`;
      if (y.kind[i] === F.NONE) continue;
      if (r >= 0) seen.push(`${at}:c${y.holders.count[r]}o${y.holders.out[r] === F.NONE ? "-" : "p"}`);
      else if (y.item[i] !== F.NONE) seen.push(`${at}:${y.prog[i]}`);
      const t = F.tunnelOf(y, i);
      for (let u = t * F.SPAN_MOST; u < t * F.SPAN_MOST + (t >= 0 ? (y.span[i] ?? 0) : 0); u++)
        seen.push(`u${y.tunnels.under[u]}:${y.tunnels.along[u]}`);
    }
    // Main's numbers (72bae7b2), the same yard run on its rules.
    const MAIN =
      "2,2:c74op 3,2:6 4,2:6 5,2:6 6,2:6 7,2:6 8,2:6 9,2:6 11,2:6 13,2:6 15,2:c107o- 6,3:c222o- 9,3:6 6,4:6 " +
      "4,5:c74op 5,5:6 6,5:6 9,5:6 9,7:c107o- 2,10:8 3,10:8 1,14:c74op 2,14:6 3,14:6 4,14:c223o- 0,15:c223o- " +
      "1,15:6 2,15:6 3,15:c74op 2,20:c74op 3,20:6 4,20:6 u6:6 6,20:6 7,20:6 8,20:c220o-";
    expect(seen.join(" ")).toEqual(MAIN);
  });
});
