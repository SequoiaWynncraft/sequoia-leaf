/**
 * A splitter's ways on its card, on the page against a stand-in Leaf: a press moves a way on a step,
 * open, first, shut, in and open again, each step once the yard may have it; undo puts each way back
 * as it was, Leaf and the page alike.
 */
import { describe, expect, test } from "bun:test";

import { at, build, create, encode, SPLITTER, type Yard } from "@sequoia-leaf/factory";

import { ctx, type FakeLeaf, opened, until, useFakeLeaf } from "../test/fake-leaf.ts";
import { S } from "./state.ts";
import { setTool, undo, wayAt } from "./tools.ts";
import { runOut, stepWay, wayState } from "./ways.ts";
import { differences } from "./yard.ts";

useFakeLeaf();

/** A yard Leaf has, with every goal of the tiers below `tier` done, and a splitter at (20, 16) facing east. */
function withSplitter(tier: number): Yard {
  const y = create({ seed: 5, tier });
  y.at = ctx().now;
  build(y, SPLITTER, 20, 16, 0, Infinity);
  setTool(null);
  return y;
}
/** How each way of the splitter stands on the page: ahead, left, right. */
const ways = (): string[] => [0, 1, 2].map((k) => wayState(S.world, at(S.world, 20, 16), k));
/** Leaf has had every command the page did, found nothing to differ, and holds the same yard. */
async function inStep(fake: FakeLeaf): Promise<void> {
  const same = (): boolean => encode(S.world) === encode({ ...fake.leaf.yard, seed: null });
  await until(same);
  expect([same(), differences()]).toEqual([true, 0]);
}

/** Undo pressed, and once Leaf has it too, each way as `was` says. */
async function undoTo(fake: FakeLeaf, was: string[]): Promise<void> {
  expect(undo()).toBe(true);
  await inStep(fake);
  expect(ways()).toEqual(was);
}

describe("a splitter's ways on its card", () => {
  test("a press moves a way on: open, first, shut, in, open; undo puts every way back, the last first", async () => {
    const fake = await opened(withSplitter(5));
    const steps: string[] = [];
    for (let k = 0; k < 4; k++) {
      expect(wayAt(20, 16, 1)).toBe(true);
      steps.push(ways()[1] ?? "");
    }
    expect(steps).toEqual(["first", "shut", "in", "open"]);
    // Left in, ahead first then shut: what the right way does is its own.
    for (const [way, presses] of [
      [1, 3],
      [0, 2],
    ] as const)
      for (let k = 0; k < presses; k++) wayAt(20, 16, way);
    expect(ways()).toEqual(["shut", "in", "open"]);
    await inStep(fake);
    await undoTo(fake, ["first", "in", "open"]);
    await undoTo(fake, ["open", "in", "open"]);
    await undoTo(fake, ["open", "shut", "open"]);
  });

  test("a run of belt from a splitter begins on its first way out that sends, not one taking things in", () => {
    const y = withSplitter(5);
    const i = at(y, 20, 16);
    expect(runOut(y, i)).toBe(at(y, 21, 16));
    y.ins[i] = 1;
    expect(runOut(y, i)).toBe(at(y, 20, 15));
    y.shut[i] = 6;
    expect(runOut(y, i)).toBe(-1);
  });

  test("before ways in are studied, a shut way opens; before a way may be put first, an open way shuts", () => {
    const y = withSplitter(4);
    const i = at(y, 20, 16);
    expect([y.open.first, y.open.ins]).toEqual([false, false]);
    expect(stepWay(y, i, 20, 16, 0)).toEqual({ do: "way", x: 20, y: 16, way: 0, open: false });
    y.shut[i] = 1;
    expect(stepWay(y, i, 20, 16, 0)).toEqual({ do: "way", x: 20, y: 16, way: 0, open: true });
  });
});
