/**
 * Tier 7, the signal (SPEC-2 sections 1 to 3, and section 8's PR 4 row): its tables in the spec's
 * line-hours; star crystal planned from the grower, net, with no star crystal as a part; star crystal
 * from the ground at its own pace; the grower's runs, 1, 2, 1, 2, and its words; a grower fed its own
 * way out, through a plain splitter and through one with the way back put first; how a yard with
 * growers is kept; and Leaf's copy and the page's agreeing across a day away, on a ring with growers.
 */
import { describe, expect, test } from "bun:test";

import { PARTS, unpackCells } from "../src/cells.ts";
import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { give, must } from "./yards.ts";

const CRYSTAL = F.item("crystal");
const FEED = F.item("feed");
const GROWER = F.kind("grower");

/** The grade III line-hours of a goal: each thing it wants, at what one grade III machine of its maker makes of it a minute. */
function lineHours(g: F.Goal): number {
  const want = F.GOALS[g]?.want ?? F.counts();
  return F.ALL_ITEMS.reduce((sum, n) => {
    const count = want[n] ?? 0;
    if (count === 0) return sum;
    const { kind, recipe } = F.makerOf(n);
    return sum + count / F.makes(kind, 3, recipe) / 60;
  }, 0);
}

/** SPEC-2's line-hours of tier 7's goals. */
const HOURS: readonly (readonly [string, number])[] = [
  ["ridgepath", 3.3],
  ["ridgewire", 5.0],
  ["lumps", 0.5],
  ["signal", 4.4],
  ["listening", 40],
  ["counting", 83],
  ["crabminds", 83],
  ["allears", 156],
  ["almanac", 500],
  ["grower", 17],
  ["lattices", 8.3],
  ["starfolio", 33],
  ["dishes", 8.3],
  ["grower2", 14],
  ["grower3", 78],
  ["deepestculvert", 17],
];

/** A bare yard with all of tier 7 known (growers to grade III), the depot's middle at (33, 6), pylons along row 10, star crystal at (6, 7) and (20, 8), ore at (24, 8). */
function yard(tier = 8): F.Yard {
  const land = bareLand(
    38,
    13,
    [
      [6, 7, "crystal"],
      [20, 8, "crystal"],
      [24, 8, "ore"],
    ],
    [33, 6],
  );
  const y = F.create({ land, tier, seed: 1 });
  for (const x of [30, 26, 22, 18, 14, 10, 6, 2]) must(y, { do: "build", kind: "pylon", x, y: 10, dir: 0 });
  return y;
}
/** Builds a piece with its own tile on (x, z) (a 3x3's middle): that tile. */
function piece(y: F.Yard, kind: string, x: number, z: number, grade = 1, dir = 0): number {
  must(y, { do: "build", kind, x, y: z, dir, ...(grade > 1 ? { grade } : {}) });
  return F.at(y, x, z);
}
/** A shut crate on a tile, which holds whatever it is handed: its holder's row. */
function bin(y: F.Yard, x: number, z: number): number {
  must(y, { do: "build", kind: "crate", x, y: z, dir: 0 });
  must(y, { do: "crate", x, y: z, open: false });
  return F.holderOf(y, F.at(y, x, z));
}
/** Puts things into the holder of the piece on a tile, as a line would have handed them in. */
function fill(y: F.Yard, i: number, n: F.Item, count: number): void {
  const r = F.holderOf(y, i);
  for (let k = 0; k < count; k++) F.put(y.holders, r, n);
}
/** Runs a yard on to a tick. */
function until(y: F.Yard, tick: number): void {
  while (y.tick < tick) F.step(y);
}
/** A grower facing east on (6, 5), its way out (7, 5) into a shut crate on (8, 5): the grower's tile and the crate's row. */
function growerIntoBin(y: F.Yard, grade = 1): { g: number; out: number } {
  const g = piece(y, "grower", 6, 5, grade);
  return { g, out: bin(y, 8, 5) };
}

