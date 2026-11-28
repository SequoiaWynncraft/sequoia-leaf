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
  goal,
  highest,
  item,
  JOINER,
  MILL,
  piecesAt,
  priceAt,
  refusal,
  reopen,
  SORTER,
  sortWay,
  SPLITTER,
  STAND_MOST,
  TUNNEL,
  upgradePrice,
  within,
  type Yard,
} from "@sequoia-leaf/factory";
import { col, near, xy } from "@sequoia-leaf/factory/test/near.ts";
import { press } from "@sequoia-leaf/kit/standin.ts";

import { act, coinsAre, ctx, type FakeLeaf, isRecord, opened, until, useFakeLeaf } from "../test/fake-leaf.ts";
import { gradeInHand, S, toolHooks } from "./state.ts";
import {
  aimAt,
  clearMark,
  flip,
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
  undo,
  upgradeCost,
  upgradeMark,
} from "./tools.ts";
import { handPrint, pressUpgrade } from "./ui/dock.ts";
import { differences, doNow } from "./yard.ts";

useFakeLeaf();

/** A yard Leaf has, with every goal of the tiers below `tier` done; nothing in hand, every kind at its first grade, and a mouse. */
function yardAt(tier: number): Yard {
  const y = create({ seed: 5, tier });
  y.at = ctx().now;
  S.finger = false;
  S.grades.fill(0);
  S.dir = 0;
  S.right = false;
  setTool(null);
  return y;
}

/** The grades of the pieces on some tiles of a row, west to east. */
/** The side the sorter at (18, z) sends to: 1 its left, 2 its right. */
const sideAt = (dy: number): number => sortWay(S.world, at(S.world, ...xy(-6, dy)));
const grades = (dxs: readonly number[], dy: number): number[] =>
  dxs.map((dx) => S.world.grade[at(S.world, ...xy(dx, dy))] ?? 0);
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
    build(y, TUNNEL, ...xy(-4, -2), 0, Infinity, { grade: 2 });
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
    expect(pickFrom(...xy(-4, -2))).toBe(true);
    expect([S.tool, gradeInHand(TUNNEL)]).toEqual([TUNNEL, 2]);
  });

  test("a splitter's, joiner's and sorter's are chosen and kept for each as a belt's is, built at, and brought by one picked up", async () => {
    const y = yardAt(3);
    for (let dx = -6; dx <= -2; dx++) build(y, BELT, ...xy(dx, -2), 0, Infinity, { grade: 2 });
    const fake = await opened(y, 1000);
    setTool(SPLITTER);
    expect(gradeInHand(SPLITTER)).toBe(1);
    setGrade(2);
    setTool(SORTER);
    expect([gradeInHand(SPLITTER), gradeInHand(SORTER), gradeInHand(BELT)]).toEqual([2, 1, 1]);
    // Set down on a belt of the line, at the grade in hand.
    setTool(SPLITTER);
    aimAt(...xy(-4, -2));
    expect(S.aim).toMatchObject({ grade: 2, why: null });
    expect(place(...xy(-4, -2))).toBe(true);
    setTool(JOINER);
    expect(place(...xy(-3, -2))).toBe(true);
    expect(grades([-5, -4, -3, -2], -2)).toEqual([2, 2, 1, 2]);
    await inStep(fake, 2);
    expect(fake.leaf.commands.map((c) => (isRecord(c) ? [c.kind, c.grade ?? 1] : null))).toEqual([
      ["splitter", 2],
      ["joiner", 1],
    ]);
    // The joiner of grade I raised where it stands, as a belt is, for the difference.
    setGrade(2);
    aimAt(...xy(-3, -2));
    expect(S.aim).toMatchObject({ grade: 2, raises: 1, why: null, cost: priceAt(S.world, JOINER, ...xy(-3, -2), 2) });
    expect(place(...xy(-3, -2))).toBe(true);
    expect(grades([-3], -2)).toEqual([2]);
    setTool(null);
    S.grades.fill(0);
    expect(pickFrom(...xy(-4, -2))).toBe(true);
    expect([S.tool, gradeInHand(SPLITTER)]).toEqual([SPLITTER, 2]);
    await inStep(fake, 3);
  });

  test("in a yard that may build nothing higher, there is nothing to choose: every piece is built at the first", async () => {
    await opened(yardAt(1), 1000);
    setTool(BELT);
    setGrade(2);
    stepGrade();
    expect(gradeInHand(BELT)).toBe(1);
    aimAt(...xy(-4, -2));
    expect(S.aim).toMatchObject({ grade: 1, why: null });
    expect(S.aim).not.toHaveProperty("raises");
  });
});

