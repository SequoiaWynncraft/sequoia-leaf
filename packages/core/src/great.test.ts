import { describe, expect, it } from "bun:test";

import { contributionsOf, goalProgress, greatWeek, lanternGlow, offeringAllowed } from "./great.ts";
import { DEFAULT_RULES } from "./rules.ts";

const rules = DEFAULT_RULES.great;
const nothing = { raids: 0, wars: 0, offeredLeaf: 0 };

describe("the Great Sequoia's week", () => {
  it("runs Monday to Monday in UTC", () => {
    // Friday 20 November 2026.
    const week = greatWeek(Date.UTC(2026, 10, 20, 15));

    expect(new Date(week.start).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(new Date(week.end).toISOString()).toBe("2026-11-23T00:00:00.000Z");
  });
});

describe("the weekly goals", () => {
  it("are three: raids, Leaf offered and wars", () => {
    expect(rules.goals.map((goal) => goal.kind)).toEqual(["raids", "offered_leaf", "wars"]);
  });

  it("each count their own total, and stop at their target", () => {
    const [raids, offered, wars] = rules.goals;
    const totals = { raids: 10, wars: 5_000, offeredLeaf: 2_500 };

    expect(raids && goalProgress(raids, totals)).toEqual({ progress: 10, met: false });
    expect(offered && goalProgress(offered, totals)).toEqual({ progress: 2_500, met: false });
    expect(wars && goalProgress(wars, totals)).toEqual({ progress: 3_000, met: true });
  });
});

describe("lanterns", () => {
  it("count each raid, each war and each hundred Leaf offered as one contribution", () => {
    expect(contributionsOf({ raids: 2, wars: 3, offeredLeaf: 250 }, rules)).toBe(7);
  });

  it("hang for anyone who helped, glowing brighter in steps for more help", () => {
    expect(lanternGlow(contributionsOf(nothing, rules), rules)).toBe(0);
    expect([1, 9, 10, 29, 30, 500].map((count) => lanternGlow(count, rules))).toEqual([1, 1, 2, 2, 3, 3]);
  });
});

describe("offerings", () => {
  it("take whole Leaf from 100 to 10,000", () => {
    expect([99, 100, 150, 10_000, 10_001, 100.5].map((leaf) => offeringAllowed(leaf, rules))).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});