describe("tier 7's tables", () => {
  test("every node and piece of research is in the spec's line-hours, by the planner, within 5%", () => {
    const tier7 = F.ALL_GOALS.filter((g) => F.GOALS[g]?.tier === 7).map((g) => F.GOALS[g]?.id ?? "");
    expect(tier7.toSorted()).toEqual(HOURS.map(([id]) => id).toSorted());
    for (const [id, hours] of HOURS) {
      const got = lineHours(F.goal(id));
      expect([id, Math.abs(got / hours - 1) <= 0.05 ? hours : got]).toEqual([id, hours]);
    }
    expect([F.TIERS[7]?.name, F.SPAN_MOST]).toEqual(["The signal", 32]);
  });

  test("star crystal is planned from the grower: its net, half its runs, from 2 crystal feed each, and no star crystal as a part", () => {
    const { kind, recipe } = F.makerOf(CRYSTAL);
    expect([
      F.kindName(kind),
      recipe?.from.map(F.itemName),
      recipe?.need,
      F.makes(kind, 1, recipe),
      F.makes(kind, 3, recipe),
      F.workOf(CRYSTAL),
    ]).toEqual(["grower", ["feed"], [2], 5, 10, 150]);
    expect([F.kindsMaking(CRYSTAL).map(F.kindName), F.RECIPE[CRYSTAL], F.isRaw(CRYSTAL)]).toEqual([
      ["grower"],
      null,
      true,
    ]);
    // A lattice's tree names a bench on growers and their feed, and wire: no star crystal gathered, and none fed back.
    const tree = F.tree(F.item("lattice"), 60, 3);
    const grown = tree.from.find((t) => t.item === CRYSTAL);
    const kinds = (b: F.Branch): string[] => [F.kindName(b.kind), ...b.from.flatMap(kinds)];
    expect([
      F.kindName(tree.kind),
      grown && F.kindName(grown.kind),
      grown?.count,
      grown?.from.map((t) => [F.itemName(t.item), F.kindName(t.kind)]),
      F.bill(tree).some((b) => b.item === CRYSTAL && b.kind === F.GATHERING),
      kinds(tree).includes("grower"),
    ]).toEqual(["bench", "grower", 12, [["feed", "bench"]], false, true]);
  });

  test("each new recipe is after every older recipe of its machine, and none has parts all found in another's of its machine", () => {
    const fresh = (["feed", "lattice", "star", "dish"] as const).map((n) => F.item(n));
    for (const n of fresh) {
      const r = F.RECIPE[n];
      if (!r) throw new Error(`no recipe for ${F.itemName(n)}`);
      const mine = F.MADE_BY[r.by] ?? [];
      const older = mine.filter((o) => o.out < Math.min(...fresh));
      expect([F.itemName(n), older.every((o) => mine.indexOf(o) < mine.indexOf(r))]).toEqual([F.itemName(n), true]);
      const within = mine.filter((o) => o !== r && r.from.every((part) => o.from.includes(part)));
      expect([F.itemName(n), within.map((o) => F.itemName(o.out))]).toEqual([F.itemName(n), []]);
    }
  });

  test("the board may ask for each of the five, two ways each; a dish, five machines deep, is asked for as a thing four deep is", () => {
    for (const n of ["crystal", "feed", "lattice", "star", "dish"] as const)
      expect([n, F.ASKS[n]?.length]).toEqual([n, 2]);
    expect([F.ITEM_INFO[F.item("dish")]?.step, F.ITEM_INFO[CRYSTAL]?.unsold]).toEqual([5, undefined]);
    // A yard with tier 7 done on land with everything a dish is made of: orders until one wants dishes alone.
    const raws = (["tar", "sand", "salvage", "ore", "deadfall", "stone", "crystal"] as const).map(
      (n, k) => [k, 0, n] as const,
    );
    const y = F.create({ land: bareLand(20, 12, raws, [16, 6]), tier: 8, seed: 3 });
    const dish = F.item("dish");
    const order = Array.from({ length: 400 }, () => F.fresh(y, 3)).find(
      (o) => (o.want[dish] ?? 0) > 0 && F.ALL_ITEMS.every((n) => n === dish || (o.want[n] ?? 0) === 0),
    );
    // Its work is the board's 6,000 and 3,000 a tier, 30,000 at tier 8, at the deepest things' share of
    // 0.4, give or take a fifth: 7 to 11 dishes of 1,340 ticks each (18 to 27 at a whole share).
    const n = order?.want[dish] ?? 0;
    expect([n >= 7 && n <= 11, F.workOf(dish)]).toEqual([true, 1340]);
  });

  test("the board asks for nothing of star crystal where the yard owns no tile of it: a grower needs some to begin", () => {
    // The same land with no star crystal on it.
    const raws = (["tar", "sand", "salvage", "ore", "deadfall", "stone"] as const).map((n, k) => [k, 0, n] as const);
    const y = F.create({ land: bareLand(20, 12, raws, [16, 6]), tier: 8, seed: 3 });
    const made = (["crystal", "lattice", "star", "dish"] as const).map((n) => F.item(n));
    const asked = Array.from({ length: 400 }, () => F.fresh(y, 3)).filter((o) =>
      made.some((m) => (o.want[m] ?? 0) > 0),
    );
    // It makes crystal feed, which needs none, and the board asks for that.
    const feed = F.makeable(y).includes(FEED);
    expect([made.filter((m) => F.makeable(y).includes(m)), asked.length, feed]).toEqual([[], 0, true]);
  });

  test("the deepest culvert lets a tunnel pass under 32 tiles; one under 33 does not read as a command", () => {
    const y = yard();
    expect(y.open.span).toBe(32);
    must(y, F.writeAct({ do: "lay", legs: [{ tunnel: true, x: 0, y: 0, dir: 0, span: 32, grade: 1 }] }));
    expect([y.span[F.at(y, 0, 0)], y.span[F.at(y, 33, 0)]]).toEqual([32, -32]);
    const deeper = F.writeAct({ do: "lay", legs: [{ tunnel: true, x: 0, y: 1, dir: 0, span: 33, grade: 1 }] });
    expect(() => give(y, deeper)).toThrow("does not read");
  });
});

