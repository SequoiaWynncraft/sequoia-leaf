/**
 * The land tier 4's commission puts up for sale (SPEC-2, section 4): the 40 plots of the second and
 * third rings round today's nine, as the spec's table and its rows of letters have them; the price
 * rule (every plot of them owned makes every one still to buy 15% dearer); and tier 5's first two
 * projects, which pay toward the first of them.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { give, must, SAVES } from "./yards.ts";

type Holds = Partial<Record<"d" | "s" | "o" | "c" | "a" | "r" | "v" | "t" | "q" | "~", number>>;
/** SPEC-2's table of the 40 plots: id, column, row, ring, base price, what it holds (by letter), redwoods, clear tiles. */
const TABLE: readonly (readonly [F.PlotName, number, number, number, number, Holds, number, number])[] = [
  ["workings", 0, 2, 2, 100_000, { t: 12, v: 10 }, 1, 166],
  ["ridge", 0, -2, 2, 160_000, { v: 43, s: 9 }, 2, 132],
  ["blackbank", -2, 0, 2, 170_000, { t: 45, d: 8 }, 2, 131],
  ["flats", -1, 2, 2, 200_000, { d: 7 }, 1, 181],
  ["weir", 1, 2, 2, 140_000, { "~": 36, a: 25, c: 9 }, 1, 118],
  ["narrows", 1, -2, 2, 130_000, { "~": 27, o: 26, r: 8 }, 2, 123],
  ["stand", -1, -2, 2, 110_000, { r: 20, d: 15 }, 6, 133],
  ["farbank", 2, 0, 2, 150_000, { a: 29, c: 13 }, 1, 146],
  ["ironhill", 2, -1, 2, 150_000, { o: 58, s: 17 }, 1, 113],
  ["reeds", 2, 1, 2, 120_000, { "~": 51, c: 15 }, 0, 126],
  ["ferns", -2, -1, 2, 115_000, { d: 56, t: 8 }, 3, 116],
  ["marl", -2, 1, 2, 120_000, { c: 43, s: 17 }, 1, 128],
  ["darkwood", -2, -2, 2, 180_000, { t: 30, r: 6 }, 5, 136],
  ["scree", 2, -2, 2, 190_000, { s: 62, o: 13, v: 8 }, 0, 109],
  ["acre", -2, 2, 2, 240_000, { a: 7 }, 2, 177],
  ["mere", 2, 2, 2, 170_000, { "~": 61, a: 13 }, 0, 118],
  ["skyfall", 0, 3, 3, 220_000, { q: 4 }, 2, 180],
  ["common", -1, 3, 3, 480_000, { d: 9 }, 1, 179],
  ["ford", 1, 3, 3, 340_000, { "~": 26, a: 26, q: 3 }, 0, 137],
  ["heath", -2, 3, 3, 420_000, { q: 2 }, 3, 178],
  ["shallows", 2, 3, 3, 360_000, { "~": 66, c: 20 }, 0, 106],
  ["greatmere", 3, 3, 3, 800_000, { "~": 114, a: 8 }, 0, 70],
  ["glasswood", -3, 3, 3, 1_000_000, { q: 8 }, 5, 164],
  ["quartz", -3, 2, 3, 520_000, { s: 20, q: 6 }, 2, 158],
  ["claypits", -3, 1, 3, 320_000, { c: 56, s: 10 }, 0, 126],
  ["westfield", -3, 0, 3, 500_000, {}, 2, 184],
  ["tangle", -3, -1, 3, 320_000, { d: 54, r: 10 }, 4, 112],
  ["burn", -3, -2, 3, 460_000, { d: 27, t: 10 }, 0, 155],
  ["deepwood", -3, -3, 3, 700_000, { t: 41, r: 6 }, 9, 109],
  ["colliers", -2, -3, 3, 380_000, { t: 35, d: 17 }, 3, 128],
  ["windbreak", -1, -3, 3, 320_000, { d: 27, t: 11 }, 4, 138],
  ["highridge", 0, -3, 3, 460_000, { v: 38, s: 10 }, 1, 140],
  ["spring", 1, -3, 3, 340_000, { "~": 26, o: 10, q: 3 }, 1, 149],
  ["tarn", 2, -3, 3, 480_000, { s: 26, "~": 24, q: 3 }, 0, 139],
  ["crater", 3, -3, 3, 1_200_000, { q: 12 }, 0, 180],
  ["rim", 3, -2, 3, 600_000, { s: 24, q: 4 }, 1, 160],
  ["eastfell", 3, -1, 3, 400_000, { o: 59, v: 19 }, 0, 114],
  ["pan", 3, 0, 3, 560_000, { a: 22 }, 0, 170],
  ["claymarsh", 3, 1, 3, 340_000, { c: 41, "~": 28 }, 0, 123],
  ["dunes", 3, 2, 3, 420_000, { a: 66, q: 2 }, 0, 124],
];

