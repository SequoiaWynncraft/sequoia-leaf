/**
 * A plan of the whole yard on the page, by what the line over the dock prints, against a stand-in
 * Leaf: Save yard keeps the whole yard in a place once the research is known; a plan of it in hand
 * stays where it was taken and shows what it builds, takes up and costs; Place asks twice, or short
 * of Coins says how short and asks nothing; put back and undone alike on the page and on Leaf.
 */
import { describe, expect, test } from "bun:test";

import {
  BELT,
  check,
  create,
  encode,
  goalNamed,
  keptAt,
  kindName,
  MILLI,
  piecesAt,
  play,
  readCommand,
  refusal,
  reopen,
  route,
  WORKSHOP,
  writeAct,
  type Yard,
} from "@sequoia-leaf/factory";
import { asking, pressedTwice } from "@sequoia-leaf/kit/dom.ts";
import { press } from "@sequoia-leaf/kit/standin.ts";

import { clear, ctx, opened, until, useFakeLeaf } from "../test/fake-leaf.ts";
import { heldBox } from "./held.ts";
import { askSave, askSaveYard, saveIn, saveKey } from "./plans.ts";
import { handSession, S, toolHooks } from "./state.ts";
import { aimAt, cancel, confirm, hold, markEnd, markOver, markStart, setTool, takeAway, unaim, undo } from "./tools.ts";
import { handPrint, pressUpgrade } from "./ui/dock.ts";
import { differences, doNow } from "./yard.ts";

// The input's module reaches the scene, which makes canvases as it loads: a document is there first
// whose canvases take any drawing and keep none of it, as `input.test.ts` has it.
const inert: () => unknown = new Proxy(() => inert, { get: () => inert, set: () => true });
Object.defineProperty(globalThis, "document", { value: { createElement: () => inert }, configurable: true });
const { fingerTap } = await import("./input.ts");

useFakeLeaf();

/** Plays a command on a yard as the rules take it, or the test fails. */
function must(y: Yard, c: Record<string, unknown>): void {
  const read = readCommand({ tick: y.tick, ...c });
  const did = read ? play(y, read) : null;
  if (!did || "refused" in did) throw new Error(`${JSON.stringify(c)} was not done`);
}

/** A yard Leaf has with every goal done, a line of planks into the depot and a crate of ore by it, standing for Leaf's clock now. */
function yard(known = true): Yard {
  const y = create({ seed: 5, tier: 5 });
  must(y, { do: "build", kind: "gatherer", x: 29, y: 21, dir: 3 });
  must(y, { do: "build", kind: "mill", x: 29, y: 20, dir: 2 });
  const legs = route(y, [28, 20], y.land.depot);
  if (!legs) throw new Error("no way to the depot");
  must(y, writeAct({ do: "lay", legs }));
  must(y, { do: "build", kind: "crate", x: 29, y: 14, dir: 2 });
  if (!known) {
    y.done = y.done.filter((g) => g !== goalNamed("wholeyard"));
    reopen(y);
  }
  y.history = [];
  y.at = ctx().now;
  return y;
}

/** How every piece of the page's copy stands, as the player set it. */
const settings = (y: Yard): string =>
  JSON.stringify(piecesAt(y, [...y.kind.keys()]).map((p) => [p, keptAt(y, y.land.w * p.y + p.x)]));
/** The commands Leaf was sent, by what each did. */
const sent = (leaf: { commands: unknown[] }): unknown[] =>
  leaf.commands.map((c) => (typeof c === "object" && c !== null && "do" in c ? c.do : null));

describe("Save yard", () => {
  test("is offered with Select in hand and nothing marked only once the research is known", async () => {
    await opened(yard(false), 1000);
    setTool("select");
    expect(handPrint().saveYard).toBe(false);
  });

  test("asks which place, and keeps the whole yard there, on the page and on Leaf alike; pressed again, it asks nothing", async () => {
    const fake = await opened(yard(), 1000);
    setTool("select");
    expect(handPrint().saveYard).toBe(true);
    askSaveYard();
    const asked = handPrint();
    expect([asked.line.text, asked.saving, asked.saveYard, asked.places.map((p) => p.kept)]).toEqual([
      "Save the whole yard in which place?",
      true,
      false,
      [false, false, false, false],
    ]);
    askSaveYard();
    expect(handPrint().saving).toBe(false);
    askSaveYard();
    expect(saveIn(2)).toBe(true);
    const print = handPrint();
    expect([print.saving, print.places[2]]).toEqual([
      false,
      expect.objectContaining({ slot: 2, kept: true, whole: true, cost: 0 }),
    ]);
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(5);
    expect(sent(fake.leaf)).toEqual(["saveYard"]);
    expect(fake.leaf.yard.blueprints[2]).toEqual(S.world.blueprints[2]);
  });
});

