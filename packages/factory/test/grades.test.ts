/**
 * Grades, kept on the piece: each belt carries at its own pace and each machine works at its own,
 * drawing power by its grade; a higher grade built over one of the same kind raises it where it
 * stands, a lower one lowers it, each for the difference; an area is raised all at once; a piece
 * moved, copied or kept in a blueprint keeps its grade.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { give, must } from "./yards.ts";

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
  for (let x = 3; x <= 5; x++) expect(F.build(y, F.BELT, x, 2, 0, Infinity).ok).toBe(true);
  expect(F.build(y, kind, 4, 2, 0, Infinity).ok).toBe(true);
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
  test("a belt carries a thing across its tile in 4, 3 or 2 ticks by its grade; a splitter at the top grade's", () => {
    expect([1, 2, 3].map((g) => across(F.BELT, g))).toEqual([4, 3, 2]);
    expect(across(F.SPLITTER, 1)).toBe(2);
    expect(across(F.JOINER, 1)).toBe(2);
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
    expect(F.priceOf(y, read.legs)).toBe(24 + 1);
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
    const print = F.piecesOf(y.blueprints[0] ?? new Uint8Array());
    expect(print.map((p) => p.grade)).toEqual([2]);
    const pieces = F.placed(print, 0, 3, 6).map((p) => Object.assign({}, p, { kind: F.kindName(p.kind) }));
    must(y, { do: "stand", pieces });
    expect(y.grade[F.at(y, 3, 6)]).toBe(2);
    const back = F.decode(F.encode(y), y.land);
    expect(back && [back.grade[F.at(back, 3, 6)], back.grade[F.at(back, 6, 6)]]).toEqual([2, 2]);
    expect(back && F.piecesOf(back.blueprints[0] ?? new Uint8Array()).map((p) => p.grade)).toEqual([2]);
    expect(give(yard(3), { do: "stand", pieces })).toMatchObject({
      refused: "cannot_stand",
      why: "A grade 2 mill is not unlocked yet",
    });
  });
});
