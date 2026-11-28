import { afterEach, expect, test } from "bun:test";

import { eraOf, LEGACY_ERA, onTrail } from "@sequoia-leaf/raid";

import { pagesKey, S } from "../state.ts";
import { figuresAt, figuresHere } from "./own.ts";
import { traitRefFrom } from "./refs.ts";

const era = S.era;
afterEach(() => {
  S.era = era;
});

test("a trait card lists the figures of the table on screen: its run's era, a seat's being its sitting's", () => {
  // Leaf's view has the expansion's first release open; a run of the base's era alone (made up) has no Seqwawa.
  S.era = LEGACY_ERA;
  expect(figuresAt(null)).toContain("seqwawa");
  expect(figuresAt({ era: LEGACY_ERA })).toContain("seqwawa");
  expect(figuresAt({ era: eraOf("base") })).not.toContain("seqwawa");
  // With no table, the almanac's are Leaf's view's.
  S.era = eraOf("base");
  expect(figuresHere()).not.toContain("seqwawa");
});

test("a page over the table is drawn again when Leaf's view is of a new era, whatever else is the same", () => {
  S.era = eraOf("base");
  const before = pagesKey("almanac");
  S.era = LEGACY_ERA;
  expect(pagesKey("almanac")).not.toBe(before);
});

test("a trait card in normal mode lists the set and every figure the run holds; with the member's own, their collection too", () => {
  const tree = eraOf("up-the-tree");
  const flint = { id: 1, kind: "emberkit" as const, stars: 1 as const, items: [], fed: 0, fights: 0 };
  const run = { era: tree, way: onTrail(0), board: [flint], bench: [] };
  // Flint left every raid at Groot Night: a run that carried one still lists it under Ember.
  expect([figuresAt({ era: tree }).includes("emberkit"), figuresAt(run).includes("emberkit")]).toEqual([false, true]);
  const roster = S.roster;
  S.roster = { glorp: 1 };
  expect([figuresAt(run).includes("glorp"), figuresAt(run, true).includes("glorp")]).toEqual([false, true]);
  S.roster = roster;
});

test("from the member's collection, a figure's traits open as lore cards in Leaf's era, every step shown", () => {
  expect([
    traitRefFrom("ember", undefined, true),
    traitRefFrom("ember", true, false),
    traitRefFrom("ember", true, true),
  ]).toEqual(["trait:ember", "trait:ember/lore", "trait:ember/lore/own"]);
});
