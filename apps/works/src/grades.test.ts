/**
 * Grades, on the page against a stand-in Leaf: a kind is built at the grade chosen for it, kept for
 * that kind; set down over a piece of its kind of a lower grade it raises it for the difference, and
 * never lowers one; a run laid along belts raises them; a copy stood over the same pieces at another
 * grade is sent, since the rules would change them; a marked area is raised whole or not at all; and
 * each of these is undone to the grades there were.
 */
import { describe, expect, test } from "bun:test";

import {
  at,
  BELT,
  build,
  CRATE,
  create,
  encode,
  JOINER,
  MILL,
  priceAt,
  SORTER,
  SPLITTER,
  TUNNEL,
  upgradePrice,
  type Yard,
} from "@sequoia-leaf/factory";

import { act, coinsAre, ctx, type FakeLeaf, isRecord, opened, until, useFakeLeaf } from "./fake-leaf.ts";
import { gradeInHand, S } from "./state.ts";
import {
  aimAt,
  hold,
  markEnd,
  markOver,
  markStart,
  pickFrom,
  place,
  raiseAt,
  runEnd,
  runOver,
  runStart,
  setGrade,
  setTool,
  stepGrade,
  toolHooks,
  undo,
  upgradeCost,
  upgradeMark,
} from "./tools.ts";
import { differences, doNow } from "./yard.ts";

useFakeLeaf();

/** A yard Leaf has, with every goal of the tiers below `tier` done; nothing in hand, every kind at its first grade, and a mouse. */
function yardAt(tier: number): Yard {
  const y = create({ seed: 5, tier });
  y.at = ctx().now;
  S.finger = false;
  S.grades.fill(0);
  S.dir = 0;
  setTool(null);
  return y;
}

/** The grades of the pieces on some tiles of a row, west to east. */
const grades = (xs: readonly number[], z: number): number[] => xs.map((x) => S.world.grade[at(S.world, x, z)] ?? 0);
/** What was sent to Leaf, by what each command does. */
const sent = (fake: FakeLeaf): unknown[] => fake.leaf.commands.map((c) => (isRecord(c) ? c.do : null));
/** Leaf has had every command the page did (so many in all), found nothing to differ, and holds the same yard. */
async function inStep(fake: FakeLeaf, commands: number): Promise<void> {
  await until(() => fake.leaf.commands.length >= commands);
  expect(fake.leaf.commands.length).toBe(commands);
  expect(differences()).toBe(0);
  expect(encode(S.world)).toBe(encode({ ...fake.leaf.yard, seed: null }));
}
/** What is said on the line over the dock, kept. */
function listen(): string[] {
  const said: string[] = [];
  toolHooks.said = (text) => void said.push(text);
  return said;
}

