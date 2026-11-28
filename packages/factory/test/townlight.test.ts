/**
 * Tier 5's commission made by the real rules (`townlight.ts`): a staged top yard sorting three
 * breakers' mixed belts finishes "Lamps that light themselves"; the same yard with no way for its
 * slag stops at the depot, which does not take it, and never does.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { townlightYard } from "./townlight.ts";

const TOWNLIGHT = F.goal("townlight");
/** What the commission has been given of each thing it wants. */
const given = (y: F.Yard): number[] =>
  (["telegraph", "lights", "spark"] as const).map((n) => y.got[TOWNLIGHT]?.[F.item(n)] ?? 0);

describe("the commission of tier 5, by the real rules", () => {
  test("a staged top yard, its slag sorted into gravel, makes 800 telegraphs, 800 strings of lights and 600 Spark folios", () => {
    const y = townlightYard(true);
    expect(F.GOALS[y.hand]?.id).toBe("townlight");
    let ticks = 0;
    while (!y.done.includes(TOWNLIGHT) && ticks < 200_000) {
      F.step(y);
      ticks++;
    }
    expect([y.done.includes(TOWNLIGHT), F.power(y).speed]).toEqual([true, 100]);
    // About three hours of the yard's time from the opening of the tier, a fair part of SPEC-2's 2 to 3 days.
    expect(ticks).toBeLessThan(120_000);
    expect(y.news.some((n) => n.kind === "done" && n.goal === "townlight")).toBe(true);
  });

  test("the same yard with no way for its slag stops at the depot, which does not take it, and does not finish", () => {
    const y = townlightYard(false);
    for (let k = 0; k < 200_000; k++) F.step(y);
    expect(y.done.includes(TOWNLIGHT)).toBe(false);
    const [telegraphs = 0, lights = 0, folios = 0] = given(y);
    expect([telegraphs < 100, lights < 100, folios < 100]).toEqual([true, true, true]);
    const lines = new Set<string>();
    for (let i = 0; i < y.kind.length; i++) {
      const line = F.status(y, i)?.line;
      if (line) lines.add(line);
    }
    expect(lines.has("Slag has nowhere to go: the depot does not take it.")).toBe(true);
  });
});