describe("what a grower grows", () => {
  test("names things there are: a misspelt name in GROW or an item's gathering does not type-check", () => {
    const right: F.GrowInfo = { ...F.GROW, gives: "crystal", takes: ["crystal", "feed"] };
    // @ts-expect-error: "crystl" is no thing's name, so a grower cannot be written to give it.
    const wrong: F.GrowInfo = { ...F.GROW, gives: "crystl" };
    // @ts-expect-error: nor to take it.
    const takes: F.GrowInfo = { ...F.GROW, takes: ["crystal", "fed"] };
    expect([F.item(right.gives), right.takes.map(F.item)]).toEqual([CRYSTAL, [CRYSTAL, FEED]]);
    // Written past the type, the name is refused where the tables read it (`item`), never let go.
    expect(() => F.item(wrong.gives)).toThrow("crystl");
    expect(() => takes.takes.map(F.item)).toThrow("fed");
    // An item's own gathering time is kept by its name in the items' table, which names every thing.
    expect([F.ITEM.crystal.gather, F.GATHER_WORK[CRYSTAL], F.GATHER_WORK[F.item("ore")]]).toEqual([1500, 3000, 30]);
  });
});

describe("star crystal from the ground", () => {
  test("a gatherer III gives 1 in 750 ticks, and says so; one on ore gathers as it did", () => {
    const y = yard();
    const g = piece(y, "gatherer", 20, 8, 3);
    const out = bin(y, 21, 8);
    const ore = piece(y, "gatherer", 24, 8, 3);
    bin(y, 25, 8);
    const at = (tick: number): number => {
      until(y, tick);
      return F.held(y.holders, out, CRYSTAL);
    };
    expect([at(749), at(750), at(1499), at(1500)]).toEqual([0, 1, 1, 2]);
    expect([
      F.status(y, g)?.line,
      F.machineRate(y, g).nominal,
      F.status(y, ore)?.line,
      F.machineRate(y, ore).nominal,
    ]).toEqual(["Gathering star crystals: 1 every 75 seconds.", 0.8, "Gathering ore.", 80]);
    const low = yard();
    piece(low, "gatherer", 20, 8);
    expect(F.status(low, F.at(low, 20, 8))?.line).toBe("Gathering star crystals: 1 every 150 seconds.");
  });

  test("short of power, a gatherer's words say the pace its headline does", () => {
    const y = yard();
    const g = piece(y, "gatherer", 20, 8, 3);
    bin(y, 21, 8);
    // Growers III by the depot, drawing more than it gives.
    for (const x of [27, 23, 15, 11]) piece(y, "grower", x, 4, 3);
    const { pace } = F.power(y);
    const rate = F.machineRate(y, g).effective;
    const line = F.status(y, g)?.line ?? "";
    expect([pace < 1, line]).toEqual([
      true,
      `Gathering star crystals: 1 every ${Math.round(60 / rate)} seconds, at ${Math.floor(pace * 100)}% of its pace: the yard is short of power.`,
    ]);
    expect(Math.round(60 / rate)).toBeGreaterThan(75);
  });
});

