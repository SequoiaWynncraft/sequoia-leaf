import { describe, expect, test } from "bun:test";

import { parseScreen, type Screen } from "./yard.ts";
import { natural, ZOOM, zoomFor } from "./zoom.ts";

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
    // A 4K screen zooms further out than the four steps the record used to keep.
    expect(reach(3840, 2160).out).toBe(-8);
  });

  test("no screen is let zoom further than the record keeps, and nonsense is not kept", () => {
    expect(reach(7680, 4320)).toEqual({ out: -ZOOM.out, in: ZOOM.in });
    expect(back({ taught: [], zoom: -ZOOM.out }).zoom).toBe(-ZOOM.out);
    for (const zoom of [-ZOOM.out - 1, ZOOM.in + 1, 1e9, Number.NaN]) expect(back({ taught: [], zoom }).zoom).toBe(0);
    expect(parseScreen("not a screen")).toEqual({ taught: [], zoom: 0 });
  });
});