describe("a piece set down over one of its kind", () => {
  test("aimed at first at its own grade, then raised by a grade chosen, keeps the way it points", async () => {
    const y = yardAt(3);
    build(y, BELT, ...xy(-4, -2), 1, Infinity);
    await opened(y, 1000);
    setTool(BELT);
    S.dir = 0;
    aimAt(...xy(-4, -2));
    // At grade I the hand builds over nothing it would raise, and keeps its own way.
    expect([S.aim?.raises, S.dir]).toEqual([undefined, 0]);
    setGrade(2);
    expect([S.aim?.raises, S.dir]).toEqual([1, 1]);
    expect(place(...xy(-4, -2))).toBe(true);
    expect([grades([-4], -2), S.world.dir[at(S.world, ...xy(-4, -2))]]).toEqual([[2], 1]);
  });

  test("of a lower grade raises it for the difference, says so in the aim, and is undone to the grade it had", async () => {
    const y = yardAt(3);
    build(y, BELT, ...xy(-4, -2), 0, Infinity);
    const fake = await opened(y, 1000);
    setTool(BELT);
    setGrade(2);
    aimAt(...xy(-4, -2));
    const cost = priceAt(S.world, BELT, ...xy(-4, -2), 2);
    expect(cost).toBeGreaterThan(0);
    expect(S.aim).toMatchObject({ grade: 2, raises: 1, why: null, cost });
    expect(place(...xy(-4, -2))).toBe(true);
    expect(grades([-4], -2)).toEqual([2]);
    await inStep(fake, 1);
    expect(fake.leaf.commands.at(-1)).toMatchObject({ do: "build", kind: "belt", ...near(-4, -2), grade: 2 });
    expect(undo()).toBe(true);
    expect(grades([-4], -2)).toEqual([1]);
    await inStep(fake, 2);
  });

  test("a sorter raised and flipped at once is undone to the grade and the side it had", async () => {
    const y = yardAt(4);
    build(y, SORTER, ...xy(-4, -2), 0, Infinity);
    const fake = await opened(y, 1000);
    const i = at(y, ...xy(-4, -2));
    setTool(SORTER);
    setGrade(2);
    aimAt(...xy(-4, -2));
    flip();
    expect(place(...xy(-4, -2))).toBe(true);
    expect([S.world.grade[i], sortWay(S.world, i)]).toEqual([2, 2]);
    await inStep(fake, 1);
    expect(undo()).toBe(true);
    expect([S.world.grade[i], sortWay(S.world, i)]).toEqual([1, 1]);
    await inStep(fake, 2);
  });

  test("that it would raise takes the way that piece faces, so a line raised a piece at a time is not turned", async () => {
    const y = yardAt(3);
    build(y, BELT, ...xy(-4, -2), 1, Infinity);
    build(y, BELT, ...xy(-3, -2), 2, Infinity);
    const fake = await opened(y, 1000);
    setTool(BELT);
    setGrade(2);
    expect(S.dir).toBe(0);
    aimAt(...xy(-4, -2));
    expect(S.dir).toBe(1);
    expect(place(...xy(-4, -2))).toBe(true);
    aimAt(...xy(-3, -2));
    expect(S.dir).toBe(2);
    expect(place(...xy(-3, -2))).toBe(true);
    const [a, b] = [at(S.world, ...xy(-4, -2)), at(S.world, ...xy(-3, -2))];
    expect([S.world.grade[a], S.world.dir[a], S.world.grade[b], S.world.dir[b]]).toEqual([2, 1, 2, 2]);
    await inStep(fake, 2);
  });

  test("of a higher grade only turns it: nothing is lowered by building over", async () => {
    const y = yardAt(3);
    build(y, BELT, ...xy(-4, -2), 0, Infinity, { grade: 2 });
    const fake = await opened(y, 1000);
    setTool(BELT);
    S.dir = 1;
    aimAt(...xy(-4, -2));
    // The first grade in hand: the aim is of the piece's own grade, and raises nothing.
    expect(S.aim).toMatchObject({ grade: 2, why: null, cost: 0 });
    expect(S.aim).not.toHaveProperty("raises");
    expect(place(...xy(-4, -2))).toBe(true);
    const i = at(S.world, ...xy(-4, -2));
    expect([S.world.grade[i], S.world.dir[i]]).toEqual([2, 1]);
    await inStep(fake, 1);
    expect(undo()).toBe(true);
    expect([S.world.grade[i], S.world.dir[i]]).toEqual([2, 0]);
  });

  test("from its card is raised a grade where it stands, and refused with the rules' sentence when the Coins fall short", async () => {
    const y = yardAt(3);
    build(y, BELT, ...xy(-4, -2), 0, Infinity);
    const fake = await opened(y, 0);
    const said = listen();
    expect(raiseAt(...xy(-4, -2))).toBe(false);
    expect(said).toEqual(["Not enough Coins: 2 short."]);
    expect(grades([-4], -2)).toEqual([1]);
    coinsAre(1000);
    expect(raiseAt(...xy(-4, -2))).toBe(true);
    expect(grades([-4], -2)).toEqual([2]);
    await inStep(fake, 1);
    // No higher in this yard: there is nothing to raise it to.
    expect(raiseAt(...xy(-4, -2))).toBe(false);
    expect(undo()).toBe(true);
    expect(grades([-4], -2)).toEqual([1]);
  });
});

