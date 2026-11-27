import { describe, expect, test } from "bun:test";

import { catalogAt, everyShared } from "@sequoia-leaf/raid/content/catalog.ts";
import { figureIn } from "@sequoia-leaf/raid/content/figures.ts";
import { eraOf, LAST_ERA } from "@sequoia-leaf/raid/content/releases.ts";

import {
  figureOfThing,
  figureThing,
  footprint,
  isMemberThing,
  KIND_NAMES,
  KINDS,
  memberThing,
  thingOf,
  thingOpen,
  THINGS,
} from "./things.ts";

/** The camp names the raid's figures as the catalogue with every release open has them. */
const CAT = catalogAt(LAST_ERA);

describe("the catalogue", () => {
  test("there are forty things and more, each with a name of its own among its kind", () => {
    expect(THINGS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(THINGS.map((t) => t.id)).size).toBe(THINGS.length);
    // A character has its name from the raid, which a thing of another kind may have too (Rock, Orphion).
    expect(new Set(THINGS.map((t) => `${t.kind}: ${t.name}`)).size).toBe(THINGS.length);
  });

  test("every figure of the raid is a character: its name and its line from there, on 3 squares, mirrored by a turn", () => {
    const characters = THINGS.filter((t) => t.kind === "characters");
    expect(characters.map((t) => t.id)).toEqual([
      ...everyShared().map(figureThing),
      memberThing("banner-1"),
      memberThing("groot-night"),
      memberThing("penguin-month"),
    ]);
    // A character is its figure: Yule's camp thing too, which says its line and stands as its figure does; a skin's member is none.
    expect(figureOfThing({ id: memberThing("penguin-month"), kind: "characters" })).toBe("yule");
    expect(figureOfThing({ id: figureThing("dibs"), kind: "characters" })).toBe("dibs");
    expect(figureOfThing({ id: memberThing("groot-night"), kind: "characters" })).toBeNull();
    // Yule, drawn by the set, is a figure on 3 squares with its line.
    expect(thingOf(memberThing("penguin-month"))).toMatchObject({
      name: "Yule",
      w: 3,
      about: "Runs the bath. Does not get in.",
    });
    for (const id of everyShared())
      expect(thingOf(figureThing(id))).toMatchObject({
        name: figureIn(CAT, id).name,
        about: figureIn(CAT, id).quip,
        w: 3,
        d: 1,
        turns: "flip",
        solid: "all",
        rooted: false,
      });
  });

  test("a banner's member is a character on a person's one square, turned to face the other way, with no line about them", () => {
    const member = thingOf("member-banner-1");
    expect(member).toMatchObject({ kind: "characters", w: 1, d: 1, turns: "flip", about: "", light: 0 });
    expect(member && KIND_NAMES[member.kind]).toBe("Characters");
    // Who they are is Leaf's to say: until the page hears, the name says no more than is true.
    expect(member?.name).toBe("A guild member");
    expect(thingOf("statue-banner-1")).toBeNull();
    // Groot Night's member is a character too, named by the banner's title until and after the page hears.
    expect(thingOf("member-groot-night")).toMatchObject({
      kind: "characters",
      w: 1,
      d: 1,
      about: "",
      name: "Commodore",
    });
  });

  test("every name can be kept in a record, and every thing takes some ground", () => {
    for (const t of THINGS) {
      expect(t.id).toMatch(/^[a-z0-9-]{1,32}$/);
      expect(t.w).toBeGreaterThan(0);
      expect(t.d).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
      // A member has no line about them, but the one the set draws (Yule), which has its own.
      expect(t.about.length > 0).toBe(!isMemberThing(t.id) || t.id === "member-penguin-month");
    }
  });

  test("every kind has something in it", () => {
    for (const k of KINDS) expect(THINGS.some((t) => t.kind === k)).toBe(true);
  });

  test("most things do something when touched", () => {
    const doing = THINGS.filter((t) => t.does !== "").length;
    expect(doing / THINGS.length).toBeGreaterThan(0.9);
  });

  test("what lies flat stops nobody", () => {
    for (const t of THINGS) if (t.flat) expect(t.solid).toBe("none");
  });

  test("a thing laid the other way takes the same ground turned", () => {
    const fence = thingOf("picket");
    expect(fence && footprint(fence, 0)).toEqual([2, 1]);
    expect(fence && footprint(fence, 1)).toEqual([1, 2]);
    const gnome = thingOf("gnome");
    expect(gnome && footprint(gnome, 1)).toEqual([1, 1]);
  });
});

describe("what is open of the camp's things", () => {
  test("a figure's carving and a banner's member are open from their release on; everything else always", () => {
    const before = catalogAt(eraOf("gaz-stall"));
    const night = catalogAt(eraOf("groot-night"));
    expect(
      ["figure-greg", "figure-peep", "member-banner-1", "member-groot-night", "lantern-post"].map((id) =>
        thingOpen(before, id),
      ),
    ).toEqual([true, false, true, false, true]);
    expect(["figure-peep", "figure-crab8", "member-groot-night"].map((id) => thingOpen(night, id))).toEqual([
      true,
      true,
      true,
    ]);
    // What the camp sheet shows before 8 December: no figure or member Groot Night brings.
    const shown = THINGS.filter((t) => thingOpen(before, t.id)).map((t) => t.id);
    expect(
      shown.filter((id) =>
        [
          "figure-peep",
          "figure-munch",
          "figure-clutch",
          "figure-crab31",
          "figure-crab8",
          "member-groot-night",
          "figure-dibs",
          "figure-jet",
          "figure-larp",
          "figure-flurry",
          "figure-pomp",
          "member-penguin-month",
        ].includes(id),
      ),
    ).toEqual([]);
    expect(shown.length).toBe(THINGS.length - 12);
  });
});
