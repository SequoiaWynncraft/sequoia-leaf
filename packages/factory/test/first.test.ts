/**
 * A yard kept by the Works' first design reads back as a new yard at the tier its story had
 * reached, no further than tier 2, with the plots it owned that the tier sells, its pieces where the
 * tier lets them stand, what cannot be its own yet paid back, and its totals (and so its place on
 * the board); what its pieces held, its orders and its blueprints are let go.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";

const ALL_PLOTS = ["yard", "meadow", "bank", "stream", "grove", "hollow", "seam", "quarry", "pond"];
const W = F.LAND.w;
/** A tile on the guild's land, by where it is. */
const tile = (x: number, z: number): number => z * W + x;

/**
 * Pieces as the first design kept them, all on the yard's own plot and of kinds tier 2 builds: the
 * free gatherer on the deadfall north-west of the depot, a mill set to planks beside it, a belt that
 * was carrying a log on a painted line, a tunnel under two tiles, and a shut crate.
 */
const PIECES = [
  { i: tile(20, 15), k: "gatherer", d: 0, g: 1 },
  { i: tile(21, 15), k: "mill", d: 0, r: "plank", it: "log", p: 1, v: 2, b: { log: 3 }, w: 4 },
  { i: tile(22, 15), k: "belt", d: 0, it: "log", p: 3, v: 2, h: 3 },
  { i: tile(18, 21), k: "tunnel", d: 0, s: 2 },
  { i: tile(21, 21), k: "tunnel", d: 0, s: -2 },
  { i: tile(28, 14), k: "crate", d: 1, c: 1 },
];

/** A yard as the first design kept it: the fields it wrote, with `PIECES` (or those given), filled to `story` of its twenty story orders. */
function first(story: number, plots: readonly string[] = ["yard"], cells: readonly object[] = PIECES): string {
  return JSON.stringify({
    v: 3,
    seed: 77,
    tick: 5000,
    at: 1_763_900_000_000,
    till: 40,
    bank: 12,
    told: story,
    seen: { tick: 4000, till: 0, depot: { plank: 30 } },
    plots,
    plans: ["boiler"],
    story,
    filled: { plank: 3 },
    board: [{ id: 4, want: { plank: 10 }, filled: { plank: 2 }, pay: 60 }],
    serial: 5,
    done: 3,
    swapAt: 0,
    depot: { plank: 300, ingot: 120 },
    given: {},
    sold: 16_567.419,
    paid: 40_230,
    pace: { ticks: 0, warm: 0, made: {} },
    cells,
  });
}

/** Goals by their names. */
const ids = (gs: readonly F.Goal[]): (string | undefined)[] => gs.map((g) => F.GOALS[g]?.id);

const read = (text: string): F.Yard => {
  const y = F.decode(text);
  if (!y) throw new Error("the first design's yard does not read");
  return y;
};

