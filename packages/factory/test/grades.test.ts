/**
 * Grades, kept on the piece: each belt, splitter, joiner and sorter carries at its own pace and each
 * machine works at its own, drawing power by its grade; a higher grade built over one of the same
 * kind raises it where it stands, a lower one lowers it, each for the difference; an area is raised
 * all at once; a piece moved, copied or kept in a blueprint keeps its grade. A splitter's, joiner's
 * and sorter's grades open with the belt's.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { fill } from "./goals.ts";
import { bareLand } from "./land.ts";
import { flatOut, give, must } from "./yards.ts";

/** A yard of every goal of the slice done, on a bare land of 13 by 9 with deadfall at (5, 4), and nothing to hand. */
function yard(tier = 4): F.Yard {
  const y = F.create({ land: bareLand(13, 9, [[5, 4, "deadfall"]], [9, 4]), tier, seed: 1 });
  y.spare.fill(0);
  return y;
}

/** The Coins a command took from the purse, or gave back. */
function spent(y: F.Yard, c: Record<string, unknown>): number {
  const did = give(y, c);
  if ("refused" in did) throw new Error(`${String(c.do)} was refused: ${did.why}`);
  return (did.coins ?? []).reduce((sum, ch) => sum + (ch.reason === "Earned in the Works" ? 0 : -ch.amount), 0);
}

/** How many ticks a thing takes across a piece of a kind at a grade, between two belts. */
function across(kind: F.Kind, grade: number): number {
  const y = yard();
  for (let x = 3; x <= 5; x++) expect(F.build(y, x === 4 ? kind : F.BELT, x, 2, 0, Infinity).ok).toBe(true);
  const i = F.at(y, 4, 2);
  y.grade[i] = F.gradeOf(kind, grade);
  y.item[i] = F.item("plank");
  F.rewire(y);
  let t = 0;
  for (; y.item[i] !== F.NONE && t < 20; t++) F.step(y);
  return t;
}

/** How often a gatherer of a grade gathers, in ticks, and the power it draws, in halves. */
function gathering(grade: number): { every: number; demand: number } {
  const y = yard();
  must(y, { do: "build", kind: "gatherer", x: 5, y: 4, dir: 2, grade });
  must(y, { do: "build", kind: "crate", x: 4, y: 4, dir: 2 });
  must(y, { do: "crate", x: 4, y: 4, open: false });
  F.rewire(y);
  for (let k = 0; k < 600; k++) F.step(y);
  const crate = y.row[F.at(y, 4, 4)] ?? -1;
  return { every: 600 / F.held(y.holders, crate, F.item("deadfall")), demand: y.demand };
}

/** A run naming both mouths of the tunnel from (1, 7) to (3, 7), the far one at a grade. */
const mouths = (grade: number): Record<string, unknown>[] => [
  { kind: "tunnel", x: 1, y: 7, dir: 0, span: 0, grade: 3 },
  { kind: "tunnel", x: 3, y: 7, dir: 0, span: 0, grade },
];

/** A run of three belts at a grade. */
const legs = (grade: number): Record<string, unknown>[] =>
  [3, 4, 5].map((x) => ({ kind: "belt", x, y: 2, dir: 0, span: 0, grade }));

describe("pace", () => {
  test("a belt, splitter, joiner or sorter carries a thing across its tile in 4, 3 or 2 ticks by its grade", () => {
    for (const k of [F.BELT, F.SPLITTER, F.JOINER, F.SORTER])
      expect([1, 2, 3].map((g) => across(k, g))).toEqual([4, 3, 2]);
  });

  test("a gatherer or machine of grade 2 works 1.5 times as fast and draws 1.5 times the power", () => {
    expect(gathering(1)).toEqual({ every: 15, demand: 2 });
    expect(gathering(2)).toEqual({ every: 10, demand: 3 });
  });
});

