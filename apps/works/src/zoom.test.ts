import { describe, expect, test } from "bun:test";

import { parseScreen, type Screen } from "./yard.ts";
import { markSize, natural, ZOOM, zoomFor } from "./zoom.ts";

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
        expect(back({ taught: ["planks"], zoom })).toEqual({ taught: ["planks"], zoom });
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

  test("a trouble mark is its own size down to a third of the natural size, and grows further out", () => {
    // On a desktop the view used to stop at 2 screen pixels to one; on a wide one and on a phone, at 3.
    expect([6, 3, 2, 1].map((z) => markSize(6, z))).toEqual([1, 1, 1, 2]);
    expect([8, 3, 2, 1].map((z) => markSize(8, z))).toEqual([1, 1, 2, 3]);
    expect([7, 3, 2, 1].map((z) => markSize(7, z))).toEqual([1, 1, 2, 3]);
  });

  test("no screen is let zoom further than the record keeps, and nonsense is not kept", () => {
    // A screen far bigger than any there is: its natural size is 100.
    expect(reach(16_000, 17_600)).toEqual({ out: -ZOOM.out, in: ZOOM.in });
    expect(back({ taught: [], zoom: -ZOOM.out }).zoom).toBe(-ZOOM.out);
    for (const zoom of [-ZOOM.out - 1, ZOOM.in + 1, 1e9, Number.NaN]) expect(back({ taught: [], zoom }).zoom).toBe(0);
    expect(parseScreen("not a screen")).toEqual({ taught: [], zoom: 0 });
  });
});