describe("the grade in hand", () => {
  test("is chosen for a kind and kept for it, no higher than the yard may build; a piece picked up brings its own", async () => {
    const y = yardAt(3);
    build(y, TUNNEL, 20, 16, 0, Infinity, { grade: 2 });
    await opened(y, 1000);
    setTool(BELT);
    expect(gradeInHand(BELT)).toBe(1);
    setGrade(2);
    // Belts go no higher than II in this yard: a third is not chosen, and the key comes round to the first.
    setGrade(3);
    expect(gradeInHand(BELT)).toBe(2);
    stepGrade();
    expect(gradeInHand(BELT)).toBe(1);
    stepGrade();
    setTool(MILL);
    // Mills have one grade until research gives them another: nothing to choose.
    setGrade(2);
    expect([gradeInHand(MILL), gradeInHand(BELT)]).toEqual([1, 2]);
    setTool(null);
    expect(gradeInHand(TUNNEL)).toBe(1);
    expect(pickFrom(20, 16)).toBe(true);
    expect([S.tool, gradeInHand(TUNNEL)]).toEqual([TUNNEL, 2]);
  });

  test("a splitter's, joiner's and sorter's are chosen and kept for each as a belt's is, built at, and brought by one picked up", async () => {
    const y = yardAt(3);
    for (let x = 18; x <= 22; x++) build(y, BELT, x, 16, 0, Infinity, { grade: 2 });
    const fake = await opened(y, 1000);
    setTool(SPLITTER);
    expect(gradeInHand(SPLITTER)).toBe(1);
    setGrade(2);
    setTool(SORTER);
    expect([gradeInHand(SPLITTER), gradeInHand(SORTER), gradeInHand(BELT)]).toEqual([2, 1, 1]);
    // Set down on a belt of the line, at the grade in hand.
    setTool(SPLITTER);
    aimAt(20, 16);
    expect(S.aim).toMatchObject({ grade: 2, why: null });
    expect(place(20, 16)).toBe(true);
    setTool(JOINER);
    expect(place(21, 16)).toBe(true);
    expect(grades([19, 20, 21, 22], 16)).toEqual([2, 2, 1, 2]);
    await inStep(fake, 2);
    expect(fake.leaf.commands.map((c) => (isRecord(c) ? [c.kind, c.grade ?? 1] : null))).toEqual([
      ["splitter", 2],
      ["joiner", 1],
    ]);
    // The joiner of grade I raised where it stands, as a belt is, for the difference.
    setGrade(2);
    aimAt(21, 16);
    expect(S.aim).toMatchObject({ grade: 2, raises: 1, why: null, cost: priceAt(S.world, JOINER, 21, 16, 2) });
    expect(place(21, 16)).toBe(true);
    expect(grades([21], 16)).toEqual([2]);
    setTool(null);
    S.grades.fill(0);
    expect(pickFrom(20, 16)).toBe(true);
    expect([S.tool, gradeInHand(SPLITTER)]).toEqual([SPLITTER, 2]);
    await inStep(fake, 3);
  });

  test("in a yard that may build nothing higher, there is nothing to choose: every piece is built at the first", async () => {
    await opened(yardAt(1), 1000);
    setTool(BELT);
    setGrade(2);
    stepGrade();
    expect(gradeInHand(BELT)).toBe(1);
    aimAt(20, 16);
    expect(S.aim).toMatchObject({ grade: 1, why: null });
    expect(S.aim).not.toHaveProperty("raises");
  });
});

