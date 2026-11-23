/**
 * The tables held together: every node and piece of research can be reached; nothing is wanted
 * before the yard can have unlocked the means to make it; every folio cost can be paid with folios of
 * its tier or earlier; ids are unique; the tiers have the shape the design gives them.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";

const ids = (goals: readonly F.Goal[]): string[] => goals.map((g) => F.GOALS[g]?.id ?? "");

/** How many goals of a tier are of a kind. */
const by = (tier: number, kind: string): number => F.GOALS.filter((g) => g.tier === tier && g.kind === kind).length;

/** Every goal that can be done, in an order it can be, taking only those `allowed` lets in. */
function reach(allowed: (g: F.Goal) => boolean = () => true): F.Goal[] {
  const done: F.Goal[] = [];
  for (let grew = true; grew;) {
    grew = false;
    const open = F.openOf(done);
    for (const g of F.ALL_GOALS)
      if (allowed(g) && F.ready(open, g)) {
        done.push(g);
        grew = true;
        break;
      }
  }
  return done;
}

/** What a yard could make, every plot for sale bought, with the goals done that can be by the time `g` is: those of its tier or below, but itself. */
function makeableFor(g: F.Goal): F.Item[] {
  const tier = F.GOALS[g]?.tier ?? 0;
  const open = F.openOf(reach((h) => h !== g && (F.GOALS[h]?.tier ?? 0) <= tier));
  const forSale = F.LAND.plots.map((p) => p.plot).filter((p) => ((open.plots >> p) & 1) === 1);
  return F.makeableOn(F.LAND, open, forSale);
}

describe("the tables", () => {
  test("every node and every piece of research can be reached", () => {
    expect(ids(reach()).toSorted()).toEqual(ids(F.ALL_GOALS).toSorted());
    expect(F.openOf(reach()).tier).toBe(4);
  });

  test("ids are unique, across the nodes and the research", () => {
    const all = [...F.NODES.map((n) => n.id), ...F.RESEARCH.map((r) => r.id)];
    expect(new Set(all).size).toBe(all.length);
  });

  test("tier 0 is lessons; each tier from 1 has one commission; projects in tiers 1 and 2, research from tier 3", () => {
    expect([0, 1, 2, 3].map((t) => by(t, "commission"))).toEqual([0, 1, 1, 1]);
    expect(F.GOALS.filter((g) => g.kind === "lesson").every((g) => g.tier === 0)).toBe(true);
    expect([1, 2].map((t) => by(t, "project") > 0)).toEqual([true, true]);
    expect(F.GOALS.filter((g) => g.kind === "research").every((g) => g.tier >= 3)).toBe(true);
  });

  test("no node wants anything before the yard can have unlocked the means to make it", () => {
    const short = F.ALL_GOALS.filter(F.isNode).flatMap((g) => {
      const can = makeableFor(g);
      return F.ALL_ITEMS.filter((n) => (F.GOALS[g]?.want[n] ?? 0) > 0 && !can.includes(n)).map(
        (n) => `${F.GOALS[g]?.id}: ${F.itemName(n)}`,
      );
    });
    expect(short).toEqual([]);
  });

  test("every folio cost can be paid with folios the yard can make by that tier", () => {
    const short = F.ALL_GOALS.filter((g) => !F.isNode(g)).flatMap((g) => {
      const can = makeableFor(g);
      return F.ALL_ITEMS.filter((n) => (F.GOALS[g]?.want[n] ?? 0) > 0 && !(F.isFolio(n) && can.includes(n))).map(
        (n) => `${F.GOALS[g]?.id}: ${F.itemName(n)}`,
      );
    });
    expect(short).toEqual([]);
  });

  test("tier 3's research adds up to about 1,500 folios", () => {
    const folios = F.GOALS.filter((g) => g.kind === "research" && g.tier === 3).reduce(
      (sum, g) => sum + F.FOLIOS.reduce((n, f) => n + (g.want[f] ?? 0), 0),
      0,
    );
    expect(folios).toBe(1490);
  });

  test("tiers 0 and 1 have only recipes of one of each part, as today's game", () => {
    const early = makeableFor(F.goal("banners"));
    const counted = early.filter((n) => (F.RECIPE[n]?.need ?? []).some((c) => c > 1));
    expect(counted.map(F.itemName)).toEqual([]);
  });
});
