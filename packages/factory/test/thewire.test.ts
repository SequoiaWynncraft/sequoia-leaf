/**
 * Tier 5's tables (SPEC-2 sections 1 and 2): every node and piece of research in the line-hours the
 * spec sizes it in, by the planner, within 5%; the things a mix gives planned by the mix; the new
 * recipes each after every older recipe of its machine, none with parts all found in another's.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";

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

/** SPEC-2's line-hours of tier 5's goals. */
const HOURS: readonly (readonly [string, number])[] = [
  ["survey", 1.6],
  ["stakes", 1.4],
  ["firstcopper", 0.06],
  ["townlight", 1.7],
  ["farwire", 42],
  ["marketlights", 36],
  ["ballast", 27],
  ["wholewood", 117],
  ["felling", 4.7],
  ["deepculvert", 6.1],
  ["widemouths", 5.8],
  ["breaker", 5.8],
  ["windings", 3.3],
  ["bulbs", 3.5],
  ["sparkfolio", 7.8],
  ["telegraphy", 2.8],
  ["lightstrings", 2.2],
  ["breaker2", 3.3],
  ["breaker3", 12.8],
  ["planroom", 11.7],
];

const byName = (a: string, b: string): number => a.localeCompare(b);
/** Tier 5's research that other steps sized: Longer reach (reach upgrades, R1) and the assembler (T5d). */
const OTHERS: ReadonlySet<string> = new Set(["longerreach", "assembler"]);

describe("tier 5's tables", () => {
  test("every node and piece of research is in the spec's line-hours, by the planner, within 5%", () => {
    const tier5 = F.ALL_GOALS.filter((g) => F.GOALS[g]?.tier === 5)
      .map((g) => F.GOALS[g]?.id ?? "")
      .filter((id) => !OTHERS.has(id));
    expect(tier5.toSorted(byName)).toEqual(HOURS.map(([id]) => id).toSorted(byName));
    for (const [id, hours] of HOURS) {
      const got = lineHours(F.goal(id));
      expect([id, Math.abs(got / hours - 1) <= 0.05 ? hours : got]).toEqual([id, hours]);
    }
  });

  test("a thing only a mix gives is planned by it: 20 salvage for 8 copper, a breaker III's 80 a minute; its work as the table gives it", () => {
    const copper = F.item("copper");
    const { kind, recipe } = F.makerOf(copper);
    expect([kind, recipe?.from, recipe?.need, F.makes(kind, 3, recipe)]).toEqual([
      F.BREAKER,
      [F.item("salvage")],
      [2.5],
      80,
    ]);
    expect([F.workOf(copper), F.workOf(F.item("slag")), F.workOf(F.item("wire"))]).toEqual([21, 21, 33]);
    // Ingots, glass and gears keep their own recipes, and the planner does not count the breaker toward them.
    expect(F.makerOf(F.item("ingot")).kind).toBe(F.MILL);
    // A tree of wire names a breaker and its salvage, and nothing a machine makes copper by.
    const tree = F.tree(F.item("wire"), 100, 3);
    expect([tree.kind, tree.from[0]?.kind, tree.from[0]?.from[0]?.kind]).toEqual([F.MILL, F.BREAKER, F.GATHERING]);
    expect(F.RECIPE[copper]).toBeNull();
  });

  test("each new recipe is after every older recipe of its machine, and none has parts all found in another's of its machine", () => {
    const fresh = (["gravel", "wire", "coil", "bulb", "spark", "telegraph", "lights"] as const).map((n) => F.item(n));
    for (const n of fresh) {
      const r = F.RECIPE[n];
      if (!r) throw new Error(`no recipe for ${F.itemName(n)}`);
      const mine = F.MADE_BY[r.by] ?? [];
      const at = mine.indexOf(r);
      // An older recipe is one of a thing numbered before tier 5's first: things are appended in order.
      const older = mine.filter((o) => o.out < Math.min(...fresh));
      expect([F.itemName(n), older.every((o) => mine.indexOf(o) < at)]).toEqual([F.itemName(n), true]);
      const within = mine.filter((o) => o !== r && r.from.every((part) => o.from.includes(part)));
      expect([F.itemName(n), within.map((o) => F.itemName(o.out))]).toEqual([F.itemName(n), []]);
    }
  });

  test("the commission wants what the mix makes in three proportions; the folio pays for tier 5's research", () => {
    const townlight = F.GOALS[F.goal("townlight")];
    expect([townlight?.kind, townlight?.tier, F.NODES[F.goal("townlight")]?.gift?.id]).toEqual([
      "commission",
      5,
      "town-lights",
    ]);
    const spark = F.item("spark");
    expect([F.isFolio(spark), F.FOLIOS.includes(spark)]).toEqual([true, true]);
    expect(F.tierName(5)).toBe("Tier 5: The wire");
  });
});
