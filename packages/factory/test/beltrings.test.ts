/**
 * Rings of belts (SPEC-2 0.5, item 2): the handing order walks each tile once, so round a ring one
 * tile comes before the tile it hands to. A ring takes its turn as one (`round.ts`): a full ring with
 * no way off it does not move, and every tick ends; with a way off it, it moves as one at the belt's
 * own pace, as a full belt does, whatever stands on it and wherever the order breaks round it. The
 * plumbing names the rings it has (`ringsOf`), only those things can go round, and a yard with none
 * hands on exactly as before. More rings, built at random, in `ringround.test.ts`.
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

/** Ways east, south, west and north, as tiles across and down. */
const DX = [1, 0, -1, 0];
const DZ = [0, 1, 0, -1];

/**
 * A splitter at (x, z), facing `dir`, that sends what it can to its left first, onto a belt into a
 * shut crate: the crate's row, which counts what the drain took.
 */
function drain(y: F.Yard, x: number, z: number, dir: number, grade = 1): number {
  const left = (dir + 3) & 3;
  const [bx, bz] = [x + (DX[left] ?? 0), z + (DZ[left] ?? 0)];
  const [cx, cz] = [bx + (DX[left] ?? 0), bz + (DZ[left] ?? 0)];
  must(y, { do: "build", kind: "splitter", x, y: z, dir, grade });
  must(y, { do: "build", kind: "belt", x: bx, y: bz, dir: left, grade });
  must(y, { do: "build", kind: "crate", x: cx, y: cz, dir: left });
  must(y, { do: "crate", x: cx, y: cz, open: false });
  must(y, { do: "first", x, y: z, way: 1 });
  return F.holderOf(y, F.at(y, cx, cz));
}

/** Puts `n` planks into the crate on a tile. */
function stock(y: F.Yard, i: number, n: number): void {
  for (let k = 0; k < n; k++) F.put(y.holders, F.holderOf(y, i), PLANK);
}

/** How many planks the drain's crate (its row) has taken between second `from` and second `to`. */
function drained(y: F.Yard, bin: number, from: number, to: number): number {
  while (y.tick < from * 10) F.step(y);
  const was = F.held(y.holders, bin, PLANK);
  while (y.tick < to * 10) F.step(y);
  return F.held(y.holders, bin, PLANK) - was;
}

/** Puts a plank on every tile, at the end of its tile, as a ring that has filled stands. */
function fill(y: F.Yard, tiles: readonly number[]): void {
  for (const i of tiles) {
    y.item[i] = PLANK;
    y.prog[i] = 8;
  }
  F.changed(y);
}