describe("the grower", () => {
  test("gives 1, 2, 1, 2 over four runs from 4 star crystals and 4 feed, the second of a run a tick after the first", () => {
    const y = yard();
    const { g, out } = growerIntoBin(y);
    fill(y, g, CRYSTAL, 4);
    fill(y, g, FEED, 4);
    const r = F.holderOf(y, g);
    const at = (tick: number): [number, number] => {
      until(y, tick);
      return [F.held(y.holders, out, CRYSTAL), y.holders.mix[r] ?? 0];
    };
    // A run is 60 ticks at grade I; it grows nothing while it holds what it grew.
    expect([at(59), at(60), at(120), at(121), at(181), at(241), at(242), at(2000)]).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 2],
      [4, 1],
      [5, 2],
      [6, 2],
      [6, 2],
    ]);
    expect([F.held(y.holders, r, CRYSTAL), F.held(y.holders, r, FEED)]).toEqual([0, 0]);
  });

  test("takes star crystals and feed on the nine tile-sides of its back and sides, none at its front, 4 of each at most", () => {
    const y = yard();
    const g = piece(y, "grower", 6, 5);
    const sides: string[] = [];
    for (let x = 4; x <= 8; x++)
      for (let z = 3; z <= 7; z++) {
        if (F.pieceOf(y, F.at(y, x, z)) === g) continue;
        const into = [F.at(y, x + 1, z), F.at(y, x - 1, z), F.at(y, x, z + 1), F.at(y, x, z - 1)];
        if (into.some((t) => F.pieceOf(y, t) === g && F.takes(y, t, F.at(y, x, z)))) sides.push(`${x},${z}`);
      }
    expect(sides.toSorted()).toEqual(["4,4", "4,5", "4,6", "5,3", "5,7", "6,3", "6,7", "7,3", "7,7"].toSorted());
    fill(y, g, CRYSTAL, 3);
    const room = (n: F.Item): boolean => F.RULES[GROWER]?.room(F.KIT, y, g, n, 2, F.rewire(y)) ?? false;
    expect([room(CRYSTAL), room(FEED), F.wants(y, g, F.item("plank"))]).toEqual([true, true, false]);
    fill(y, g, CRYSTAL, 1);
    expect(room(CRYSTAL)).toBe(false);
  });

  test("says what it waits for: star crystals, in trouble once it has grown any; feed; room ahead, by its middle way out, unless a full crate there is shut", () => {
    const y = yard();
    const { g, out } = growerIntoBin(y);
    const said = (): [string, boolean] => [F.status(y, g)?.line ?? "", F.status(y, g)?.trouble ?? false];
    const SEEDS = "Waiting for star crystals. It grows 3 from every 2: send 2 of every 3 back into it.";
    fill(y, g, FEED, 2);
    F.step(y);
    expect(said()).toEqual([SEEDS, false]);
    fill(y, g, CRYSTAL, 1);
    F.step(y);
    expect(said()).toEqual(["Growing star crystals.", false]);
    until(y, 100);
    expect([F.held(y.holders, out, CRYSTAL), ...said()]).toEqual([1, SEEDS, true]);
    const fed = yard();
    const other = piece(fed, "grower", 6, 5);
    fill(fed, other, CRYSTAL, 2);
    F.step(fed);
    expect(F.status(fed, other)?.line).toBe("Waiting for crystal feed.");
    // A full crate ahead that is shut will never take more: stopped, in trouble. Opened, it lets things
    // out onto nothing and still has no room, but may: waiting, not in trouble.
    fill(y, F.at(y, 8, 5), CRYSTAL, y.open.crate - 1);
    fill(y, g, CRYSTAL, 2);
    until(y, 400);
    const shut = said();
    must(y, { do: "crate", x: 8, y: 5, open: true });
    expect([shut, said()]).toEqual([
      ["Stopped: its star crystals cannot leave by its middle way out. It grows nothing more until they do.", true],
      ["Waiting: no room ahead for its star crystals, by its middle way out.", false],
    ]);
  });

  test("holds what it grew with nowhere ahead: stopped, in trouble, by its middle way out; the one reading of it agrees", () => {
    const y = yard();
    const g = piece(y, "grower", 6, 5, 3);
    fill(y, g, CRYSTAL, 4);
    fill(y, g, FEED, 4);
    until(y, 40);
    expect(F.status(y, g)).toEqual({
      state: "blocked",
      trouble: true,
      line: "Stopped: its star crystals cannot leave by its middle way out. It grows nothing more until they do.",
      stuck: CRYSTAL,
    });
    // Held: its seeds and what it grew, 1 from a new one's first run.
    expect(F.growthAt(y, F.at(y, 5, 4))).toEqual({ crystals: 4, ready: 1, grown: true, lacks: [] });
  });

  test("what it gives a minute, as every screen says it: 10, 15 and 20 runs at its grades, 3 star crystals for every 2, 1 feed a run", () => {
    for (const grade of [1, 2, 3]) {
      const y = yard();
      const { g } = growerIntoBin(y, grade);
      fill(y, g, CRYSTAL, 2);
      fill(y, g, FEED, 2);
      const made = F.counts();
      const needed = F.counts();
      F.flow(y, made, needed);
      const runs = F.machineRate(y, g).effective;
      expect([grade, runs, made[CRYSTAL], needed[CRYSTAL], needed[FEED]]).toEqual([
        grade,
        [10, 15, 20][grade - 1],
        runs * 1.5,
        runs,
        runs,
      ]);
    }
  });
});

