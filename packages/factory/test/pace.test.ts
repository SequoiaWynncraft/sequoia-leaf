/**
 * The pace script's parts, each on what it decides by itself: how a line is sized from the planner,
 * which lines a goal needs beyond what stands, that a line the builder lays out delivers what it is
 * booked for (on its own, and split off another), that what the player reads off the yard is what
 * arrives (with a split laid above another, which the builder's booking gets wrong), that a play
 * repeats to the tick and splits every stretch of the clock in three, and what the table makes of a
 * play and of several. The run of the whole slice (`bun pace.ts`) is not a test. Paces and counts are
 * read from the tables.
 */
import { describe, expect, test } from "bun:test";

import { Builder, type Planned, type Source } from "../pace/builder.ts";
import { measure } from "../pace/measure.ts";
import { capacity, one, shortfall, size, type Unit } from "../pace/needs.ts";
import { type Game, type Hands, Player, type Settings } from "../pace/player.ts";
import { type Report, report, seeds, spread } from "../pace/table.ts";
import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

const ones = (): number => 1;
const name = (u: { readonly item: F.Item; readonly kind: F.Kind; readonly count: number }): string =>
  `${u.count} ${F.kindName(u.kind)} ${F.itemName(u.item)}`;
const recipe = (n: F.ItemName): F.Recipe => {
  const r = F.RECIPE[F.item(n)];
  if (!r) throw new Error(`no recipe for ${n}`);
  return r;
};

