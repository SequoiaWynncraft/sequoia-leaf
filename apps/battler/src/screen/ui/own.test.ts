import { afterEach, expect, test } from "bun:test";

import { eraOf, LEGACY_ERA } from "@sequoia-leaf/raid";

import { pagesKey, S } from "../state.ts";
import { figuresAt, figuresHere } from "./own.ts";

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