describe("a yard kept by the first design", () => {
  test("begins the tier its story had reached: tier 0 before the fourth order, 1 from it, 2 from the tenth and to the end", () => {
    const tiers = [0, 3, 4, 9, 10, 14, 20].map((story) => read(first(story)).open.tier);
    expect(tiers).toEqual([0, 0, 1, 1, 2, 2, 2]);
  });

  test("has every goal below its tier done, as a new yard of that tier has, and nothing else of the first design", () => {
    const y = read(first(20));
    const fresh = F.create({ seed: 77, tier: 2 });
    expect([y.done, y.hand]).toEqual([fresh.done, fresh.hand]);
    // The depot's books begin again.
    expect(F.ALL_ITEMS.every((n) => (y.depot[n] ?? 0) === 0)).toBe(true);
  });

  test("stands its pieces where they stood and as they were set, but empty", () => {
    const y = read(first(20));
    const at = (x: number, z: number) => {
      const i = F.at(y, x, z);
      return [F.KIND_INFO[y.kind[i] ?? F.NONE]?.name, y.dir[i], y.item[i]];
    };
    expect([at(20, 15), at(21, 15), at(22, 15)]).toEqual([
      ["Gatherer", 0, F.NONE],
      ["Mill", 0, F.NONE],
      ["Belt", 0, F.NONE],
    ]);
    expect(F.ITEM_INFO[y.set[F.at(y, 21, 15)] ?? F.NONE]?.name).toBe("Plank");
    // The belt's line's colour, both mouths of the tunnel, and the crate, shut.
    expect(y.tint[F.at(y, 22, 15)]).toBe(3);
    expect([y.span[F.at(y, 18, 21)], y.span[F.at(y, 21, 21)]]).toEqual([2, -2]);
    const crate = F.at(y, 28, 14);
    expect([y.kind[crate] === F.CRATE, y.holders.open[F.holderOf(y, crate)]]).toEqual([true, 0]);
    // The gatherer was one of those to hand: the yard has one fewer to hand, and nothing to pay back.
    expect(y.spare[F.GATHERER]).toBe((F.create({ tier: 2 }).spare[F.GATHERER] ?? 0) - 1);
    expect(y.till).toBe(40 * F.MILLI);
  });

  test("has each project of its tier done that opens a kind it had standing, and no other", () => {
    const boiler = { i: tile(28, 20), k: "boiler", d: 0 };
    const tunnel = [
      { i: tile(18, 21), k: "tunnel", d: 0, s: 2 },
      { i: tile(21, 21), k: "tunnel", d: 0, s: -2 },
    ];
    const y = read(first(6, ["yard"], [boiler, ...tunnel]));
    // Tier 1: its boiler and its tunnel stand, by the projects that open them; crates were not its.
    expect(ids(y.done).filter((id) => !ids(F.create({ tier: 1 }).done).includes(id))).toEqual(["boiler", "culvert"]);
    expect([y.kind[F.at(y, 28, 20)], y.kind[F.at(y, 18, 21)]]).toEqual([F.BOILER, F.TUNNEL]);
    // Nothing is said of them as newly done, and the node in hand is one still to do.
    expect(y.told).toBe(y.done.length);
    expect(y.hand !== -1 && !y.done.includes(y.hand)).toBe(true);
  });

  test("pays back, into its till, each piece its tier does not let stand: a kind not opened, or on a plot not its own", () => {
    const y0 = F.create({ tier: 2 });
    expect(F.locked(y0.open, { build: F.WORKSHOP })).not.toBeNull();
    const grove = F.LAND.plots.find((p) => F.plotName(p.plot) === "grove");
    if (!grove) throw new Error("no grove");
    const refused = [
      { i: tile(28, 20), k: "workshop", d: 0 },
      { i: tile(grove.x + 4, grove.y + 6), k: "belt", d: 1 },
    ];
    const y = read(first(20, ["yard"], [...PIECES, ...refused]));
    expect(y.kind[F.at(y, 28, 20)]).toBe(F.NONE);
    expect(y.kind[F.at(y, grove.x + 4, grove.y + 6)]).toBe(F.NONE);
    expect(y.till).toBe((40 + F.price(F.WORKSHOP, 1) + F.price(F.BELT, 1)) * F.MILLI);
  });

  test("owns again each plot it owned that its tier sells, and only those", () => {
    const y = read(first(20, ALL_PLOTS));
    const owned = y.plots.map(F.plotName);
    expect(owned.length).toBeGreaterThan(1);
    expect(owned.every((name) => ALL_PLOTS.includes(name))).toBe(true);
    // Nothing it owned is still for sale: every plot it could take, it took.
    for (const plot of F.LAND.plots) {
      const name = F.plotName(plot.plot);
      if (!owned.includes(name)) expect([name, F.plotState(y, plot.plot).state === "for sale"]).toEqual([name, false]);
    }
    // A yard at the fourth order owns what tier 1 sells of them, which is less.
    expect(read(first(4, ALL_PLOTS)).plots.length).toBeLessThan(owned.length);
  });

  test("is paid back, into its till, what the plots its tier does not sell yet would cost again, and is not told it earned it", () => {
    const y = read(first(20, ALL_PLOTS));
    const unsold = F.LAND.plots.filter((p) => !y.plots.includes(p.plot));
    expect(unsold.length).toBeGreaterThan(0);
    expect(y.till).toBe((40 + unsold.reduce((sum, p) => sum + p.price, 0)) * F.MILLI);
    expect(F.postcard(y).till).toBe(y.till / F.MILLI);
    // The letter for time away counts only what the till gains from here.
    expect(y.seen.till).toBe(y.till);
    expect(read(first(20, ["yard"])).till).toBe(40 * F.MILLI);
  });

  test("keeps what it was paid, what it sold and the side orders it handed over, and so its score on the board", () => {
    const y = read(first(20));
    expect(F.FACTORY.standing?.(y)).toEqual({ score: 56_797, also: { tier: 2 } });
    expect(y.handed).toBe(3);
  });

  test("is kept and read back as a yard of this design, the same", () => {
    const y = read(first(14, ALL_PLOTS));
    const text = F.encode(y);
    expect(F.encode(read(text))).toBe(text);
    expect(F.check(read(text))).toBe(F.check(y));
  });

  test("counts its Coins entries on from where it was, so that none is named as one already made", () => {
    expect(read(first(20)).bank).toBe(12);
  });

  test("keeps what its till held, not yet paid in", () => {
    const raw: Record<string, unknown> = JSON.parse(first(20));
    expect(read(JSON.stringify({ ...raw, till: 40.75 })).till).toBe(40_750);
  });

  test("with its story, its totals or its count of Coins entries missing, is not a yard", () => {
    const raw: Record<string, unknown> = JSON.parse(first(20));
    for (const field of ["story", "paid", "sold", "plots", "bank"]) {
      expect(F.decode(JSON.stringify({ ...raw, [field]: undefined }))).toBeNull();
    }
    expect(F.decode(JSON.stringify({ ...raw, story: -1 }))).toBeNull();
  });
});