describe("sizing a line with the planner", () => {
  test("a line at a slow pace is one of each piece, each fed for its share, and makes what its slowest piece lets it flat out", () => {
    const u = size(F.item("frame"), 1, ones);
    expect(name(u)).toBe("1 bench frame");
    expect(u.parts.map((p) => [F.itemName(p.item), p.count, p.perMinute])).toEqual(
      recipe("frame").from.map((n, k) => [F.itemName(n), 1, recipe("frame").need[k] ?? 0]),
    );
    const slowest = Math.min(one(u), ...u.parts.map((p, k) => capacity(p) / (recipe("frame").need[k] ?? 1)));
    expect(capacity(u)).toBe(slowest);
  });

  test("a pace past one machine takes two, each with feeders for its share", () => {
    const each = F.makes(F.MILL, 1, recipe("plank"));
    const u = size(F.item("plank"), 1.5 * each, ones);
    expect(name(u)).toBe("2 mill plank");
    expect(u.parts.map((p) => p.perMinute)).toEqual([(1.5 * each) / 2]);
  });

  test("a recipe's counts are counted: each part of a hamper is fed what the recipe takes of it", () => {
    const u = size(F.item("hamper"), 2, ones);
    expect(u.parts.map((p) => [F.itemName(p.item), p.perMinute])).toEqual(
      recipe("hamper").from.map((n, k) => [F.itemName(n), 2 * (recipe("hamper").need[k] ?? 0)]),
    );
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
/** Whether a pace is within 5% of another. */
const near = (got: number | undefined, booked: number): boolean => Math.abs((got ?? 0) - booked) <= 0.05 * booked;
/** The lines standing after some plans, as the player keeps them. */
const kept = (plans: readonly Planned[]): Source[] => plans.flatMap((p) => p.lines);
/** A line worked out on a copy of a yard, or the builder's reason why not. */
function line(y: F.Yard, u: Unit, lines: readonly Source[] = []): Planned {
  const b = new Builder(y, ones, lines);
  const p = b.depotLine(u);
  if (!p) throw new Error(`no line of ${F.itemName(u.item)}: ${b.why}`);
  return p;
}

describe("a line the builder lays out delivers what it is booked for, within 5%", () => {
  test("a line of frames of its own, from gatherers through mills and a bench to the depot", () => {
    const y = F.create({ tier: 4, seed: 1 });
    const u = size(F.item("frame"), 2, ones);
    const frames = line(y, u);
    expect(frames.rate).toBe(capacity(u));
    build(y, [frames]);
    expect(F.power(y).pace).toBe(1);
    const got = delivered(y, 10)[F.item("frame")];
    expect({ got, near: near(got, frames.rate) }).toEqual({ got, near: true });
  });

  test("a bench fed by splitting a standing line of planks: half of it goes to the bench, the rest still reaches the depot", () => {
    const y = F.create({ tier: 4, seed: 1 });
    const planks = line(y, size(F.item("plank"), F.makes(F.MILL, 1, recipe("plank")), ones));
    build(y, [planks]);
    const tools = line(y, size(F.item("tool"), 1, ones), kept([planks]));
    expect(tools.taps).toEqual([{ source: 0, rate: planks.rate / 2 }]);
    build(y, [tools]);
    const got = delivered(y, 10);
    const pace = { tools: got[F.item("tool")], planks: got[F.item("plank")] };
    expect({ ...pace, near: near(pace.tools, tools.rate) && near(pace.planks, planks.rate - planks.rate / 2) }).toEqual(
      {
        ...pace,
        near: true,
      },
    );
  });
});

/** A run of belts on some tiles of a row, all one way. */
const belts = (xs: readonly number[], z: number, dir: number): Record<string, unknown>[] =>
  xs.map((x) => ({ kind: "belt", x, y: z, dir, span: 0 }));
/** The whole numbers from `a` to `b`. */
const span = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, k) => a + k);

describe("what the player reads off the yard is what arrives, within 5%", () => {
  test("two benches split off one line, the second above the first: each takes half of what reaches it, and the reading says so", () => {
    // A mill fed from a crate, its planks east along row 1 and down into the depot; benches below the
    // line at x 16 and, above it, x 11, each fed ingots from a crate and handing tools onto row 3 home.
    const y = F.create({ land: bareLand(24, 9, [], [20, 5]), tier: 4, seed: 1 });
    must(y, { do: "build", kind: "crate", x: 6, y: 1, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 7, y: 1, dir: 0 });
    must(y, { do: "lay", legs: belts(span(8, 19), 1, 0) });
    must(y, { do: "lay", legs: [1, 2, 3].map((z) => ({ kind: "belt", x: 20, y: z, dir: 1, span: 0 })) });
    must(y, { do: "lay", legs: belts(span(11, 18), 3, 0) });
    must(y, { do: "lay", legs: belts([19], 3, 1) });
    for (const [x, z] of [
      [14, 4],
      [9, 4],
    ] as const)
      must(y, { do: "build", kind: "pylon", x, y: z, dir: 0 });
    for (const x of [16, 11]) {
      must(y, { do: "build", kind: "splitter", x, y: 1, dir: 0 });
      // Its left way (north) shut: half of what reaches it goes right, down into the bench.
      must(y, { do: "way", x, y: 1, way: 1, open: false });
      must(y, { do: "build", kind: "bench", x, y: 2, dir: 1 });
      must(y, { do: "recipe", x, y: 2, item: "tool" });
      must(y, { do: "build", kind: "crate", x: x - 1, y: 2, dir: 0 });
      const ingots = y.row[F.at(y, x - 1, 2)] ?? -1;
      // Enough for the half hour the line is read and then run.
      for (let k = 0; k < 1000; k++) F.put(y.holders, ingots, F.item("ingot"));
    }
    const deadfall = y.row[F.at(y, 6, 1)] ?? -1;
    for (let k = 0; k < 40 * F.makes(F.MILL, 1, recipe("plank")); k++) F.put(y.holders, deadfall, F.item("deadfall"));
    const read = measure(y);
    const arrives = delivered(structuredClone(y), 20);
    const flat = F.makes(F.MILL, 1, recipe("plank"));
    const [plank, tool] = [F.item("plank"), F.item("tool")];
    const seen = { planks: read[plank], tools: read[tool] };
    expect({ ...seen, near: near(read[plank], arrives[plank] ?? 0) && near(read[tool], arrives[tool] ?? 0) }).toEqual({
      ...seen,
      near: true,
    });
    // The split above takes half of the line, the one below half of what is left: a quarter reaches the depot.
    expect([near(read[plank], flat / 4), near(read[tool], (3 * flat) / 4)]).toEqual([true, true]);
  });
});

const HANDS: Hands = { piece: 4, set: 3, run: 4, tile: 0.3, plot: 15, think: 45, read: 15, order: 3 };
const lessons = F.ALL_GOALS.filter((g) => F.GOALS[g]?.kind === "lesson").map((g) => F.GOALS[g]?.id ?? "");
const first: Settings = {
  seed: 3,
  nodes: lessons.slice(0, 2),
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
    const r = report(new Player(first).play(), first.seed, first.folios);
    expect(r.goals.map((g) => g.goal)).toEqual([...first.nodes]);
    for (const g of [...r.goals, r.slice]) expect(g.building + g.coins + g.waiting).toBeCloseTo(g.minutes, 0.5);
    // The first lesson is built from the pieces a new yard has to hand, so nothing waits for Coins.
    expect(r.goals[0]?.coins).toBe(0);
  });
});