describe("a piece set down over one of its kind", () => {
  test("aimed at first at its own grade, then raised by a grade chosen, keeps the way it points", async () => {
    const y = yardAt(3);
    build(y, BELT, 20, 16, 1, Infinity);
    await opened(y, 1000);
    setTool(BELT);
    S.dir = 0;
    aimAt(20, 16);
    // At grade I the hand builds over nothing it would raise, and keeps its own way.
    expect([S.aim?.raises, S.dir]).toEqual([undefined, 0]);
    setGrade(2);
    expect([S.aim?.raises, S.dir]).toEqual([1, 1]);
    expect(place(20, 16)).toBe(true);
    expect([grades([20], 16), S.world.dir[at(S.world, 20, 16)]]).toEqual([[2], 1]);
  });

  test("of a lower grade raises it for the difference, says so in the aim, and is undone to the grade it had", async () => {
    const y = yardAt(3);
    build(y, BELT, 20, 16, 0, Infinity);
    const fake = await opened(y, 1000);
    setTool(BELT);
    setGrade(2);
    aimAt(20, 16);
    const cost = priceAt(S.world, BELT, 20, 16, 2);
    expect(cost).toBeGreaterThan(0);
    expect(S.aim).toMatchObject({ grade: 2, raises: 1, why: null, cost });
    expect(place(20, 16)).toBe(true);
    expect(grades([20], 16)).toEqual([2]);
    await inStep(fake, 1);
    expect(fake.leaf.commands.at(-1)).toMatchObject({ do: "build", kind: "belt", x: 20, y: 16, grade: 2 });
    expect(undo()).toBe(true);
    expect(grades([20], 16)).toEqual([1]);
    await inStep(fake, 2);
  });

  test("that it would raise takes the way that piece faces, so a line raised a piece at a time is not turned", async () => {
    const y = yardAt(3);
    build(y, BELT, 20, 16, 1, Infinity);
    build(y, BELT, 21, 16, 2, Infinity);
    const fake = await opened(y, 1000);
    setTool(BELT);
    setGrade(2);
    expect(S.dir).toBe(0);
    aimAt(20, 16);
    expect(S.dir).toBe(1);
    expect(place(20, 16)).toBe(true);
    aimAt(21, 16);
    expect(S.dir).toBe(2);
    expect(place(21, 16)).toBe(true);
    const [a, b] = [at(S.world, 20, 16), at(S.world, 21, 16)];
    expect([S.world.grade[a], S.world.dir[a], S.world.grade[b], S.world.dir[b]]).toEqual([2, 1, 2, 2]);
    await inStep(fake, 2);
  });

  test("of a higher grade only turns it: nothing is lowered by building over", async () => {
    const y = yardAt(3);
    build(y, BELT, 20, 16, 0, Infinity, { grade: 2 });
    const fake = await opened(y, 1000);
    setTool(BELT);
    S.dir = 1;
    aimAt(20, 16);
    // The first grade in hand: the aim is of the piece's own grade, and raises nothing.
    expect(S.aim).toMatchObject({ grade: 2, why: null, cost: 0 });
    expect(S.aim).not.toHaveProperty("raises");
    expect(place(20, 16)).toBe(true);
    const i = at(S.world, 20, 16);
    expect([S.world.grade[i], S.world.dir[i]]).toEqual([2, 1]);
    await inStep(fake, 1);
    expect(undo()).toBe(true);
    expect([S.world.grade[i], S.world.dir[i]]).toEqual([2, 0]);
  });

  test("from its card is raised a grade where it stands, and refused with the rules' sentence when the Coins fall short", async () => {
    const y = yardAt(3);
    build(y, BELT, 20, 16, 0, Infinity);
    const fake = await opened(y, 0);
    const said = listen();
    expect(raiseAt(20, 16)).toBe(false);
    expect(said).toEqual(["Not enough Coins."]);
    expect(grades([20], 16)).toEqual([1]);
    coinsAre(1000);
    expect(raiseAt(20, 16)).toBe(true);
    expect(grades([20], 16)).toEqual([2]);
    await inStep(fake, 1);
    // No higher in this yard: there is nothing to raise it to.
    expect(raiseAt(20, 16)).toBe(false);
    expect(undo()).toBe(true);
    expect(grades([20], 16)).toEqual([1]);
  });
});

describe("a run of belt", () => {
  test("dragged along belts of a lower grade raises them and lays the clear tiles at the grade in hand, in one command; one undo takes it back", async () => {
    const y = yardAt(3);
    for (const x of [18, 19, 20]) build(y, BELT, x, 21, 0, Infinity);
    const fake = await opened(y, 1000);
    setTool(BELT);
    setGrade(2);
    runStart(18, 21);
    runOver(23, 21);
    const legs = S.run?.legs ?? [];
    expect(legs.map((l) => [l.x, l.grade])).toEqual([18, 19, 20, 21, 22, 23].map((x) => [x, 2]));
    // Three raised for the difference, and three new: each what the rules ask for it at the second grade.
    const each = [18, 19, 20, 21, 22, 23].map((x) => priceAt(S.world, BELT, x, 21, 2));
    expect(each.every((c) => c > 0)).toBe(true);
    expect(S.run).toMatchObject({ why: null, cost: each.reduce((sum, c) => sum + c, 0) });
    runEnd();
    expect(grades([18, 19, 20, 21, 22, 23], 21)).toEqual([2, 2, 2, 2, 2, 2]);
    await inStep(fake, 1);
    expect(sent(fake)).toEqual(["lay"]);
    expect(undo()).toBe(true);
    expect(grades([18, 19, 20, 21, 22, 23], 21)).toEqual([1, 1, 1, 0, 0, 0]);
    // The new belts cleared, and those raised stood again as they were.
    await inStep(fake, 3);
    expect(sent(fake)).toEqual(["lay", "clear", "stand"]);
  });

  test("at the first grade along belts of the second lays nothing over them: they are stepped over as they stand", async () => {
    const y = yardAt(3);
    for (const x of [18, 19]) build(y, BELT, x, 21, 0, Infinity, { grade: 2 });
    await opened(y, 1000);
    setTool(BELT);
    runStart(18, 21);
    runOver(21, 21);
    expect(S.run?.legs.map((l) => [l.x, l.grade])).toEqual([
      [20, 1],
      [21, 1],
    ]);
  });
});

