import { describe, expect, test } from "bun:test";

import { footprint, KINDS, thingOf, THINGS } from "./things.ts";

describe("the catalogue", () => {
  test("there are forty things and more, each with a name of its own", () => {
    expect(THINGS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(THINGS.map((t) => t.id)).size).toBe(THINGS.length);
    expect(new Set(THINGS.map((t) => t.name)).size).toBe(THINGS.length);
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