/** A goal played, from and to some minutes. */
const played = (goal: F.Goal, came: number, done: number): Game["goals"][number] => ({
  goal,
  came: came * F.MINUTE,
  done: done * F.MINUTE,
  pieces: 0,
  purse: 0,
  power: { gives: 0, draws: 0 },
  bought: new Map(),
});

/** A made-up play: tier 0 opens at 0, tier 1 at 10 minutes when its commission is done, research of tier 0 done at 6 and 15 minutes. */
function madeUp(stuck: string | null = null): Game {
  const research = F.ALL_GOALS.filter((g) => F.GOALS[g]?.kind === "research");
  const node = F.ALL_GOALS.find((g) => F.GOALS[g]?.kind === "lesson") ?? F.goal("planks");
  const r0 = research[0] ?? node;
  const r1 = research[1] ?? node;
  const tier = F.GOALS[r0]?.tier ?? 0;
  const tiers = Array.from({ length: tier + 2 }, (_, t) => (t <= tier ? 0 : 10 * F.MINUTE));
  const left = tiers.map((_, t) => (t === tier + 1 ? 120 : 0));
  return {
    goals: [played(node, 0, 4), played(r0, 0, 6), played(r1, 6, 15)],
    coins: [],
    swaps: 0,
    tiers,
    left,
    end: 15 * F.MINUTE,
    spans: [{ from: 0, to: 15 * F.MINUTE, doing: "wait" }],
    stuck,
  };
}

describe("the table", () => {
  test("a tier runs from when it opened to when its commission was done; research done after is marked and summed on a line of its own", () => {
    const game = madeUp();
    const r = report(game, 1, 12);
    const tier = F.GOALS[game.goals[1]?.goal ?? 0]?.tier ?? 0;
    const row = r.tiers.find((t) => t.tier === tier);
    expect(row && [row.from, row.to, row.minutes, row.done]).toEqual([0, 10, 10, true]);
    expect(r.goals.map((g) => g.after)).toEqual([false, false, true]);
    expect(r.left).toEqual([{ tier, folios: 120, minutes: 5 }]);
    // Stopped short, what research was left is said, and how long it took is not.
    expect(report(madeUp("no way"), 1, 12).left).toEqual([{ tier, folios: 120, minutes: null }]);
  });

  test("several seeds: the least, the middle and the most of each tier, only seeds that finished it counted, and the seeds that stopped short named", () => {
    expect(spread([3, 1, 2, 10])).toEqual({ least: 1, middle: 2.5, most: 10 });
    expect(spread([5, 1, 9])).toEqual({ least: 1, middle: 5, most: 9 });
    const r = report(madeUp(), 1, 12);
    const tier = r.tiers.find((t) => t.done)?.tier ?? 0;
    const as = (seed: number, minutes: number, stuck: string | null): Report => {
      const tiers = [];
      for (const t of r.tiers) tiers.push(t.tier === tier ? { ...t, minutes, done: stuck === null } : t);
      return { ...r, seed, stuck, tiers };
    };
    const s = seeds([as(1, 10, null), as(2, 30, null), as(3, 20, null), as(4, 99, "no way was found\nmap")]);
    const row = s.tiers.find((t) => t.tier === tier);
    expect(row && [row.seeds, row.minutes]).toEqual([3, { least: 10, middle: 20, most: 30 }]);
    expect(s.stuck).toEqual([{ seed: 4, why: "no way was found" }]);
  });
});