describe("building over a piece of the same kind", () => {
  test("a higher grade raises it where it stands, keeps what it carries and its colour, and charges the difference; a lower gives it back; removing gives back what it cost at its grade", () => {
    const y = yard();
    expect(spent(y, { do: "build", kind: "belt", x: 4, y: 2, dir: 0 })).toBe(1);
    const i = F.at(y, 4, 2);
    must(y, { do: "paint", x: 4, y: 2, tint: 3 });
    y.item[i] = F.item("plank");
    expect(spent(y, { do: "build", kind: "belt", x: 4, y: 2, dir: 1, grade: 2 })).toBe(2);
    expect([y.grade[i], y.dir[i], y.tint[i], y.item[i]]).toEqual([2, 1, 3, F.item("plank")]);
    expect(spent(y, { do: "build", kind: "belt", x: 4, y: 2, dir: 1, grade: 1 })).toBe(-2);
    expect(spent(y, { do: "build", kind: "belt", x: 4, y: 2, dir: 1, grade: 2 })).toBe(2);
    expect(spent(y, { do: "remove", x: 4, y: 2 })).toBe(-3);
  });

  test("a machine raised keeps what it holds and what it is told to make", () => {
    const y = yard();
    must(y, { do: "build", kind: "mill", x: 5, y: 6, dir: 0 });
    must(y, { do: "recipe", x: 5, y: 6, item: "plank" });
    const r = y.row[F.at(y, 5, 6)] ?? -1;
    F.put(y.holders, r, F.item("deadfall"));
    expect(spent(y, { do: "build", kind: "mill", x: 5, y: 6, dir: 0, grade: 2 })).toBe(40);
    const i = F.at(y, 5, 6);
    expect([y.grade[i], y.set[i], F.held(y.holders, y.row[i] ?? -1, F.item("deadfall"))]).toEqual([
      2,
      F.item("plank"),
      1,
    ]);
  });

  test("the pieces a new yard has to hand are grade 1: one raised costs the difference, and gives that back when removed", () => {
    const y = F.create({ land: bareLand(13, 9, [[5, 4, "deadfall"]], [9, 4]), tier: 3, seed: 1 });
    expect(spent(y, { do: "build", kind: "gatherer", x: 5, y: 4, dir: 0 })).toBe(0);
    expect(y.grade[F.at(y, 5, 4)]).toBe(1);
    expect(spent(y, { do: "build", kind: "gatherer", x: 5, y: 4, dir: 0, grade: 2 })).toBe(20);
    expect(spent(y, { do: "remove", x: 5, y: 4 })).toBe(-20);
    expect(y.spare[F.GATHERER]).toBe(1);
  });

  test("a grade not unlocked is refused, and says which; a run laid along belts raises or lowers them", () => {
    const y = yard(3);
    expect(give(y, { do: "build", kind: "mill", x: 5, y: 6, dir: 0, grade: 2 })).toMatchObject({
      refused: "cannot_build",
      why: "A grade 2 mill is not unlocked yet",
    });
    expect(spent(y, { do: "lay", legs: legs(1) })).toBe(3);
    expect(spent(y, { do: "lay", legs: legs(2) })).toBe(6);
    expect([3, 4, 5].map((x) => y.grade[F.at(y, x, 2)])).toEqual([2, 2, 2]);
    expect(spent(y, { do: "lay", legs: legs(1).slice(1) })).toBe(-4);
    expect([3, 4, 5].map((x) => y.grade[F.at(y, x, 2)])).toEqual([2, 1, 1]);
  });

  test("a run that names the same tunnel twice, by both its mouths, is refused before anything changes; a run is charged its price", () => {
    const y = yard();
    must(y, { do: "build", kind: "tunnel", x: 1, y: 7, dir: 0 });
    const kept = F.encode(y);
    expect(give(y, { do: "lay", legs: mouths(2) })).toMatchObject({ refused: "cannot_lay" });
    expect(F.encode(y)).toBe(kept);
    // Raised by its far mouth alone, with a belt laid on beyond it.
    const run = [mouths(2)[1] ?? {}, { kind: "belt", x: 4, y: 7, dir: 0, span: 0 }];
    const read = F.readCommand({ do: "lay", legs: run, tick: y.tick });
    if (read?.do !== "lay") throw new Error("the run does not read");
    expect(F.priceOf(y, read.legs.map(F.legPiece))).toBe(24 + 1);
    expect(spent(y, { do: "lay", legs: run })).toBe(24 + 1);
    expect([y.grade[F.at(y, 1, 7)], y.grade[F.at(y, 3, 7)]]).toEqual([2, 2]);
  });

  test("a tunnel is raised and lowered with both its mouths", () => {
    const y = yard();
    must(y, { do: "build", kind: "tunnel", x: 1, y: 7, dir: 0 });
    const far = y.kind.findIndex((k, i) => k === F.TUNNEL && (y.span[i] ?? 0) < 0);
    expect(spent(y, { do: "build", kind: "tunnel", x: 1, y: 7, dir: 0, grade: 2 })).toBe(24);
    expect([y.grade[F.at(y, 1, 7)], y.grade[far]]).toEqual([2, 2]);
    expect(give(y, { do: "build", kind: "tunnel", x: 1, y: 7, dir: 0, grade: 2 })).toMatchObject({
      refused: "cannot_build",
    });
  });
});

