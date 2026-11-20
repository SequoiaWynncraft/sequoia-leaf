import { describe, expect, test } from "bun:test";

import { RANKS } from "../src/engine/palette.ts";
import {
  CATALOGUE,
  dailyTrades,
  ODDS,
  openCone,
  openCones,
  PITY,
  POOLS,
  rankAt,
  rankIndex,
} from "../src/game/rules.ts";
import { SPIRITS } from "../src/game/spirits.ts";

/** A random source that returns the given numbers in turn, then repeats the last. */
const seq = (...values: number[]): (() => number) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
};

/** DESIGN.md's three price bands: everyday, special and prestige. */
const inBand = (p: number): boolean =>
  (p >= 300 && p <= 1500) || (p >= 2000 && p <= 6000) || (p >= 10000 && p <= 50000);

describe("the published odds", () => {
  test("add up to exactly one", () => {
    const total = RANKS.reduce((sum, r) => sum + ODDS[r.name], 0);
    expect(total).toBeCloseTo(1, 10);
  });

  test("are the brief's rates, rarest last", () => {
    expect(RANKS.map((r) => ODDS[r.name])).toEqual([0.4, 0.27, 0.16, 0.09, 0.05, 0.025, 0.005]);
  });

  test("land on each rank across its own share of the roll", () => {
    expect(rankAt(0)).toBe("Leafkin");
    expect(rankAt(0.3999)).toBe("Leafkin");
    expect(rankAt(0.4)).toBe("Sapling");
    expect(rankAt(0.9949)).toBe("Treant");
    expect(rankAt(0.9951)).toBe("Yggdrasil");
  });
});

describe("pity", () => {
  test("lifts the fortieth cone without a Treant to a Treant", () => {
    const pull = openCone(PITY - 1, seq(0, 0));
    expect(pull.rank).toBe("Treant");
    expect(pull.guaranteed).toBe(true);
    expect(pull.pity).toBe(0);
  });

  test("never lowers a better roll", () => {
    const pull = openCone(PITY - 1, seq(0.999));
    expect(pull.rank).toBe("Yggdrasil");
    expect(pull.guaranteed).toBe(false);
  });

  test("counts up on common cones and resets on a Treant or better", () => {
    expect(openCone(5, seq(0)).pity).toBe(6);
    expect(openCone(5, seq(0.99)).pity).toBe(0);
  });

  test("guarantees a Treant or better in any forty cones in a row", () => {
    const pulls = openCones(PITY, 0, seq(0));
    expect(pulls.some((p) => rankIndex(p.rank) >= rankIndex("Treant"))).toBe(true);
  });

  test("carries over: a count from the last banner shortens the wait", () => {
    const pulls = openCones(3, 37, seq(0));
    expect(pulls.map((p) => p.rank)).toEqual(["Leafkin", "Leafkin", "Treant"]);
  });
});

describe("the spirit book", () => {
  test("has every pool's spirit, each in exactly one rank", () => {
    const pooled = Object.values(POOLS).flat();
    expect(new Set(pooled).size).toBe(pooled.length);
    expect(SPIRITS.map((s) => s.id).toSorted()).toEqual(pooled.toSorted());
  });

  test("never pulls the grove's folk", () => {
    const ids = SPIRITS.map((s) => s.id);
    expect(ids).not.toContain("gnome");
    expect(ids).not.toContain("cinfy");
  });
});

describe("Cinfy's catalogue", () => {
  test("prices every item inside one of the three bands", () => {
    for (const item of CATALOGUE) expect(inBand(item.price)).toBe(true);
  });

  test("offers four different trades each day", () => {
    for (let day = 20000; day < 20030; day++) expect(new Set(dailyTrades(day).map((i) => i.id)).size).toBe(4);
  });
});