/** The yard with its plan kept in place 0, then the crate taken away and a bench and a mill's worth of change made. */
function changed(): { y: Yard; saved: string } {
  const y = yard();
  must(y, { do: "saveYard", slot: 0 });
  const saved = settings(y);
  must(y, { do: "remove", x: 29, y: 14 });
  must(y, { do: "build", kind: "bench", x: 30, y: 14, dir: 0 });
  y.history = [];
  return { y, saved };
}

describe("a plan of the whole yard in hand", () => {
  test("stays where it was taken, wherever the pointer is, and says what it builds, takes up and costs; it cannot be turned", async () => {
    const { y } = changed();
    await opened(y, 1000);
    setTool("select");
    hold(0);
    const at = S.group?.at;
    expect(at?.map((p) => [kindName(p.kind), p.x, p.y])).toEqual([["crate", 29, 14]]);
    aimAt(3, 3);
    expect(S.group?.at).toEqual(at);
    // The mouse leaving the yard for the dock lets go of no aim: Place stays.
    unaim();
    expect(handPrint().place).not.toBeNull();
    const print = handPrint();
    // A crate stood (20), a bench taken up (40): it gives back 20.
    expect([print.line, print.place, print.turn, print.go]).toEqual([
      { text: "Whole yard: 1 to build, 1 to take up, gives back 20 Coins.", bad: false },
      { spend: { on: expect.any(String), price: -20 }, cost: -20, asking: false, bad: false },
      false,
      null,
    ]);
  });

  test("Place asks again; pressed twice, the yard is put back as saved, on the page and on Leaf alike, and let go of", async () => {
    const { y, saved } = changed();
    const fake = await opened(y, 1000);
    const before = settings(S.world);
    setTool("select");
    hold(0);
    press();
    expect(confirm()).toBe(false);
    expect(handPrint().place?.asking).toBe(true);
    expect(settings(S.world)).not.toBe(saved);
    press();
    expect(confirm()).toBe(true);
    expect([settings(S.world), S.group, handPrint().place]).toEqual([saved, null, null]);
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(5);
    expect(sent(fake.leaf)).toEqual(["placeBlueprint"]);
    expect([differences(), check(S.world)]).toEqual([0, check(fake.leaf.yard)]);
    // Undone, the yard is as it was before, here and on Leaf.
    expect(undo()).toBe(true);
    await until(() => fake.leaf.posts >= 2);
    await Bun.sleep(5);
    expect(sent(fake.leaf)).toEqual(["placeBlueprint", "undo"]);
    expect([check(S.world), encode({ ...S.world, seed: null })]).toEqual([
      check(fake.leaf.yard),
      encode({ ...fake.leaf.yard, seed: null }),
    ]);
    expect(settings(S.world)).toBe(before);
  });

  test("short of Coins, Place is drawn off and says how short at once, for the whole, asking nothing", async () => {
    const { y } = changed();
    // Over a yard with the bench and the crate gone and nothing in its place: it costs a crate.
    must(y, { do: "remove", x: 30, y: 14 });
    y.history = [];
    const said: string[] = [];
    await opened(y, 0);
    toolHooks.said = (text) => void said.push(text);
    setTool("select");
    hold(0);
    const short = 20 - Math.floor(S.world.till / MILLI);
    expect(handPrint().place).toEqual({
      spend: { on: expect.any(String), price: 20 },
      cost: 20,
      asking: false,
      bad: true,
    });
    expect(handPrint().line).toEqual({ text: `Not enough Coins: ${short} short`, bad: true });
    const before = encode(S.world);
    press();
    expect(confirm()).toBe(false);
    expect([said, handPrint().place?.asking, encode(S.world)]).toEqual([
      [`Not enough Coins: ${short} short.`],
      false,
      before,
    ]);
  });
});

/** The yard with a plan of it kept in place 0, changed and kept again in place 1, then changed once more. */
function twoPlans(): Yard {
  const { y } = changed();
  must(y, { do: "saveYard", slot: 1 });
  must(y, { do: "remove", x: 30, y: 14 });
  y.history = [];
  return y;
}