describe("raising an area", () => {
  test("raises every piece that can be raised to the highest grade the yard may build, all or none, at the price it says first", () => {
    const y = yard();
    for (let x = 3; x <= 6; x++) must(y, { do: "build", kind: "belt", x, y: 2, dir: 0 });
    must(y, { do: "build", kind: "belt", x: 7, y: 2, dir: 0, grade: 2 });
    must(y, { do: "build", kind: "crate", x: 8, y: 2, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 5, y: 6, dir: 0 });
    const tiles = F.within(y, 3, 2, 8, 6);
    // Four belts from 1 to 3 Coins, and a mill from 20 to 60; a crate and a belt at grade 2 already stay.
    expect(F.upgradePrice(y, tiles)).toBe(4 * 2 + 40);
    expect(F.upgradeRefusal(y, tiles, 47)).toBe("Not enough Coins: 1 short");
    expect(F.upgrade(y, tiles, 47)).toEqual({ ok: false, why: "Not enough Coins: 1 short" });
    expect([3, 4, 5, 6].map((x) => y.grade[F.at(y, x, 2)])).toEqual([1, 1, 1, 1]);
    expect(spent(y, { do: "upgrade", tiles })).toBe(48);
    expect([3, 4, 5, 6, 7, 8].map((x) => y.grade[F.at(y, x, 2)])).toEqual([2, 2, 2, 2, 2, 0]);
    expect(y.grade[F.at(y, 5, 6)]).toBe(2);
    expect(give(y, { do: "upgrade", tiles })).toMatchObject({
      refused: "cannot_upgrade",
      why: "Nothing here can be raised",
    });
    // Before "Upgrading an area" is known, the command is the tool's to refuse.
    expect(give(yard(3), { do: "upgrade", tiles: [] })).toMatchObject({ refused: F.LOCKED });
  });
});

describe("keeping a grade", () => {
  test("a piece moved, copied, kept in a blueprint or read back keeps its grade; a blueprint set down where its grade is not unlocked is refused", () => {
    const y = yard();
    must(y, { do: "build", kind: "mill", x: 5, y: 6, dir: 0, grade: 2 });
    must(y, { do: "move", tiles: [F.at(y, 5, 6)], turns: 0, x: 6, y: 6 });
    expect(y.grade[F.at(y, 6, 6)]).toBe(2);
    must(y, { do: "saveBlueprint", slot: 0, tiles: [F.at(y, 6, 6)] });
    const print = F.piecesOf(y.blueprints[0]?.pieces ?? new Uint8Array());
    expect(print.map((p) => p.grade)).toEqual([2]);
    const pieces = F.placed(print, 0, 3, 6).map((p) => Object.assign({}, p, { kind: F.kindName(p.kind) }));
    must(y, { do: "stand", pieces });
    expect(y.grade[F.at(y, 3, 6)]).toBe(2);
    const back = F.decode(F.encode(y), y.land);
    expect(back && [back.grade[F.at(back, 3, 6)], back.grade[F.at(back, 6, 6)]]).toEqual([2, 2]);
    expect(back && F.piecesOf(back.blueprints[0]?.pieces ?? new Uint8Array()).map((p) => p.grade)).toEqual([2]);
    expect(give(yard(3), { do: "stand", pieces })).toMatchObject({
      refused: "cannot_stand",
      why: "A grade 2 mill is not unlocked yet",
    });
  });
});

/** Finishes nodes of the tier open by delivering what each wants, as play would. */
function finish(y: F.Yard, ...nodes: string[]): F.Yard {
  for (const node of nodes) {
    must(y, { do: "take", node });
    fill(y);
  }
  return y;
}

/** A yard of every goal below tier 4 done and the brass fittings, so grade III belts, splitters, joiners and sorters, on a bare land. */
const brass = (land = bareLand(13, 9, [[5, 4, "deadfall"]], [9, 4])): F.Yard =>
  finish(F.create({ land, tier: 4, seed: 1 }), "brassfittings", "flags");

