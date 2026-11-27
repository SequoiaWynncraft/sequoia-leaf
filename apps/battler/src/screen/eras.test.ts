/**
 * The page reads each thing in the catalogue of what it is about: the almanac in Leaf's view's era, a
 * run's cards and panels in the run's (a seat's being its sitting's), never a newer one. The base's
 * era is never a player's, so it stands here for any older era.
 */
import { afterEach, expect, test } from "bun:test";

import { carriedTraits, eraOf, LEGACY_ERA, startRun, traitIn } from "@sequoia-leaf/raid";

import { ownTraitCount } from "./logic.ts";
import { catalogFor, S } from "./state.ts";
import { rackDrawn, stallDrawn, traitsDrawn } from "./ui/drawn.ts";
import { traitsHere } from "./ui/own.ts";

const BASE = eraOf("base");
const era = S.era;
afterEach(() => {
  S.era = era;
});

test("the almanac's traits are its era's: a view of an older era lists none of a later one, and reads each", () => {
  S.era = BASE;
  expect(traitsHere()).not.toContain("graid");
  expect(traitsHere().map((id) => traitIn(catalogFor(null), id).name)).toContain("Moss");
  S.era = LEGACY_ERA;
  expect(traitsHere()).toContain("graid");
});

test("a run's cards read the run's era, though Leaf's view is newer: an older Moth carries no Graid", () => {
  S.era = LEGACY_ERA;
  const run = { ...startRun(1, { era: BASE }), era: BASE };
  const cat = catalogFor(run);
  expect([cat.era, catalogFor(null).era]).toEqual([BASE, LEGACY_ERA]);
  const traits = carriedTraits(cat, "moth", []);
  expect(traits).not.toContain("graid");
  expect(traits.map((t) => [cat.traits[t] !== undefined, ownTraitCount(run, t).count])).toEqual(
    traits.map(() => [true, 0]),
  );
});

test("the table's panels are drawn again when the run's era changes, though nothing else did", () => {
  const run = startRun(2, { era: LEGACY_ERA });
  const older = { ...run, era: BASE };
  expect(traitsDrawn(older, [])).not.toBe(traitsDrawn(run, []));
  expect(stallDrawn(older)).not.toBe(stallDrawn(run));
  expect(rackDrawn(older)).not.toBe(rackDrawn(run));
});
