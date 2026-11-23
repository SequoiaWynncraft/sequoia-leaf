/**
 * The pace script's parts, each on what it decides by itself: how a line is sized from the planner,
 * which lines a goal needs beyond what stands, that a line the builder lays out delivers what it is
 * booked for (on its own, and split off another), and that a play repeats to the tick and splits
 * every stretch of the clock in three. The run of the whole slice (`bun pace.ts`) is not a test.
 */
import { describe, expect, test } from "bun:test";

import { Builder, type Planned, type Source } from "../pace/builder.ts";
import { capacity, shortfall, size } from "../pace/needs.ts";
import { type Hands, Player, type Settings } from "../pace/player.ts";
import { report } from "../pace/table.ts";
import * as F from "../src/index.ts";
import { must } from "./yards.ts";

const ones = (): number => 1;
const name = (u: { readonly item: F.Item; readonly kind: F.Kind; readonly count: number }): string =>
  `${u.count} ${F.kindName(u.kind)} ${F.itemName(u.item)}`;

describe("sizing a line with the planner", () => {
  test("a line of frames at 6 a minute is one of each piece, and makes 30 a minute flat out", () => {
    const u = size(F.item("frame"), 6, ones);
    expect(name(u)).toBe("1 bench frame");
    expect(u.parts.map(name)).toEqual(["1 mill plank", "1 mill brick"]);
    expect(u.parts.map((p) => p.parts.map(name))).toEqual([["1 gatherer deadfall"], ["1 gatherer stone"]]);
    expect(capacity(u)).toBe(30);
  });

  test("a pace past one machine takes two, each with feeders for its share: 60 planks a minute is two mills, each fed by one gatherer at 30", () => {
    const u = size(F.item("plank"), 60, ones);
    expect(name(u)).toBe("2 mill plank");
    expect(u.parts.map((p) => [name(p), p.perMinute])).toEqual([["1 gatherer deadfall", 30]]);
    // Each mill is held to its one gatherer's 40.
    expect(capacity(u)).toBe(80);
  });

  test("a hamper's two planks are counted: 30 hampers a minute need 60 planks, two mills", () => {
    const u = size(F.item("hamper"), 30, ones);
    expect(u.parts.map(name)).toEqual(["2 mill plank", "1 mill pot"]);
  });
});

describe("which lines a goal needs beyond what stands", () => {
  const want = F.countsOf({ plank: 60, frame: 30 });

  test("with nothing standing, a line for each thing wanted, at the pace that fills it in the minutes given", () => {
    const units = shortfall(want, null, 5, [], ones);
    expect(units.map((u) => [F.itemName(u.item), u.perMinute])).toEqual([
      ["plank", 12],
      ["frame", 6],
    ]);
  });

  test("a thing a standing line already brings fast enough needs no line", () => {
    const units = shortfall(want, null, 5, [{ item: F.item("plank"), rate: 40 }], ones);
    expect(units.map((u) => F.itemName(u.item))).toEqual(["frame"]);
  });

  test("a thing standing lines bring too slowly needs a line for the difference, and what has been given counts", () => {
    const got = F.countsOf({ frame: 10 });
    const units = shortfall(want, got, 5, [{ item: F.item("frame"), rate: 1 }], ones);
    expect(units.map((u) => [F.itemName(u.item), u.perMinute])).toEqual([
      ["plank", 12],
      ["frame", 3],
    ]);
  });
});

/** Gives a yard the commands of lines worked out on a copy of it, as the player does. */
function build(y: F.Yard, plans: readonly Planned[]): void {
  for (const p of plans) for (const c of p.cmds) must(y, c);
}
/** What reached the depot a minute over `minutes`, after three minutes for the line to fill. */
function delivered(y: F.Yard, minutes: number): F.Counts {
  for (let k = 0; k < 3 * F.MINUTE; k++) F.step(y);
  const before = Float64Array.from(y.depot);
  for (let k = 0; k < minutes * F.MINUTE; k++) F.step(y);
  return Float64Array.from(y.depot, (n, k) => (n - (before[k] ?? 0)) / minutes);
}
/** Whether a pace is within 5% of what it is booked for. */
const near = (got: number | undefined, booked: number): boolean => Math.abs((got ?? 0) - booked) <= 0.05 * booked;
/** The lines standing after some plans, as the player keeps them. */
const kept = (plans: readonly Planned[]): Source[] => plans.flatMap((p) => p.lines);

describe("a line the builder lays out delivers what it is booked for, within 5%", () => {
  test("a line of frames of its own, from gatherers through mills and a bench to the depot", () => {
    const y = F.create({ tier: 4, seed: 1 });
    const b = new Builder(y, ones, []);
    const line = b.depotLine(size(F.item("frame"), 20, ones));
    if (!line) throw new Error(`no line: ${b.why}`);
    expect(line.rate).toBe(30);
    build(y, [line]);
    expect(F.power(y).pace).toBe(1);
    const got = delivered(y, 10)[F.item("frame")];
    expect({ got, near: near(got, line.rate) }).toEqual({ got, near: true });
  });

  test("a bench fed by splitting a standing line of planks: half of it goes to the bench, the rest still reaches the depot", () => {
    const y = F.create({ tier: 4, seed: 1 });
    const planks = new Builder(y, ones, []).depotLine(size(F.item("plank"), 40, ones));
    if (!planks) throw new Error("no line of planks");
    build(y, [planks]);
    const b = new Builder(y, ones, kept([planks]));
    const tools = b.depotLine(size(F.item("tool"), 10, ones));
    if (!tools) throw new Error(`no line of tools: ${b.why}`);
    expect(tools.taps).toEqual([{ source: 0, rate: 20 }]);
    expect(tools.rate).toBe(20);
    build(y, [tools]);
    const got = delivered(y, 10);
    const pace = { tools: got[F.item("tool")], planks: got[F.item("plank")] };
    expect({ ...pace, near: near(pace.tools, 20) && near(pace.planks, planks.rate - 20) }).toEqual({
      ...pace,
      near: true,
    });
  });
});

const HANDS: Hands = { piece: 4, set: 3, run: 4, tile: 0.3, plot: 15, think: 45, read: 15, order: 3 };
const first: Settings = {
  seed: 3,
  nodes: ["planks", "ingots"],
  research: [],
  minutes: [3],
  folios: 12,
  hands: HANDS,
  grades: {},
  swap: 30,
  purse: 0,
};

describe("a play", () => {
  test("the same seed and settings play the same, to the tick", () => {
    const a = new Player(first).play();
    const b = new Player(first).play();
    expect(a.stuck).toBeNull();
    expect(a.goals.map((g) => [g.goal, g.came, g.done, g.purse])).toEqual(
      b.goals.map((g) => [g.goal, g.came, g.done, g.purse]),
    );
    expect(a.end).toBe(b.end);
  });

  test("every tick of a goal's time is building, waiting for Coins or waiting for deliveries, and nothing twice", () => {
    const r = report(new Player(first).play(), first.seed);
    expect(r.goals.map((g) => g.goal)).toEqual(["planks", "ingots"]);
    for (const g of [...r.goals, r.slice]) expect(g.building + g.coins + g.waiting).toBeCloseTo(g.minutes, 0.5);
    // The first lesson is built from the pieces a new yard has to hand, so nothing waits for Coins.
    expect(r.goals[0]?.coins).toBe(0);
  });
});