/** Every piece in the page's copy of the yard, as it stands. */
const stood = (): unknown => piecesAt(S.world, within(S.world, 0, 0, S.world.land.w, S.world.land.h));

describe("a run of belt", () => {
  test("dragged along belts of a lower grade raises them and lays the clear tiles at the grade in hand, in one command; one undo takes it back", async () => {
    const y = yardAt(3);
    for (const dx of [-6, -5, -4]) build(y, BELT, ...xy(dx, 3), 0, Infinity);
    const fake = await opened(y, 1000);
    setTool(BELT);
    setGrade(2);
    runStart(...xy(-6, 3));
    runOver(...xy(-1, 3));
    const legs = S.run?.legs ?? [];
    expect(legs.map((l) => [l.x, l.grade])).toEqual([-6, -5, -4, -3, -2, -1].map((dx) => [col(dx), 2]));
    // Three raised for the difference, and three new: each what the rules ask for it at the second grade.
    const each = [-6, -5, -4, -3, -2, -1].map((dx) => priceAt(S.world, BELT, ...xy(dx, 3), 2));
    expect(each.every((c) => c > 0)).toBe(true);
    expect(S.run).toMatchObject({ why: null, cost: each.reduce((sum, c) => sum + c, 0) });
    runEnd();
    expect(grades([-6, -5, -4, -3, -2, -1], 3)).toEqual([2, 2, 2, 2, 2, 2]);
    await inStep(fake, 1);
    expect(sent(fake)).toEqual(["lay"]);
    expect(undo()).toBe(true);
    expect(grades([-6, -5, -4, -3, -2, -1], 3)).toEqual([1, 1, 1, 0, 0, 0]);
    // The new belts taken away, and those raised set back as they were: one command, the rules'.
    await inStep(fake, 2);
    expect(sent(fake)).toEqual(["lay", "undo"]);
  });

  test("at the first grade along belts of the second lays nothing over them: they are stepped over as they stand", async () => {
    const y = yardAt(3);
    for (const dx of [-6, -5]) build(y, BELT, ...xy(dx, 3), 0, Infinity, { grade: 2 });
    await opened(y, 1000);
    setTool(BELT);
    runStart(...xy(-6, 3));
    runOver(...xy(-3, 3));
    expect(S.run?.legs.map((l) => [l.x, l.grade])).toEqual([
      [col(-4), 1],
      [col(-3), 1],
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
    for (const dx of [-6, -5]) build(y, BELT, ...xy(dx, -5), 0, Infinity, { grade: 2 });
    for (const dx of [-6, -5]) build(y, BELT, ...xy(dx, -2), 0, Infinity);
    const fake = await opened(y, 1000);
    mark(...xy(-6, -5), ...xy(-5, -5));
    hold("copy");
    aimAt(...xy(-6, -2));
    expect(S.group?.at.map((p) => [p.x, p.y, p.grade])).toEqual([
      [...xy(-6, -2), 2],
      [...xy(-5, -2), 2],
    ]);
    expect(S.aim).toMatchObject({ why: null, cost: 2 * priceAt(S.world, BELT, ...xy(-6, -2), 2) });
    expect(place(...xy(-6, -2))).toBe(true);
    expect(grades([-6, -5], -2)).toEqual([2, 2]);
    await inStep(fake, 1);
    expect(sent(fake)).toEqual(["copy"]);
    // Over what it has just raised, the copy would change nothing: nothing is sent.
    aimAt(...xy(-6, -2));
    expect(place(...xy(-6, -2))).toBe(false);
    await Bun.sleep(5);
    expect(sent(fake)).toEqual(["copy"]);
    expect(undo()).toBe(true);
    expect(grades([-6, -5], -2)).toEqual([1, 1]);
    expect(grades([-6, -5], -5)).toEqual([2, 2]);
    await inStep(fake, 2);
    expect(sent(fake)).toEqual(["copy", "undo"]);
  });

  test("a copy stood over sorters that differ only in their side is sent, as the rules would flip them, and undone to the sides they had", async () => {
    const y = yardAt(4);
    build(y, SORTER, ...xy(-6, -5), 0, Infinity, { right: true });
    build(y, SORTER, ...xy(-6, -2), 0, Infinity);
    const fake = await opened(y, 1000);
    mark(...xy(-6, -5), ...xy(-6, -5));
    hold("copy");
    aimAt(...xy(-6, -2));
    expect(place(...xy(-6, -2))).toBe(true);
    expect([sideAt(-5), sideAt(-2)]).toEqual([2, 2]);
    await inStep(fake, 1);
    expect(sent(fake)).toEqual(["copy"]);
    expect(undo()).toBe(true);
    expect([sideAt(-5), sideAt(-2)]).toEqual([2, 1]);
    await inStep(fake, 2);
  });

  test("a marked area is raised to the highest grade the yard may build for the rules' whole price, or not at all; undo puts every grade back", async () => {
    const y = yardAt(4);
    for (const dx of [-6, -5, -4]) build(y, BELT, ...xy(dx, -5), 0, Infinity);
    build(y, MILL, ...xy(-3, -5), 0, Infinity);
    build(y, CRATE, ...xy(-2, -5), 0, Infinity);
    const fake = await opened(y, 0);
    const said = listen();
    mark(...xy(-6, -5), ...xy(-2, -5));
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
    expect(grades([-6, -5, -4, -3, -2], -5)).toEqual([2, 2, 2, 2, 0]);
    expect(upgradeCost()).toBe(0);
    await inStep(fake, 1);
    expect(sent(fake)).toEqual(["upgrade"]);
    // At the price the button showed.
    expect(fake.leaf.commands[0]).toMatchObject({ do: "upgrade", price: cost });
    coinsAre(0);
    expect(undo()).toBe(true);
    expect(grades([-6, -5, -4, -3, -2], -5)).toEqual([1, 1, 1, 1, 0]);
    await inStep(fake, 2);
    expect(sent(fake)).toEqual(["upgrade", "undo"]);
  });

  test("in a yard that may not raise an area yet, the rules refuse it and say why", async () => {
    const y = yardAt(3);
    build(y, BELT, ...xy(-6, -5), 0, Infinity);
    await opened(y, 1000);
    const said = listen();
    mark(...xy(-6, -5), ...xy(-6, -5));
    expect(upgradeMark()).toBe(false);
    expect(said.length).toBe(1);
    expect(grades([-6], -5)).toEqual([1]);
    expect(doNow(act({ do: "upgrade", tiles: [at(S.world, ...xy(-6, -5))], price: 2 }))).toHaveProperty("refused");
  });

  test("with Select in hand and nothing marked, Upgrade all raises everything in the yard that can be raised, for the whole price or not at all; undo puts every grade back", async () => {
    const y = yardAt(4);
    for (const dx of [-6, -5, -4]) build(y, BELT, ...xy(dx, -5), 0, Infinity);
    build(y, MILL, ...xy(-3, -5), 0, Infinity);
    build(y, CRATE, ...xy(-2, -5), 0, Infinity);
    build(y, BELT, ...xy(-6, -2), 0, Infinity);
    const fake = await opened(y, 0);
    const said = listen();
    setTool("select");
    const cost = upgradePrice(S.world, within(S.world, 0, 0, S.world.land.w - 1, S.world.land.h - 1));
    expect(cost).toBeGreaterThan(0);
    // With no Coins it is offered, drawn as short of its whole price.
    expect(handPrint().upgrade).toEqual({ all: true, cost, asking: false, short: cost });
    const before = encode(S.world);
    // Short by one Coin: none is raised, the rules say by how much, and nothing is sent.
    coinsAre(cost - 1);
    expect(handPrint().upgrade).toMatchObject({ short: 1 });
    expect(upgradeMark(true)).toBe(false);
    expect(said).toEqual(["Not enough Coins: 1 short."]);
    expect(encode(S.world)).toBe(before);
    await Bun.sleep(5);
    expect(sent(fake)).toEqual([]);
    coinsAre(cost);
    expect(handPrint().upgrade).toMatchObject({ short: 0 });
    expect(upgradeMark(true)).toBe(true);
    expect([...grades([-6, -5, -4, -3, -2], -5), ...grades([-6], -2)]).toEqual([2, 2, 2, 2, 0, 2]);
    // Nothing is left to raise: it is no longer offered.
    expect(handPrint().upgrade).toBeNull();
    await inStep(fake, 1);
    expect(sent(fake)).toEqual(["upgrade"]);
    expect(fake.leaf.commands[0]).toMatchObject({ do: "upgrade", price: cost });
    coinsAre(0);
    expect(undo()).toBe(true);
    expect([...grades([-6, -5, -4, -3, -2], -5), ...grades([-6], -2)]).toEqual([1, 1, 1, 1, 0, 1]);
    await inStep(fake, 2);
    expect(sent(fake)).toEqual(["upgrade", "undo"]);
  });

  test("160 painted grade II sorters taken away are stood again by one Undo, as they stood, in one small command", async () => {
    const y = yardAt(4);
    let n = 0;
    for (let z = 0; z < y.land.h; z++)
      for (let x = 0; x < y.land.w && n < STAND_MOST; x++) {
        if (refusal(y, SORTER, x, z, Infinity) !== null) continue;
        build(y, SORTER, x, z, 0, Infinity, { grade: 2 });
        y.tint[at(y, x, z)] = 6;
        y.set[at(y, x, z)] = item("brick");
        n++;
      }
    const fake = await opened(y, 1_000_000);
    const was = stood();
    mark(0, 0, S.world.land.w - 1, S.world.land.h - 1);
    expect(S.mark?.pieces.length).toBe(STAND_MOST);
    expect(clearMark()).toBe(true);
    expect(undo()).toBe(true);
    expect(stood()).toEqual(was);
    await until(() => fake.leaf.commands.length >= 2);
    expect(sent(fake)).toEqual(["clear", "undo"]);
    expect(JSON.stringify(fake.leaf.commands[1]).length).toBeLessThan(80);
    await inStep(fake, 2);
  });

  test("Upgrade all is weighed against the Coins when pressed: short, it says by how much at once; Coins come in since it was drawn, it still asks to be pressed again", async () => {
    const y = yardAt(4);
    for (const dx of [-6, -5]) build(y, BELT, ...xy(dx, -5), 0, Infinity);
    await opened(y, 0);
    const said = listen();
    setTool("select");
    const cost = handPrint().upgrade?.cost ?? 0;
    expect(cost).toBeGreaterThan(1);
    coinsAre(cost - 1);
    press();
    pressUpgrade(true);
    expect(said).toEqual(["Not enough Coins: 1 short."]);
    expect(handPrint().upgrade).toMatchObject({ asking: false });
    // Drawn short, then the last Coin comes in before the dock is drawn again: one press only asks.
    coinsAre(cost);
    press();
    pressUpgrade(true);
    expect(grades([-6, -5], -5)).toEqual([1, 1]);
    expect(handPrint().upgrade).toMatchObject({ asking: true, short: 0 });
    press();
    pressUpgrade(true);
    expect(grades([-6, -5], -5)).toEqual([2, 2]);
  });

  test("Upgrade all is offered only with nothing marked, once Upgrading an area is known; a marked area has its own Upgrade", async () => {
    const y = yardAt(4);
    for (const dx of [-6, -5]) build(y, BELT, ...xy(dx, -5), 0, Infinity);
    build(y, CRATE, ...xy(-2, -5), 0, Infinity);
    const upgrading = goal("upgrading");
    y.done = y.done.filter((g) => g !== upgrading);
    reopen(y);
    await opened(y, 100_000);
    setTool("select");
    // The belts can be raised, but Upgrading is not known: nothing is offered, and the rules refuse it.
    expect(highest(S.world.open, BELT)).toBe(2);
    expect(handPrint().upgrade).toBeNull();
    expect(upgradeMark(true)).toBe(false);
    expect(grades([-6, -5], -5)).toEqual([1, 1]);
    S.world.done.push(upgrading);
    reopen(S.world);
    expect(handPrint().upgrade).toMatchObject({ all: true });
    mark(...xy(-6, -5), ...xy(-6, -5));
    expect(handPrint().upgrade).toMatchObject({
      all: false,
      cost: upgradePrice(S.world, [at(S.world, ...xy(-6, -5))]),
    });
    // An area marked with nothing in it that can be raised offers neither.
    mark(...xy(-2, -5), ...xy(-2, -5));
    expect(S.mark?.pieces.length).toBe(1);
    expect(handPrint().upgrade).toBeNull();
  });
});