/**
 * A grower III fed its own way out: facing east on (6, 5), fed crystal feed from a crate on its west
 * and a trickle of star crystals from a gatherer on the ground to its south; its way out into a
 * splitter on (8, 5), whose left way goes round on three belts into its north side and whose way
 * ahead spills into a shut crate on (9, 5). With `first`, the way back is put first.
 */
function looped(first: boolean): { y: F.Yard; g: number; spill: number; back: number[] } {
  const y = yard();
  must(y, { do: "build", kind: "crate", x: 4, y: 5, dir: 0 });
  fill(y, F.at(y, 4, 5), FEED, y.open.crate);
  const g = piece(y, "grower", 6, 5, 3);
  piece(y, "gatherer", 6, 7, 1, 3);
  piece(y, "splitter", 8, 5, 3);
  const back = [piece(y, "belt", 8, 4, 3, 3), piece(y, "belt", 8, 3, 3, 2), piece(y, "belt", 7, 3, 3, 1)];
  const spill = bin(y, 9, 5);
  if (first) must(y, { do: "first", x: 8, y: 5, way: 1 });
  fill(y, g, CRYSTAL, 4);
  return { y, g, spill, back };
}

describe("a grower fed its own way out", () => {
  test("through a plain splitter, half back, runs down to the trickle's pace: 3 for each one the ground gives", () => {
    const { y, g, spill } = looped(false);
    until(y, 15 * F.MINUTE);
    const from = F.held(y.holders, spill, CRYSTAL);
    let starved = 0;
    while (y.tick < 45 * F.MINUTE) {
      F.step(y);
      if (F.growthAt(y, g).lacks.includes(CRYSTAL)) starved++;
    }
    const got = F.held(y.holders, spill, CRYSTAL) - from;
    // The gatherer gives 1 in 1,500 ticks: 12 in 30 minutes, from which the loop makes 36. Flat out it would net 300.
    expect([got, starved > 0.9 * 30 * F.MINUTE]).toEqual([36, true]);
  });

  test("through a splitter with the way back first, fills its loop and spills its net and the trickle", () => {
    const { y, g, spill, back } = looped(true);
    until(y, 15 * F.MINUTE);
    const from = F.held(y.holders, spill, CRYSTAL);
    until(y, 45 * F.MINUTE);
    const got = F.held(y.holders, spill, CRYSTAL) - from;
    // 20 runs a minute net 10, and the ground's 0.4. A run that gives 2 holds the second until the
    // splitter has passed the first on (2 ticks at grade III), and grows nothing meanwhile: 2 runs in 62
    // ticks, not 60, so 9.7 net.
    expect([got >= 288 && got <= 312, back.every((i) => y.item[i] === CRYSTAL)]).toEqual([true, true]);
    expect(F.growthAt(y, g).crystals).toBeGreaterThanOrEqual(4);
  });
});