describe("a press that waits for a second", () => {
  test("is for one plan: Place pressed on one, put down, and another taken up, the other asks; and so does the same one taken up again", async () => {
    const fake = await opened(twoPlans(), 1000);
    const was = settings(S.world);
    setTool("select");
    hold(0);
    press();
    expect([confirm(), handPrint().place?.asking]).toEqual([false, true]);
    cancel();
    hold(1);
    expect(handPrint().place?.asking).toBe(false);
    press();
    expect([confirm(), handPrint().place?.asking]).toEqual([false, true]);
    cancel();
    hold(1);
    press();
    expect([handPrint().place?.asking, confirm()]).toEqual([false, false]);
    expect([settings(S.world), sent(fake.leaf)]).toEqual([was, []]);
  });

  test("Save over a kept place is for what it keeps: asked for a marked area and let go, it asks again for the whole yard", async () => {
    await opened(twoPlans(), 1000);
    setTool("select");
    // The mill's line: a gatherer, a mill and a belt.
    markStart(27, 19);
    markOver(30, 22);
    markEnd();
    askSave();
    const area = saveKey(1);
    expect(area.on).toMatch(/:area:\d+@\d+$/);
    press();
    expect([pressedTwice(handSession(), area, () => {}), asking(area)]).toEqual([false, true]);
    // Save put away: what it waited for goes with it.
    cancel();
    expect(asking(area)).toBe(false);
    cancel();
    askSaveYard();
    const all = saveKey(1);
    expect(all).not.toEqual(area);
    press();
    expect(pressedTwice(handSession(), all, () => {})).toBe(false);
  });
});

describe("a press that waits for a second, when the yard changes", () => {
  test("Upgrade all pressed once, then a clearing undone: the price changes and the second press asks again, raising nothing", async () => {
    const fake = await opened(yard(), 1000);
    setTool("select");
    expect(takeAway(28, 20)).toBe(true);
    const price = handPrint().upgrade?.cost ?? 0;
    press();
    pressUpgrade(true);
    expect(handPrint().upgrade?.asking).toBe(true);
    expect(undo()).toBe(true);
    expect([handPrint().upgrade?.asking, (handPrint().upgrade?.cost ?? 0) > price]).toEqual([false, true]);
    press();
    pressUpgrade(true);
    expect(handPrint().upgrade?.asking).toBe(true);
    await until(() => fake.leaf.posts >= 2);
    await Bun.sleep(5);
    expect(sent(fake.leaf)).toEqual(["remove", "undo"]);
  });

  test("Save over a kept place pressed once, then a piece built elsewhere: the second press asks again, keeping nothing", async () => {
    await opened(twoPlans(), 1000);
    setTool("select");
    markStart(27, 19);
    markOver(30, 22);
    markEnd();
    askSave();
    const kept = S.world.blueprints[1];
    press();
    expect(pressedTwice(handSession(), saveKey(1), () => {})).toBe(false);
    const [spot] = clear(1);
    if (!spot) throw new Error("no clear ground");
    expect(doNow({ do: "build", kind: BELT, dir: 0, grade: 1, ...spot })).not.toHaveProperty("refused");
    press();
    expect([asking(saveKey(1)), pressedTwice(handSession(), saveKey(1), () => {}), S.world.blueprints[1]]).toEqual([
      false,
      false,
      kept,
    ]);
  });
});

describe("a plan of the whole yard in hand, by a finger", () => {
  test("is pressed by a tap anywhere on the yard: the first asks, the second puts it back", async () => {
    const { y, saved } = changed();
    await opened(y, 1000);
    S.finger = true;
    setTool("select");
    hold(0);
    press();
    fingerTap(3, 3);
    expect([handPrint().place?.asking, settings(S.world) === saved]).toEqual([true, false]);
    press();
    fingerTap(40, 30);
    expect(settings(S.world)).toBe(saved);
  });
});

describe("what a plan of the whole yard in hand would take up", () => {
  test("is in its picture: the box it is drawn in covers every piece it takes up, however far from what it stands", async () => {
    const { y } = changed();
    const t =
      [...y.kind.keys()].find((i) => refusal(y, WORKSHOP, i % y.land.w, Math.floor(i / y.land.w), Infinity) === null) ??
      0;
    const far = { x: t % y.land.w, y: Math.floor(t / y.land.w) };
    must(y, { do: "build", kind: "workshop", dir: 0, ...far });
    y.history = [];
    await opened(y, 1000);
    setTool("select");
    hold(0);
    const g = S.group;
    if (!g) throw new Error("nothing in hand");
    expect(piecesAt(S.world, g.tiles).map((p) => [kindName(p.kind), p.x, p.y])).toEqual(
      expect.arrayContaining([
        ["bench", 30, 14],
        ["workshop", far.x, far.y],
      ]),
    );
    const box = heldBox(S.world, g);
    const inBox = (x: number, z: number): boolean => x >= box.x && x < box.x + box.w && z >= box.y && z < box.y + box.h;
    expect([inBox(30, 14), inBox(far.x, far.y), inBox(29, 14)]).toEqual([true, true, true]);
  });
});