/** Marks the pieces between two corners with Select. */
function mark(x0: number, y0: number, x1: number, y1: number): void {
  setTool("select");
  markStart(x0, y0);
  markOver(x1, y1);
  markEnd();
}

describe("many pieces at once", () => {
  test("a copy stood over the same pieces at another grade is sent, as the rules would raise them, and undone to the grades they had; over itself it sends nothing", async () => {
    const y = yardAt(3);
    for (const x of [18, 19]) build(y, BELT, x, 13, 0, Infinity, { grade: 2 });
    for (const x of [18, 19]) build(y, BELT, x, 16, 0, Infinity);
    const fake = await opened(y, 1000);
    mark(18, 13, 19, 13);
    hold("copy");
    aimAt(18, 16);
    expect(S.group?.at.map((p) => [p.x, p.y, p.grade])).toEqual([
      [18, 16, 2],
      [19, 16, 2],
    ]);
    expect(S.aim).toMatchObject({ why: null, cost: 2 * priceAt(S.world, BELT, 18, 16, 2) });
    expect(place(18, 16)).toBe(true);
    expect(grades([18, 19], 16)).toEqual([2, 2]);
    await inStep(fake, 1);
    expect(sent(fake)).toEqual(["copy"]);
    // Over what it has just raised, the copy would change nothing: nothing is sent.
    aimAt(18, 16);
    expect(place(18, 16)).toBe(false);
    await Bun.sleep(5);
    expect(sent(fake)).toEqual(["copy"]);
    expect(undo()).toBe(true);
    expect(grades([18, 19], 16)).toEqual([1, 1]);
    expect(grades([18, 19], 13)).toEqual([2, 2]);
    await inStep(fake, 2);
    expect(sent(fake)).toEqual(["copy", "stand"]);
  });

  test("a marked area is raised to the highest grade the yard may build for the rules' whole price, or not at all; undo puts every grade back", async () => {
    const y = yardAt(4);
    for (const x of [18, 19, 20]) build(y, BELT, x, 13, 0, Infinity);
    build(y, MILL, 21, 13, 0, Infinity);
    build(y, CRATE, 22, 13, 0, Infinity);
    const fake = await opened(y, 0);
    const said = listen();
    mark(18, 13, 22, 13);
    const cost = upgradePrice(S.world, S.mark?.tiles ?? []);
    expect([cost > 0, upgradeCost()]).toEqual([true, cost]);
    const before = encode(S.world);
    // Short by one Coin: none is raised, the rules say why, and nothing is sent.
    coinsAre(cost - 1);
    expect(upgradeMark()).toBe(false);
    expect(said).toEqual(["Not enough Coins: 1 short."]);
    expect(encode(S.world)).toBe(before);
    await Bun.sleep(5);
    expect(sent(fake)).toEqual([]);
    coinsAre(cost);
    expect(upgradeMark()).toBe(true);
    // A crate has no grade: it stands as it stood.
    expect(grades([18, 19, 20, 21, 22], 13)).toEqual([2, 2, 2, 2, 0]);
    expect(upgradeCost()).toBe(0);
    await inStep(fake, 1);
    expect(sent(fake)).toEqual(["upgrade"]);
    coinsAre(0);
    expect(undo()).toBe(true);
    expect(grades([18, 19, 20, 21, 22], 13)).toEqual([1, 1, 1, 1, 0]);
    await inStep(fake, 2);
    expect(sent(fake)).toEqual(["upgrade", "stand"]);
  });

  test("in a yard that may not raise an area yet, the rules refuse it and say why", async () => {
    const y = yardAt(3);
    build(y, BELT, 18, 13, 0, Infinity);
    await opened(y, 1000);
    const said = listen();
    mark(18, 13, 18, 13);
    expect(upgradeMark()).toBe(false);
    expect(said.length).toBe(1);
    expect(grades([18], 13)).toEqual([1]);
    expect(doNow(act({ do: "upgrade", tiles: [at(S.world, 18, 13)] }))).toHaveProperty("refused");
  });
});
