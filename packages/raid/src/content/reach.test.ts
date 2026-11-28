/**
 * How far normal mode reaches a trait, and what every view shows of its steps (`reach.ts`): one
 * answer, read by every chip, card and almanac page, every regular and every bot.
 */
import { describe, expect, test } from "bun:test";

import { command, openSitting } from "../sitting/commands.ts";
import { available, catalogAt } from "./catalog.ts";
import { type FigureId, traitsOf } from "./figures.ts";
import { favourites, shownInNormal, traitReach, traitShown } from "./reach.ts";
import { eraOf, RELEASES } from "./releases.ts";
import type { TraitId } from "./traits.ts";

const NIGHT = catalogAt(eraOf("groot-night"));
const PENGUINS = catalogAt(eraOf("penguin-month"));
const TREE = catalogAt(eraOf("up-the-tree"));

describe("how far normal mode reaches a trait", () => {
  test("the set's figures, and one more for an emblem the era has", () => {
    // January: Twig, Huff and Unc carry Feather, and its charm is one more.
    expect([traitReach(TREE, "feather", false), traitReach(TREE, "feather")]).toEqual([3, 4]);
    expect(traitShown(TREE, "feather", 0, false).steps).toEqual([2, 3, 4]);
  });

  test("every step where the era can make that emblem more than once: the Carving Knife's, from Penguin Month", () => {
    // Fang has no emblem before Penguin Month: its four figures reach 4 of 2/4/6.
    expect(traitShown(NIGHT, "fang", 0, false).steps).toEqual([2, 4]);
    // The Knife makes a Wooden Tooth with any Thorn, again and again: all of Fang's steps.
    for (const cat of [PENGUINS, TREE]) {
      for (const trait of ["fang", "slinger", "sage", "bulwark", "mender"] as const) {
        const all: readonly number[] = cat.traits[trait]?.steps ?? [];
        expect([trait, traitReach(cat, trait), traitShown(cat, trait, 0, false).steps]).toEqual([
          trait,
          Number.POSITIVE_INFINITY,
          all,
        ]);
      }
    }
    // An origin's charm is a boon, taken once: members and one.
    expect(traitReach(TREE, "huddle")).toBe(5);
  });

  test("a trait the set cannot light, even with an emblem, shows no step in normal mode and is not in its almanac", () => {
    // January: nobody in the set is an Ember, and its charm alone makes 1 of 2.
    expect(traitShown(TREE, "ember", 0, false)).toEqual({ count: 0, step: 0, steps: [], next: null });
    expect(shownInNormal(TREE, "ember")).toBe(false);
    // A carried Flint counts 1, and its chip says so with no step to count to.
    expect(traitShown(TREE, "ember", 1, false)).toEqual({ count: 1, step: 0, steps: [], next: null });
    // Lit past the set's reach by two carried Embers, the step it is on shows.
    expect(traitShown(TREE, "ember", 2, false).steps).toEqual([2]);
    // A raid with the member's own figures, or their collection, shows every step.
    expect(traitShown(TREE, "ember", 0, true).steps).toEqual([2, 4]);
  });

  test("every counter counts to the same step: 4 Feathers in January read 4/4, the top step normal mode shows", () => {
    expect(traitShown(TREE, "feather", 4, false)).toEqual({ count: 4, step: 3, steps: [2, 3, 4], next: 4 });
    expect(traitShown(TREE, "feather", 4, true).next).toBe(5);
  });
});

describe("the regulars' favourite traits, solo and at a live table", () => {
  test("only traits the set reaches by figures", () => {
    // January: Moth is a Mist, but the only one in the set.
    expect(favourites(TREE, traitsOf(TREE, "moth"))).toEqual(["sage", "graid"]);
  });

  test("a live table's regulars are fond of one of their own the set reaches, in every era", () => {
    const wrong: string[] = [];
    for (const r of RELEASES.filter((each) => each.at > 0)) {
      for (let seed = 0; seed < 12; seed++) {
        const member = { id: "10000000-0000-0000-0000-00000000ca7d", name: "A member" };
        const opened = openSitting({ now: r.at, seed, player: member });
        const started = command(opened, { do: "start" }, { now: r.at, seed: seed + 100, player: member });
        if (!started.ok) throw new Error(started.why);
        const cat = catalogAt(started.sitting.era);
        for (const { who } of started.sitting.seats) {
          if (who.is !== "regular") continue;
          const may: readonly TraitId[] = favourites(cat, traitsOf(cat, who.figure));
          if (may.length > 0 && !may.includes(who.habit)) wrong.push(`${r.id} ${who.figure} fond of ${who.habit}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("the normal-mode almanac", () => {
  test("is the set; a member's own out of it, a closed banner's headliner too, is in their collection", () => {
    const owned = { "banner-1": 2, emberkit: 1 } satisfies Partial<Record<FigureId, number>>;
    expect([
      available(NIGHT, { for: "almanac" }).includes("banner-1"),
      available(NIGHT, { for: "almanac" }).includes("emberkit"),
    ]).toEqual([false, false]);
    expect(available(NIGHT, { for: "collection", roster: owned })).toEqual(["emberkit", "banner-1"]);
  });
});
