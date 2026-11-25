/**
 * A plan of the whole yard on the page, by what the line over the dock prints, against a stand-in
 * Leaf: Save yard keeps the whole yard in a place once the research is known; a plan of it in hand
 * stays where it was taken and shows what it builds, takes up and costs; Place asks twice, or short
 * of Coins says how short and asks nothing; put back and undone alike on the page and on Leaf.
 */
import { describe, expect, test } from "bun:test";

import {
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
  reopen,
  route,
  writeAct,
  type Yard,
} from "@sequoia-leaf/factory";

import { ctx, opened, until, useFakeLeaf } from "../test/fake-leaf.ts";
import { askSaveYard, saveIn } from "./plans.ts";
import { S, toolHooks } from "./state.ts";
import { aimAt, confirm, hold, setTool, unaim, undo } from "./tools.ts";
import { handPrint } from "./ui/dock.ts";
import { differences } from "./yard.ts";

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
    console.log(
      "DBG",
      fake.leaf.reads.length,
      S.tool,
      check(S.world),
      check(fake.leaf.yard),
      S.world.tick,
      fake.leaf.yard.tick,
    );
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
      { cost: -20, asking: false, bad: false },
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
    expect(confirm()).toBe(false);
    expect(handPrint().place?.asking).toBe(true);
    expect(settings(S.world)).not.toBe(saved);
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
    expect(handPrint().place).toEqual({ cost: 20, asking: false, bad: true });
    expect(handPrint().line).toEqual({ text: `Not enough Coins: ${short} short`, bad: true });
    const before = encode(S.world);
    expect(confirm()).toBe(false);
    expect([said, handPrint().place?.asking, encode(S.world)]).toEqual([
      [`Not enough Coins: ${short} short.`],
      false,
      before,
    ]);
  });
});
