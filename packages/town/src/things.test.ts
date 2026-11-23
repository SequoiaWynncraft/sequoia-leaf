import { describe, expect, test } from "bun:test";

import { FIGURE_IDS, FIGURES } from "@sequoia-leaf/raid/content/figures.ts";

import { figureThing, footprint, KINDS, thingOf, THINGS } from "./things.ts";

describe("the catalogue", () => {
  test("there are forty things and more, each with a name of its own among its kind", () => {
    expect(THINGS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(THINGS.map((t) => t.id)).size).toBe(THINGS.length);
    // A character has its name from the raid, which a thing of another kind may have too (Rock, Orphion).
    expect(new Set(THINGS.map((t) => `${t.kind}: ${t.name}`)).size).toBe(THINGS.length);
  });

  test("every figure of the raid is a character: its name and its line from there, on 3 squares, mirrored by a turn", () => {
    const characters = THINGS.filter((t) => t.kind === "characters");
    expect(characters.map((t) => t.id)).toEqual(FIGURE_IDS.map(figureThing));
    for (const id of FIGURE_IDS)
      expect(thingOf(figureThing(id))).toMatchObject({
        name: FIGURES[id].name,
        about: FIGURES[id].quip,
        w: 3,
        d: 1,
        turns: "flip",
        solid: "all",
        rooted: false,
      });
  });

  test("every name can be kept in a record, and every thing takes some ground", () => {
    for (const t of THINGS) {
      expect(t.id).toMatch(/^[a-z0-9-]{1,32}$/);
      expect(t.w).toBeGreaterThan(0);
      expect(t.d).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.about.length).toBeGreaterThan(0);
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