/** A plot of the plots table, by id. */
function info(id: F.PlotName): F.PlotInfo {
  const p = F.PLOTS.find((q) => q.id === id);
  if (!p) throw new Error(`no plot ${id}`);
  return p;
}
/** A plot as it lies on the guild's land, by id. */
function plotted(id: F.PlotName): F.Plotted {
  const p = F.LAND.plots.find((q) => q.plot === F.plot(id));
  if (!p) throw new Error(`no plot ${id} on the land`);
  return p;
}
/** How many of each letter a plot's rows hold. */
function letters(rows: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) for (const c of row) out.set(c, (out.get(c) ?? 0) + 1);
  return out;
}
/** A yard past tier 4's commission that owns today's nine plots, as the yards that have finished tier 4 do. */
function nine(): F.Yard {
  const y = F.create({ seed: 3, tier: 5 });
  for (let more = true; more;) {
    const p = F.LAND.plots.find((q) => q.ring === 1 && F.plotState(y, q.plot).state === "for sale");
    more = p !== undefined;
    if (p) must(y, { do: "buyPlot", plot: F.plotName(p.plot) });
  }
  return y;
}
/** Buys a plot with Coins enough, and gives what it cost. */
function buy(y: F.Yard, id: F.PlotName): number {
  const spent = F.buyPlot(y, F.plot(id), Infinity);
  if (!spent.ok) throw new Error(spent.why);
  return spent.cost;
}
/** What a plot costs a yard now. */
const priceIn = (y: F.Yard, id: F.PlotName): number => F.plotPrice(y, F.plot(id));
/** The redwoods on a plot. */
const treesOn = (id: F.PlotName): (readonly number[])[] =>
  F.LAND.trees.filter((tiles) => F.LAND.plots[F.LAND.plot[tiles[0] ?? 0] ?? F.NONE]?.plot === F.plot(id));

