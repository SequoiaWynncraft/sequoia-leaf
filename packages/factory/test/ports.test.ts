/**
 * Which sides a piece takes things in by is one answer (`takes`, from `sidesTaken`), read alike by
 * the plumbing, the tick, a piece's status and the two-tap router. Whether it takes a particular
 * thing (`wants`) and whether it has room for it this tick are asked after that, and apart: a full
 * belt still takes from the side it did, so a run of belt is never laid round one that is busy.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

const yard = (): F.Yard => F.create({ land: bareLand(15, 9, [], [12, 4]), tier: 4, seed: 1 });
const deadfall = F.item("deadfall");
const plank = F.item("plank");

describe("a run of belt laid with two taps", () => {
  test("from the tile ahead of a mill into the mill is one belt facing it, as the mill takes things from that side", () => {
    const y = yard();
    must(y, { do: "build", kind: "mill", x: 4, y: 4, dir: 0 });
    expect(F.takes(y, F.at(y, 4, 4), F.at(y, 5, 4))).toBe(true);
    expect(F.route(y, [5, 4], [4, 4])).toEqual([{ tunnel: false, x: 5, y: 4, dir: 2, grade: 1 }]);
  });

  test("into a mill from further off leaves the tile ahead of it free, so what it makes still has a way out", () => {
    const y = yard();
    must(y, { do: "build", kind: "mill", x: 7, y: 4, dir: 0 });
    must(y, { do: "recipe", x: 7, y: 4, item: "plank" });
    expect(F.litOf(y)[F.at(y, 7, 4)]).toBe(1);
    const legs = F.route(y, [9, 4], [7, 4]);
    if (!legs) throw new Error("no way");
    expect(legs.some((l) => l.x === 8 && l.y === 4)).toBe(false);
    // Laid, with a belt from the mill's front to a crate, the deadfall fed in comes out as planks.
    must(y, F.writeAct({ do: "lay", legs }));
    must(y, { do: "build", kind: "crate", x: 10, y: 4, dir: 2 });
    must(y, { do: "build", kind: "belt", x: 8, y: 4, dir: 3 });
    must(y, { do: "build", kind: "crate", x: 8, y: 3, dir: 3 });
    const [from, to] = [y.row[F.at(y, 10, 4)] ?? -1, y.row[F.at(y, 8, 3)] ?? -1];
    for (let k = 0; k < 4; k++) F.put(y.holders, from, deadfall);
    for (let k = 0; k < 2000; k++) F.step(y);
    expect([F.held(y.holders, from, deadfall), F.held(y.holders, to, deadfall)]).toEqual([0, 0]);
    expect(F.held(y.holders, to, plank)).toBeGreaterThan(0);
  });

  test("into a mill whose other sides are all taken ends on the tile ahead of it, as that is the only way in", () => {
    const y = yard();
    must(y, { do: "build", kind: "mill", x: 4, y: 4, dir: 0 });
    for (const [x, z] of [
      [3, 4],
      [4, 3],
      [4, 5],
    ] as const)
      must(y, { do: "build", kind: "crate", x, y: z, dir: 0 });
    expect(F.route(y, [7, 4], [4, 4])?.at(-1)).toMatchObject({ x: 5, y: 4, dir: 2 });
  });

  test("from the tile ahead of a boiler into the boiler is one belt facing it", () => {
    const y = yard();
    must(y, { do: "build", kind: "boiler", x: 4, y: 7, dir: 0 });
    expect(F.route(y, [5, 7], [4, 7])).toEqual([{ tunnel: false, x: 5, y: 7, dir: 2, grade: 1 }]);
  });

  test("into a belt that is full ends where it would into an empty one", () => {
    const y = yard();
    must(y, { do: "build", kind: "belt", x: 4, y: 4, dir: 0 });
    const empty = F.route(y, [4, 1], [4, 4]);
    y.item[F.at(y, 4, 4)] = plank;
    expect(F.route(y, [4, 1], [4, 4])).toEqual(empty);
    expect(empty?.at(-1)).toMatchObject({ x: 4, y: 3, dir: 1 });
  });
});

describe("the side ahead of a mill", () => {
  test("takes what a belt laid by the router brings it: the mill makes of it, and the belt is not stuck", () => {
    const y = yard();
    must(y, { do: "build", kind: "mill", x: 7, y: 4, dir: 0 });
    must(y, { do: "recipe", x: 7, y: 4, item: "plank" });
    expect(F.litOf(y)[F.at(y, 7, 4)]).toBe(1);
    const legs = F.route(y, [8, 4], [7, 4]);
    if (!legs) throw new Error("no way");
    must(y, F.writeAct({ do: "lay", legs }));
    // A crate behind the belt lets deadfall out onto it.
    must(y, { do: "build", kind: "crate", x: 9, y: 4, dir: 2 });
    const crate = y.row[F.at(y, 9, 4)] ?? -1;
    for (let k = 0; k < 3; k++) F.put(y.holders, crate, deadfall);
    for (let k = 0; k < 300; k++) F.step(y);
    expect(F.held(y.holders, crate, deadfall)).toBe(0);
    expect(F.status(y, F.at(y, 8, 4))?.trouble).not.toBe(true);
  });

  test("takes in a tick what a belt facing its front holds, and the belt is not in trouble", () => {
    const y = yard();
    must(y, { do: "build", kind: "mill", x: 7, y: 4, dir: 0 });
    // A belt with deadfall on it, at the end of its tile, facing into the mill's front.
    must(y, { do: "build", kind: "belt", x: 8, y: 4, dir: 2 });
    const belt = F.at(y, 8, 4);
    y.item[belt] = deadfall;
    y.prog[belt] = 8;
    expect(F.status(y, belt)?.trouble).not.toBe(true);
    F.step(y);
    expect(y.item[belt]).toBe(F.NONE);
  });
});

describe("what a piece takes, apart from the side", () => {
  test("a mill wants only the parts of what it may make, as it is told; a boiler deadfall; a belt anything", () => {
    const y = yard();
    must(y, { do: "build", kind: "mill", x: 4, y: 4, dir: 0 });
    must(y, { do: "build", kind: "boiler", x: 6, y: 4, dir: 0 });
    must(y, { do: "build", kind: "belt", x: 8, y: 4, dir: 0 });
    const [mill, boiler, belt] = [F.at(y, 4, 4), F.at(y, 6, 4), F.at(y, 8, 4)];
    expect([F.wants(y, mill, deadfall), F.wants(y, mill, plank)]).toEqual([true, false]);
    expect([F.wants(y, boiler, deadfall), F.wants(y, boiler, plank)]).toEqual([true, false]);
    expect([F.wants(y, belt, deadfall), F.wants(y, belt, plank)]).toEqual([true, true]);
    // Told to make planks, it wants deadfall and no longer stone.
    const stone = F.item("stone");
    expect(F.wants(y, mill, stone)).toBe(true);
    must(y, { do: "recipe", x: 4, y: 4, item: "plank" });
    expect([F.wants(y, mill, deadfall), F.wants(y, mill, stone)]).toEqual([true, false]);
  });
});

/** Whether a kind has a way out that sends a by-product. */
const sendsAlso = (k: number): boolean => F.FACING[k]?.[0]?.outs.some((o) => o.also) ?? false;

describe("ways out as data", () => {
  test("a recipe that makes a by-product is made only by a kind with a way out for it, so it can always leave", () => {
    expect(F.RECIPES_N.filter((r) => r.also !== F.NONE && !sendsAlso(r.by)).map((r) => F.ITEMS[r.out])).toEqual([]);
  });

  test("the depot is one piece of three by three, set down with the yard, taking things in on all twelve sides round it", () => {
    const y = yard();
    const [cx, cy] = y.land.depot;
    const own = F.at(y, cx, cy);
    let round = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const t = F.at(y, cx + dx, cy + dy);
        expect([F.pieceOf(y, t), y.kind[t]]).toEqual([own, F.DEPOT]);
        for (let way = 0; way < 4; way++) {
          const from = F.at(y, cx + dx + (F.DX[way] ?? 0), cy + dy + (F.DY[way] ?? 0));
          if (y.kind[from] !== F.DEPOT && F.takes(y, t, from)) round++;
        }
      }
    expect(round).toBe(12);
  });
});