/** A grower's status, stopped with star crystals it cannot send on. */
const STOPPED: F.Status = {
  state: "blocked",
  trouble: true,
  line: "Stopped: its star crystals cannot leave by its middle way out. It grows nothing more until they do.",
  stuck: F.item("crystal"),
};

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

  test("a crate on the ring lets the ring move at the belt's pace, wherever the order breaks: 150 a minute at grade I (Astra's first case)", () => {
    const y = bare();
    // A ring of 40, and in its place just below its north-west corner a stocked open crate facing north.
    const tiles = ring(y, 2, 2, 11, 11);
    must(y, { do: "remove", x: 2, y: 3 });
    must(y, { do: "build", kind: "crate", x: 2, y: 3, dir: 3 });
    const crate = F.at(y, 2, 3);
    stock(y, crate, 100);
    // A splitter on the top edge sends all it can north into a shut crate.
    const bin = drain(y, 7, 2, 0);
    fill(
      y,
      tiles.filter((i) => i !== crate),
    );
    expect([F.ringsOf(y), drained(y, bin, 2, 8)]).toEqual([{ rings: 1, tiles: 40 }, 15]);
  });

  test("a ring the order breaks round in several places moves at the belt's pace: 150 a minute at grade I (Astra's second case)", () => {
    const y = bare();
    // A ring traced from (6, 6): east, south, east, north, east, south, south, south, west, west, north, west, north, north.
    const [ox, oz] = [6, 6];
    let [x, z] = [0, 0];
    for (const c of "ESENESSSWWNWNN") {
      const dir = "ESWN".indexOf(c);
      const [at, way] = [{ x: ox + x, y: oz + z }, { dir }];
      // Sorters at (1, 0) and (1, 2) send planks south and west; their straight ways out run on into the ring too.
      if (x === 1 && z === 0) {
        must(y, { do: "build", kind: "sorter", ...at, dir: 0 });
        must(y, { do: "side", ...at, right: true });
      } else if (x === 1 && z === 2) must(y, { do: "build", kind: "sorter", ...at, dir: 3 });
      else if (x !== 3 || z !== 2) must(y, { do: "build", kind: "belt", ...at, ...way });
      if (x === 1 && (z === 0 || z === 2)) must(y, { do: "sort", ...at, item: "plank" });
      x += DX[dir] ?? 0;
      z += DZ[dir] ?? 0;
    }
    // The splitter facing south at (3, 2) sends all it can east first, into a shut crate.
    const bin = drain(y, ox + 3, oz + 2, 1);
    // Fed at (0, 1) from the west, by a stocked crate.
    must(y, { do: "build", kind: "crate", x: ox - 2, y: oz + 1, dir: 0 });
    must(y, { do: "build", kind: "belt", x: ox - 1, y: oz + 1, dir: 0 });
    stock(y, F.at(y, ox - 2, oz + 1), 400);
    expect([[x, z], F.ringsOf(y), drained(y, bin, 10, 20)]).toEqual([[0, 0], { rings: 1, tiles: 14 }, 25]);
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
    expect([F.ringsOf(y), seen.join(" ")]).toEqual([{ rings: 0, tiles: 0 }, MAIN]);
  });

  test("names only rings things can go round: not two belts facing, a line into a gatherer, nor splitters beside each other", () => {
    const y = F.create({ land: bareLand(40, 30, [[20, 20, "stone"]], [35, 5]), tier: 8, seed: 1 });
    // Two belts facing each other.
    must(y, { do: "build", kind: "belt", x: 2, y: 10, dir: 0 });
    must(y, { do: "build", kind: "belt", x: 3, y: 10, dir: 2 });
    // A gatherer facing east and a belt facing back into it.
    must(y, { do: "build", kind: "gatherer", x: 20, y: 20, dir: 0 });
    must(y, { do: "build", kind: "belt", x: 21, y: 20, dir: 2 });
    // Two splitters side by side, facing apart, each a way out into the other.
    must(y, { do: "build", kind: "splitter", x: 2, y: 14, dir: 0 });
    must(y, { do: "build", kind: "splitter", x: 2, y: 15, dir: 2 });
    F.rewire(y);
    const none = [F.ringsOf(y), (y.wire?.order ?? []).every((i) => i >= 0)];
    // A ring of four belts things go round.
    for (const [bx, bz, dir] of [
      [10, 2, 0],
      [11, 2, 1],
      [11, 3, 2],
      [10, 3, 3],
    ] as const)
      must(y, { do: "build", kind: "belt", x: bx, y: bz, dir });
    expect([none, F.ringsOf(y)]).toEqual([[{ rings: 0, tiles: 0 }, true], { rings: 1, tiles: 4 }]);
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
    expect(F.status(y, g)).toEqual(STOPPED);
  });

  test("a grower whose full belt runs into a full ring with no way off it is stopped, a splitter or a sorter set to nothing on the ring or not", () => {
    const shapes = (["belt", "splitter", "sorter", "drained"] as const).map((onRing) => {
      const y = bare();
      for (const x of [31, 27, 23, 19, 15, 11, 7, 3]) must(y, { do: "build", kind: "pylon", x, y: 10, dir: 0 });
      const tiles = ring(y, 7, 2, 7, 7);
      // On the ring's top row: a splitter whose ways left and right go nowhere, or a sorter set to nothing.
      if (onRing === "sorter") must(y, { do: "remove", x: 10, y: 2 });
      if (onRing === "splitter" || onRing === "sorter") must(y, { do: "build", kind: onRing, x: 10, y: 2, dir: 0 });
      // Or a splitter there that sends what it can north into a shut crate.
      if (onRing === "drained") drain(y, 10, 2, 0);
      // A grower facing east two tiles from the ring, its way out onto a belt of two into the ring's west side.
      must(y, { do: "build", kind: "grower", x: 3, y: 5, dir: 0 });
      for (const x of [5, 6]) must(y, { do: "build", kind: "belt", x, y: 5, dir: 0 });
      fill(y, [...tiles, F.at(y, 5, 5), F.at(y, 6, 5)]);
      const g = F.at(y, 3, 5);
      y.holders.out[F.holderOf(y, g)] = F.item("crystal");
      F.changed(y);
      F.step(y);
      const s = F.status(y, g);
      return [onRing, s?.state, s?.trouble];
    });
    expect(shapes).toEqual([
      ["belt", "blocked", true],
      ["splitter", "blocked", true],
      ["sorter", "blocked", true],
      ["drained", "waiting", false],
    ]);
  });
});