describe("the 40 plots", () => {
  test("are the spec's: each in its place and ring, at its base price, with its letters holding what the table says", () => {
    expect(TABLE.map(([id]) => id)).toEqual([...F.OUTER_IDS]);
    for (const [id, col, row, ring, price, holds, redwoods, clear] of TABLE) {
      const p = info(id);
      expect([id, p.col, p.row, plotted(id).ring, p.price]).toEqual([id, col, row, ring, price]);
      expect([id, p.rows.length, p.rows.every((r) => r.length === F.PLOT_W)]).toEqual([id, F.PLOT_H, true]);
      const n = letters(p.rows);
      const held = Object.fromEntries([...n].filter(([c]) => c !== "." && c !== "T"));
      expect([id, held]).toEqual([id, holds]);
      const trees = treesOn(id);
      expect([id, trees.length, trees.every((t) => t.length === 4), n.get("T") ?? 0]).toEqual([
        id,
        redwoods,
        true,
        4 * redwoods,
      ]);
      expect([id, n.get(".") ?? 0]).toEqual([id, clear]);
    }
  });

  test("make the land seven plots by seven, the yard plot in the middle, with 66 more redwoods: 75", () => {
    expect([F.LAND.w, F.LAND.h, F.LAND.plots.length]).toEqual([7 * F.PLOT_W, 7 * F.PLOT_H, 49]);
    expect(F.LAND.origin).toEqual([3 * F.PLOT_W, 3 * F.PLOT_H]);
    expect(F.LAND.depot).toEqual([3 * F.PLOT_W + 8, 3 * F.PLOT_H + 6]);
    expect(F.LAND.trees.length).toBe(75);
    expect([1, 2, 3].map((ring) => F.LAND.plots.filter((p) => p.ring === ring).length)).toEqual([8, 16, 24]);
  });

  test("salvage, tar and star crystal lie in the ground as the tables have them, and until then are clear ground", () => {
    const names = { v: "salvage", t: "tar", q: "crystal" } as const;
    let tiles = 0;
    for (const p of F.LAND.plots) {
      const rows = info(F.plotName(p.plot)).rows;
      for (let z = 0; z < p.h; z++)
        for (let x = 0; x < p.w; x++) {
          const c = rows[z]?.[x] ?? ".";
          if (c !== "v" && c !== "t" && c !== "q") continue;
          tiles++;
          expect(F.LAND.deposit[(p.y + z) * F.LAND.w + p.x + x]).toBe(F.itemNamed(names[c]) ?? F.NONE);
        }
    }
    // 118 of salvage, 192 of tar and 47 of star crystal (SPEC-2's table).
    expect(tiles).toBe(118 + 192 + 47);
  });

  test("the stream runs on across every edge between plots: water at a plot's edge has water across it, on that tile or the next", () => {
    const L = F.LAND;
    const wet = (x: number, z: number): boolean => x >= 0 && z >= 0 && x < L.w && z < L.h && L.water[z * L.w + x] === 1;
    const plotAt = (x: number, z: number): number => L.plot[z * L.w + x] ?? F.NONE;
    for (let z = 0; z < L.h; z++)
      for (let x = 0; x < L.w; x++) {
        if (!wet(x, z)) continue;
        for (const [dx, dz] of [
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ] as const) {
          const [nx, nz] = [x + dx, z + dz];
          if (nx < 0 || nz < 0 || nx >= L.w || nz >= L.h || plotAt(nx, nz) === plotAt(x, z)) continue;
          const across = wet(nx, nz) || wet(nx + dz, nz + dx) || wet(nx - dz, nz - dx);
          expect([x, z, across]).toEqual([x, z, true]);
        }
      }
  });
});

describe("the price of land", () => {
  test("every plot of the two new rings owned makes every one still to buy 15% dearer, in whole thousands: section 4.1's table", () => {
    const TABLE_41: readonly (readonly [number, number])[] = [
      [0, 100_000],
      [1, 115_000],
      [2, 132_000],
      [3, 152_000],
      [4, 174_000],
      [5, 201_000],
      [6, 231_000],
      [8, 305_000],
      [10, 403_000],
      [12, 534_000],
      [16, 933_000],
      [20, 1_633_000],
      [24, 2_856_000],
      [30, 6_605_000],
      [39, 23_237_000],
    ];
    for (const [n, coins] of TABLE_41) expect([n, F.risen(100_000, n)]).toEqual([n, coins]);
    expect([F.rise(0), F.rise(1), F.rise(2)]).toEqual([1000, 1150, 1322]);
  });

  test("bought cheapest first, each the cheapest that touches the yard's land: section 4.3's table, and all 40 for 1,196,420,000", () => {
    const y = nine();
    const bought: [string, number][] = [];
    for (;;) {
      const sale = F.OUTER_IDS.filter((id) => F.plotState(y, F.plot(id)).state === "for sale");
      if (sale.length === 0) break;
      const cheapest = sale.reduce((a, b) => (priceIn(y, b) < priceIn(y, a) ? b : a));
      bought.push([info(cheapest).name, buy(y, cheapest)]);
    }
    expect(bought.slice(0, 12)).toEqual([
      ["The Old Workings", 100_000],
      ["The Old Stand", 126_000],
      ["Fern Hollow", 152_000],
      ["The Reed Beds", 182_000],
      ["The Marl Pit", 209_000],
      ["The Narrows", 261_000],
      ["The Weir", 323_000],
      ["The Far Bank", 398_000],
      ["Iron Hill", 458_000],
      ["Copper Ridge", 562_000],
      ["The Black Bank", 686_000],
      ["The Mere", 789_000],
    ]);
    expect(bought.length).toBe(40);
    expect(bought.at(-1)?.[1]).toBe(278_854_000);
    expect(bought.reduce((sum, [, coins]) => sum + coins, 0)).toBe(1_196_420_000);
  });

  test("the shortest way to The Crater costs 3,509,000; Skyfall Edge as the second, third and fourth plot bought", () => {
    const y = nine();
    const corner = (["workings", "narrows", "scree", "rim", "crater"] as const).map((id) => buy(y, id));
    expect(corner).toEqual([100_000, 149_000, 251_000, 912_000, 2_097_000]);
    expect(corner.reduce((a, b) => a + b, 0)).toBe(3_509_000);
    const sky = nine();
    const prices: number[] = [];
    for (const id of ["workings", "flats", "weir"] as const) {
      buy(sky, id);
      prices.push(priceIn(sky, "skyfall"));
    }
    expect(prices).toEqual([253_000, 290_000, 334_000]);
  });

  test("today's nine plots keep their prices and count for nothing; buying is never undone", () => {
    const y = F.create({ seed: 3, tier: 5 });
    expect(priceIn(y, "meadow")).toBe(300);
    must(y, { do: "buyPlot", plot: "meadow" });
    expect(priceIn(y, "workings")).toBe(100_000);
    must(y, { do: "buyPlot", plot: "workings" });
    expect([priceIn(y, "pond"), priceIn(y, "acre")]).toEqual([5000, 276_000]);
    expect(give(y, { do: "undo", entry: y.history.at(-1)?.id ?? "" })).toHaveProperty("refused");
    expect(y.plots).toContain(F.plot("workings"));
  });
});

