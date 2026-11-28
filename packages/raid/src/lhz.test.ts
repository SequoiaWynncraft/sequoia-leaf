/**
 * LHZ outside the fight: nothing of it before Penguin Month opens (22 December, 00:00 UTC) and all of
 * it at that moment, with Yule and the Honorary Badge; Vi one more from Up The Tree (5 January). In
 * normal mode every era reaches its second step: its figures in the set and the badge.
 */
import { describe, expect, test } from "bun:test";

import { catalogAt } from "./content/catalog.ts";
import { traitsOf } from "./content/figures.ts";
import { traitReach, traitShown } from "./content/reach.ts";
import { eraAt, RELEASES } from "./content/releases.ts";

const PENGUINS = Date.UTC(2026, 11, 22);
const TREE = Date.UTC(2027, 0, 5);
const around = (at: number) => [catalogAt(eraAt(at - 1)), catalogAt(eraAt(at))] as const;

describe("LHZ arrives", () => {
  test("with Penguin Month: the trait, Yule's third trait, the badge and its charm, and the chip's steps", () => {
    const [before, at] = around(PENGUINS);
    expect([before.ids.traits.includes("lhz"), at.ids.traits.includes("lhz")]).toEqual([false, true]);
    expect([before.ids.emblems.includes("lhzcharm"), at.ids.emblems.includes("lhzcharm")]).toEqual([false, true]);
    expect([before.ids.boons.includes("lhzcharm"), at.ids.boons.includes("lhzcharm")]).toEqual([false, true]);
    expect(traitsOf(at, "yule")).toEqual(["huddle", "mender", "lhz"]);
    // The chip: nothing to show before; at the moment both steps, Yule in the set and the badge.
    expect([traitShown(before, "lhz", 0, false).steps, traitShown(at, "lhz", 0, false).steps]).toEqual([[], [1, 2]]);
    expect([traitReach(at, "lhz", false), traitReach(at, "lhz")]).toEqual([1, 2]);
  });

  test("with Up The Tree: Vi is one, and normal mode still reaches both steps with Yule's banner closed", () => {
    const [before, at] = around(TREE);
    expect(before.figures.vi).toBeUndefined();
    expect(traitsOf(at, "vi")).toEqual(["canopy", "chorus", "lhz"]);
    expect([before.figures.yule?.everyones, at.figures.yule?.everyones]).toEqual([true, false]);
    expect([traitReach(before, "lhz", false), traitReach(at, "lhz", false)]).toEqual([1, 1]);
    for (const cat of [before, at]) expect(traitShown(cat, "lhz", 0, false).steps).toEqual([1, 2]);
  });

  test("every era from Penguin Month reaches both steps in normal mode, and none before has it", () => {
    for (const r of RELEASES) {
      const cat = catalogAt(eraAt(r.at));
      const steps = r.at >= PENGUINS ? [1, 2] : [];
      expect([r.id, traitShown(cat, "lhz", 0, false).steps]).toEqual([r.id, steps]);
    }
  });
});
