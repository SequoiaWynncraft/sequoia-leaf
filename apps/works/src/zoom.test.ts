import { describe, expect, test } from "bun:test";

import { parseScreen, type Screen } from "./yard.ts";
import { FAR, farSteps, markSize, natural, tilePx, ZOOM, zoomFor } from "./zoom.ts";

/** The furthest a screen of this many device pixels lets the view be zoomed, out and in, in steps. */
function reach(cw: number, ch: number): { out: number; in: number } {
  const base = natural(cw, ch);
  return { out: zoomFor(base, -1000) - base, in: zoomFor(base, 1000) - base };
}

const back = (s: Screen): Screen => parseScreen(JSON.stringify(s));

describe("the zoom kept", () => {
  test("however far a screen lets the view be zoomed, the zoom comes back after a reload", () => {
    // A laptop, a sharp laptop, a 4K screen and a sharp 5K one, in device pixels.
    for (const [cw, ch] of [
      [1366, 768],
      [2880, 1800],
      [3840, 2160],
      [5120, 2880],
    ] as const) {
      const far = reach(cw, ch);
      for (const zoom of [far.out, far.in])
        expect(back({ taught: ["planks"], zoom, grades: {} })).toEqual({ taught: ["planks"], zoom, grades: {} });
    }
    // A 4K screen zooms out eleven steps, to one screen pixel for each of the yard's.
    expect(reach(3840, 2160).out).toBe(-11);
  });

  test("every screen zooms out to one screen pixel for each of the yard's, and no further", () => {
    // A phone, a laptop, a desktop, a wide desktop and an 8K screen, in device pixels.
    for (const [cw, ch] of [
      [1170, 2532],
      [1366, 768],
      [1920, 1080],
      [3440, 1440],
      [7680, 4320],
    ] as const)
      expect(zoomFor(natural(cw, ch), -1000)).toBe(1);
  });

  test("land a window does not show whole has the plan's steps past that: 8 and then 4 screen pixels to a tile", () => {
    expect(FAR).toEqual([8, 4]);
    // A laptop whose natural size is 4: four steps of the picture, then the plan's two.
    const base = natural(1366, 768);
    expect([0, -1, -2, -3, -4, -5, -6].map((steps) => tilePx(zoomFor(base, steps, 2)))).toEqual([
      64, 48, 32, 16, 8, 4, 4,
    ]);
    // With one step of the plan the view stops at 8; with none, at one screen pixel for each of the yard's.
    expect(tilePx(zoomFor(base, -1000, 1))).toBe(8);
    expect(tilePx(zoomFor(base, -1000, 0))).toBe(16);
    expect(tilePx(zoomFor(base, -1000, 9))).toBe(4);
  });

  test("the plan's steps are there only as far as it takes to show the whole yard clear of the interface", () => {
    // A yard of one plot, 16 tiles by 12, is whole in any window: no step of the plan.
    expect(farSteps(16, 12, 390, 600)).toBe(0);
    // A yard that owns all of the guild's land, 48 tiles by 36, is whole at 16 pixels a tile in a laptop's window.
    expect(farSteps(48, 36, 1280, 640)).toBe(0);
    // In a phone's width it is not, and is at 8.
    expect(farSteps(48, 36, 390, 600)).toBe(1);
    // A yard of 112 by 84 needs 8 pixels a tile in a wide window that is tall enough, and 4 in one that is not.
    expect(farSteps(112, 84, 1920, 900)).toBe(1);
    expect(farSteps(112, 84, 1280, 640)).toBe(2);
    expect(farSteps(112, 84, 390, 600)).toBe(2);
    // However large the land, there are no more than the two.
    expect(farSteps(1000, 1000, 390, 600)).toBe(2);
  });

  test("the zoom kept comes back for a step of the plan too", () => {
    const base = natural(390, 844);
    const out = zoomFor(base, -1000, 2) - base;
    expect(tilePx(base + out)).toBe(4);
    expect(back({ taught: [], zoom: out, grades: {} })).toEqual({ taught: [], zoom: out, grades: {} });
  });

  test("a trouble mark is its own size down to a third of the natural size, and grows further out", () => {
    // On a desktop the view used to stop at 2 screen pixels to one; on a wide one and on a phone, at 3.
    expect([6, 3, 2, 1].map((z) => markSize(6, z))).toEqual([1, 1, 1, 2]);
    expect([8, 3, 2, 1].map((z) => markSize(8, z))).toEqual([1, 1, 2, 3]);
    expect([7, 3, 2, 1].map((z) => markSize(7, z))).toEqual([1, 1, 2, 3]);
  });

  test("no screen is let zoom further than the record keeps, and nonsense is not kept", () => {
    // A screen far bigger than any there is: its natural size is 100.
    expect(reach(16_000, 17_600)).toEqual({ out: -ZOOM.out, in: ZOOM.in });
    expect(back({ taught: [], zoom: -ZOOM.out, grades: {} }).zoom).toBe(-ZOOM.out);
    for (const zoom of [-ZOOM.out - 1, ZOOM.in + 1, 1e9, Number.NaN])
      expect(back({ taught: [], zoom, grades: {} }).zoom).toBe(0);
    expect(parseScreen("not a screen")).toEqual({ taught: [], zoom: 0, grades: {} });
  });
});