const SPLITS = ["splitter", "joiner", "sorter"] as const;

/** Things a minute into the depot along a line of grade III belt from a crate kept full, with a piece of a kind at a grade in its middle. */
function through(kind: (typeof SPLITS)[number] | "belt", grade: number): number {
  const y = brass(bareLand(13, 9, [], [9, 4]));
  must(y, { do: "build", kind: "crate", x: 1, y: 4, dir: 0 });
  for (let x = 2; x <= 7; x++)
    must(
      y,
      x === 4
        ? { do: "build", kind, x, y: 4, dir: 0, grade }
        : { do: "build", kind: "belt", x, y: 4, dir: 0, grade: 3 },
    );
  return flatOut(y, 1, 4);
}

describe("splitters, joiners and sorters", () => {
  test("one of grade I on a line of grade III belt passes things on at grade I's pace, and one of grade III at grade III's", () => {
    expect(through("belt", 3)).toBe(F.carried(3));
    for (const kind of SPLITS) expect([1, 2, 3].map((g) => through(kind, g))).toEqual([1, 2, 3].map(F.carried));
    expect(F.carried(1)).toBeLessThan(F.carried(3));
  });

  test("their grades open with the belt's, as the tables say, and a grade opens a kind only once it is unlocked", () => {
    for (const g of F.ALL_GOALS) {
      const grades = F.GOALS[g]?.unlocks.grades ?? {};
      for (const kind of SPLITS) expect([F.GOALS[g]?.id, grades[kind]]).toEqual([F.GOALS[g]?.id, grades.belt]);
    }
    // At every goal done, in an order play could do them all, each stands as high as the belt once it is unlocked.
    const order = F.goalsBelow(F.TIERS.length + 1);
    expect(order.length).toBe(F.ALL_GOALS.length);
    for (let n = 0; n <= order.length; n++) {
      const open = F.openOf(order.slice(0, n));
      for (const kind of SPLITS) {
        const k = F.kind(kind);
        if ((open.kinds[k] ?? 0) > 0) expect(F.highest(open, k)).toBe(F.highest(open, F.BELT));
      }
    }
    // The wax grades the belt before the sorter is known: the sorter is not open until it is, then at grade II.
    const tier2 = F.goalsBelow(3);
    expect(tier2).toContain(F.goal("wax"));
    expect(F.highest(F.openOf(tier2), F.BELT)).toBe(2);
    expect(F.highest(F.openOf(tier2), F.SORTER)).toBe(0);
    expect(F.highest(F.openOf([...tier2, F.goal("sorter")]), F.SORTER)).toBe(2);
    expect(F.highest(F.openOf(tier2), F.SPLITTER)).toBe(2);
    expect(F.highest(F.openOf(F.goalsBelow(2)), F.SPLITTER)).toBe(1);
  });

  test("each costs its grade's price, 1, 3 and 8 times the first's, gives that back when removed, and a grade not open is refused", () => {
    const y = brass();
    for (const kind of SPLITS)
      [1, 2, 3].forEach((grade, n) => {
        const cost = F.price(F.kind(kind), 1) * ([1, 3, 8][n] ?? 0);
        expect(F.price(F.kind(kind), grade)).toBe(cost);
        expect(spent(y, { do: "build", kind, x: 2 + n * 2, y: 2, dir: 0, grade })).toBe(cost);
        expect(spent(y, { do: "remove", x: 2 + n * 2, y: 2 })).toBe(-cost);
      });
    expect(give(yard(), { do: "build", kind: "splitter", x: 2, y: 2, dir: 0, grade: 3 })).toMatchObject({
      refused: "cannot_build",
      why: "A grade 3 splitter is not unlocked yet",
    });
  });

  test("one raised where it stands keeps what it carries, its colour, its ways, the way it puts first, its turn and what a sorter is set to, for the difference", () => {
    const y = brass();
    for (let x = 1; x <= 3; x++) must(y, { do: "build", kind: "belt", x, y: 2, dir: 0 });
    must(y, { do: "build", kind: "splitter", x: 2, y: 2, dir: 0 });
    must(y, { do: "build", kind: "sorter", x: 2, y: 6, dir: 0 });
    must(y, { do: "build", kind: "joiner", x: 6, y: 6, dir: 0 });
    must(y, { do: "paint", x: 2, y: 2, tint: 4 });
    must(y, { do: "way", x: 2, y: 2, way: 1, open: false });
    must(y, { do: "first", x: 2, y: 2, way: 2 });
    must(y, { do: "sort", x: 2, y: 6, item: "plank" });
    const i = F.at(y, 2, 2);
    y.item[i] = F.item("plank");
    y.turn[i] = 2;
    y.turn[F.at(y, 6, 6)] = 1;
    const parts = (t: number): number[] =>
      [y.tint[t], y.shut[t], y.first[t], y.turn[t], y.item[t], y.set[t]].map((v) => v ?? 0);
    const was = [i, F.at(y, 2, 6), F.at(y, 6, 6)].map(parts);
    expect(spent(y, { do: "build", kind: "splitter", x: 2, y: 2, dir: 0, grade: 3 })).toBe(64 - 8);
    expect(spent(y, { do: "build", kind: "sorter", x: 2, y: 6, dir: 0, grade: 2 })).toBe(36 - 12);
    expect(spent(y, { do: "build", kind: "joiner", x: 6, y: 6, dir: 0, grade: 2 })).toBe(24 - 8);
    expect([i, F.at(y, 2, 6), F.at(y, 6, 6)].map((t) => y.grade[t])).toEqual([3, 2, 2]);
    expect([i, F.at(y, 2, 6), F.at(y, 6, 6)].map(parts)).toEqual(was);
    expect(spent(y, { do: "build", kind: "splitter", x: 2, y: 2, dir: 0, grade: 1 })).toBe(-(64 - 8));
  });

  test("an area raised raises them with the belts, to the highest grade the yard may build", () => {
    const y = brass();
    for (let x = 1; x <= 6; x++)
      must(y, {
        do: "build",
        kind: x === 3 ? "splitter" : x === 4 ? "sorter" : x === 5 ? "joiner" : "belt",
        x,
        y: 2,
        dir: 0,
      });
    const tiles = F.within(y, 1, 2, 6, 2);
    expect(F.upgradePrice(y, tiles)).toBe(3 * (8 - 1) + (64 - 8) * 2 + (96 - 12));
    must(y, { do: "upgrade", tiles });
    expect([1, 2, 3, 4, 5, 6].map((x) => y.grade[F.at(y, x, 2)])).toEqual([3, 3, 3, 3, 3, 3]);
  });

  test("one moved, copied, kept in a blueprint, set down from it and read back keeps its grade; the check changes with its grade", () => {
    const y = brass();
    must(y, { do: "build", kind: "splitter", x: 2, y: 2, dir: 0, grade: 2 });
    must(y, { do: "build", kind: "sorter", x: 3, y: 2, dir: 0, grade: 3 });
    must(y, { do: "build", kind: "joiner", x: 4, y: 2, dir: 0, grade: 2 });
    const grades = (z: number, x0 = 2): number[] => [0, 1, 2].map((d) => y.grade[F.at(y, x0 + d, z)] ?? 0);
    must(y, { do: "move", tiles: F.within(y, 2, 2, 4, 2), turns: 0, x: 2, y: 1 });
    expect(grades(1)).toEqual([2, 3, 2]);
    must(y, { do: "copy", tiles: F.within(y, 2, 1, 4, 1), turns: 0, x: 2, y: 6 });
    expect(grades(6)).toEqual([2, 3, 2]);
    must(y, { do: "saveBlueprint", slot: 0, tiles: F.within(y, 2, 1, 4, 1) });
    expect(F.piecesOf(y.blueprints[0]?.pieces ?? new Uint8Array()).map((p) => p.grade)).toEqual([2, 3, 2]);
    must(y, { do: "placeBlueprint", slot: 0, turns: 0, x: 2, y: 7 });
    expect(grades(7)).toEqual([2, 3, 2]);
    const back = F.decode(F.encode(y), y.land);
    expect(back && [1, 6, 7].flatMap((z) => [0, 1, 2].map((d) => back.grade[F.at(back, 2 + d, z)]))).toEqual([
      2, 3, 2, 2, 3, 2, 2, 3, 2,
    ]);
    expect(back && F.piecesOf(back.blueprints[0]?.pieces ?? new Uint8Array()).map((p) => p.grade)).toEqual([2, 3, 2]);
    expect(back && F.check(back)).toBe(F.check(y));
    const before = F.check(y);
    must(y, { do: "build", kind: "splitter", x: 2, y: 1, dir: 0, grade: 3 });
    expect(F.check(y)).not.toBe(before);
  });
});