describe("a yard with tier 7's pieces", () => {
  test("is kept as the version the Leaf of version 10 leaves alone, reads back as itself, and its growers keep their place in their runs", () => {
    const y = yard();
    const { g } = growerIntoBin(y);
    fill(y, g, CRYSTAL, 4);
    fill(y, g, FEED, 4);
    until(y, 121);
    const r = F.holderOf(y, g);
    expect([y.holders.mix[r], y.holders.out[r], y.holders.more[r]]).toEqual([2, F.NONE, 0]);
    until(y, 180);
    const text = F.encode(y);
    expect([JSON.parse(text).v, F.pastTen(y)]).toEqual([F.VERSION, true]);
    const back = F.decode(text, y.land);
    if (!back) throw new Error("the yard does not read back");
    expect([F.check(back), back.holders.mix[F.holderOf(back, g)]]).toEqual([F.check(y), 2]);
    // Its place is kept in the part a piece's place in a mix has been kept in since tier 5 (`MIX`, in
    // `PARTS`, which every reader since knows): no part of a piece is new.
    const cells = unpackCells(F.fromBase64(String(JSON.parse(text).cells)) ?? new Uint8Array(), y.land.w * y.land.h);
    const kept = Array.isArray(cells) ? cells.find((p) => p.kind === GROWER) : undefined;
    expect([kept?.mix, (PARTS & 0x20000) !== 0]).toEqual([2, true]);
    // Both copies run on to the same yard.
    until(y, 400);
    until(back, 400);
    expect(F.check(back)).toBe(F.check(y));
  });

  test("a grower moved keeps its place; a copy of it starts new, its first run giving 1", () => {
    const y = yard();
    const { g } = growerIntoBin(y);
    fill(y, g, CRYSTAL, 1);
    fill(y, g, FEED, 1);
    until(y, 60);
    expect(y.holders.mix[F.holderOf(y, g)]).toBe(1);
    must(y, { do: "move", tiles: F.within(y, 5, 4, 7, 6), turns: 0, x: 15, y: 5 });
    // Moved by its box's corner, (5, 4) to (15, 5): its own tile is (16, 6).
    const moved = F.at(y, 16, 6);
    expect([F.kindAt(y, 16, 6), y.holders.mix[F.holderOf(y, moved)]]).toEqual([GROWER, 1]);
    must(y, { do: "copy", tiles: F.within(y, 15, 5, 17, 7), turns: 0, x: 22, y: 5 });
    expect([F.kindAt(y, 23, 6), y.holders.mix[F.holderOf(y, F.at(y, 23, 6))]]).toEqual([GROWER, 0]);
  });
});
