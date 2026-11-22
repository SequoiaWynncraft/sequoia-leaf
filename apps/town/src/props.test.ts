import { describe, expect, test } from "bun:test";

import { covered, hidden, parted, WINDOW } from "./props.ts";

/** A member standing at (100, 100): their head tops out at 79, and their chest ends at 91. */
const FOOT = { x: 100, y: 100 };

describe("whether a member is hidden", () => {
  test("how much is covered is counted over the head and chest only", () => {
    expect(covered(() => true, FOOT, 21)).toBe(1);
    expect(covered(() => false, FOOT, 21)).toBe(0);
    // A bush up to the hips covers none of it; a canopy down to the chin covers the head, 8 rows of 12.
    expect(covered((_x, y) => y >= 91, FOOT, 21)).toBe(0);
    expect(covered((_x, y) => y < 87, FOOT, 21)).toBeCloseTo(8 / 12);
    // A post over the left half of the figure covers half.
    expect(covered((x) => x < 100, FOOT, 21)).toBe(0.5);
    // Somebody sitting is shorter: the same canopy covers nothing of them.
    expect(covered((_x, y) => y < 84, FOOT, 16)).toBe(0);
  });

  test("hidden from half covered; once hidden, until less than a quarter is", () => {
    expect(hidden(0.5, false)).toBe(true);
    expect(hidden(0.49, false)).toBe(false);
    expect(hidden(0.3, true)).toBe(true);
    expect(hidden(0.2, true)).toBe(false);
  });
});

/** How many pixels a window at (100, 90), opened so far, leaves out. */
function leftOut(open: number): number {
  let n = 0;
  for (let y = 70; y <= 110; y++) for (let x = 88; x <= 112; x++) if (parted(x, y, [{ x: 100, y: 90, open }])) n++;
  return n;
}

describe("the window round a member behind something", () => {
  const one = [{ x: 100, y: 90, open: 1 }];

  test("open over the whole figure, shut beyond its reach, and nothing while it has not opened", () => {
    for (const [dx, dy] of [
      [0, 0],
      [-4, -10],
      [4, 10],
    ] as const)
      expect(parted(100 + dx, 90 + dy, one)).toBe(true);
    expect(parted(100 + WINDOW.w, 90, one)).toBe(false);
    expect(parted(100, 90 - WINDOW.h, one)).toBe(false);
    expect(parted(100, 90, [{ x: 100, y: 90, open: 0 }])).toBe(false);
  });

  test("its edge is dithered: every other pixel is left out, on squares fixed to the place", () => {
    // 7 across from the middle is in the edge: only pixels whose x and y add up even are left out.
    expect([88, 89, 90, 91, 92].map((y) => parted(107, y, one))).toEqual([false, true, false, true, false]);
    // The squares are the place's, not the window's: a member one pixel on has the same rule.
    const walked = [{ x: 101, y: 90, open: 1 }];
    expect([88, 89, 90, 91, 92].map((y) => parted(108, y, walked))).toEqual([true, false, true, false, true]);
  });

  test("it grows as it opens", () => {
    expect(leftOut(0.25)).toBeGreaterThan(0);
    expect(leftOut(0.5)).toBeGreaterThan(leftOut(0.25));
    expect(leftOut(1)).toBeGreaterThan(leftOut(0.5));
  });

  test("two near one another run together into one", () => {
    const left = { x: 100, y: 90, open: 1 };
    const right = { x: 114, y: 90, open: 1 };
    // Half way between them, a row no window alone leaves out whole.
    const row = (through: (typeof left)[]): boolean[] => [105, 106, 107, 108, 109].map((x) => parted(x, 90, through));
    expect(row([left])).toContain(false);
    expect(row([right])).toContain(false);
    expect(row([left, right])).toEqual([true, true, true, true, true]);
  });
});