describe("tier 4's commission", () => {
  test("puts the 40 plots up for sale: a yard that has done it, kept before they were, has the check it had until it buys one", async () => {
    expect(SAVES).toContain("v8-whole");
    const raw: unknown = await Bun.file(`${import.meta.dir}/saves/v8-whole.json`).json();
    const text = typeof raw === "object" && raw !== null ? Reflect.get(raw, "text") : null;
    if (typeof text !== "string") throw new Error("v8-whole is not a save");
    const y = F.decode(text);
    if (!y) throw new Error("v8-whole does not read");
    expect(y.done.map((g) => F.GOALS[g]?.id)).toContain("kits");
    expect(F.OUTER_IDS.every((id) => y.open.plots[F.plot(id)] === 1)).toBe(true);
    // Of them, those that share an edge with the nine it owns: the second ring but its corners.
    const now = F.OUTER_IDS.filter((id) => F.plotState(y, F.plot(id)).state === "for sale");
    expect(now).toEqual(
      F.OUTER_IDS.filter((id) => plotted(id).ring === 2 && Math.abs(info(id).col) !== Math.abs(info(id).row)),
    );
    expect(now.length).toBe(12);
    // Read on today's nine plots alone, with none of the new ones, it is the same yard with the same check.
    const first = F.landFrom(F.PLOTS.filter((p) => Math.max(Math.abs(p.col), Math.abs(p.row)) <= 1));
    const small = F.decode(text, first);
    if (!small) throw new Error("does not read on the first land");
    expect(F.check({ ...y, history: [] })).toBe(F.check({ ...small, history: [] }));
    const before = F.check(y);
    expect(buy(y, "workings")).toBe(100_000);
    expect(F.check(y)).not.toBe(before);
    expect(priceIn(y, "ridge")).toBe(184_000);
  });
});

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

describe("tier 5's first projects", () => {
  test("A survey of the outer woods and Stakes and string want what a tier 4 yard makes, in the spec's line-hours, and pay 35,000 toward the first plot", () => {
    for (const [id, hours, pays] of [
      ["survey", 1.6, 20_000],
      ["stakes", 1.4, 15_000],
    ] as const) {
      const g = F.goal(id);
      const node = F.NODES[g];
      expect([id, node?.tier, node?.kind, node?.pay]).toEqual([id, 5, "project", pays]);
      expect([id, Math.abs(lineHours(g) / hours - 1) <= 0.05]).toEqual([id, true]);
    }
    const y = nine();
    for (const id of ["survey", "stakes"]) {
      must(y, { do: "take", node: id });
      expect(F.GOALS[y.hand]?.id).toBe(id);
    }
    expect(F.tierName(5)).toBe("Tier 5: The wire");
  });
});
