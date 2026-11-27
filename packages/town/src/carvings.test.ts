/**
 * The camp's carvings of the raid's figures read the era Leaf's view of the town gives: a release
 * not open yet changes nothing a camp says, and one that opens renames them from Leaf's next view.
 */
import { afterEach, expect, test } from "bun:test";

import { catalogAt, catalogsOf } from "@sequoia-leaf/raid/content/catalog.ts";
import { eraAt, eraOf, LEGACY_ERA } from "@sequoia-leaf/raid/content/releases.ts";
import { BASE } from "@sequoia-leaf/raid/content/releases/base.ts";
import { GROOT } from "@sequoia-leaf/raid/content/releases/groot.ts";

import { newTown, readView, townView } from "./game.ts";
import { figureThing, nameCarvings, thingOf } from "./things.ts";

/** What the Moth's carving is called just now. */
const moth = (): string | undefined => thingOf(figureThing("moth"))?.name;

afterEach(() => {
  nameCarvings(catalogAt(LEGACY_ERA));
});

test("a carving says what its figure says in the era Leaf's view gives, never a staged release's words", () => {
  // Moth made up as renamed by Penguin Month.
  const eras = catalogsOf([
    BASE,
    GROOT,
    { release: "penguin-month", figures: { change: { moth: { name: "Dusty", quip: "Was a moth." } } } },
  ]);
  expect(moth()).toBe("Moth");
  nameCarvings(eras[eraOf("groot-night") - 1] ?? catalogAt(LEGACY_ERA));
  expect(moth()).toBe("Moth");
  nameCarvings(eras[eraOf("penguin-month") - 1] ?? catalogAt(LEGACY_ERA));
  expect([moth(), thingOf(figureThing("moth"))?.about]).toEqual(["Dusty", "Was a moth."]);
});

test("Leaf's view of the town says the era on its clock, and a view from before eras reads as the era live then", () => {
  const now = Date.UTC(2026, 11, 22);
  const view = townView(newTown({ now, seed: 1 }), now);
  expect(view.era).toBe(eraAt(now));
  expect(readView(JSON.parse(JSON.stringify(view)))?.era).toBe(eraAt(now));
  const { era: _era, ...before } = view;
  expect(readView(JSON.parse(JSON.stringify(before)))?.era).toBe(LEGACY_ERA);
  expect(readView({ ...JSON.parse(JSON.stringify(view)), era: 99 })).toBeNull();
});
