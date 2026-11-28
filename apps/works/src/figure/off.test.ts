/**
 * Reach is off for now (`reach.ts`): with a figure on a corner plot, the far side of the land is in
 * reach and a build there goes through, and the research that only widens reach is not listed. A
 * yard that knows it keeps it.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { create, goal, GOALS, LAND, MILL, reopen } from "@sequoia-leaf/factory";

import { opened, useFakeLeaf } from "../../test/fake-leaf.ts";
import { researchOf } from "../ui/standing.ts";
import { beyondReach, REACH_RESEARCH, reachBox, reaches, reachRule } from "./reach.ts";
import { leave, placeYou } from "./you.ts";

useFakeLeaf();
afterEach(() => leave());

describe("reach is off", () => {
  test("from a corner plot, every tile of the land is in reach and a far build is not refused", async () => {
    const y = create({ seed: 6, tier: 5 });
    y.plots = LAND.plots.map((p) => p.plot);
    reopen(y);
    await opened(y);
    const corner = LAND.plots.reduce((a, p) => (p.x + p.y < a.x + a.y ? p : a));
    placeYou({ x: (corner.x + 1) * 16, y: (corner.y + 1) * 16 });
    expect(reachRule.on).toBe(false);
    expect(reachBox()).toBeNull();
    expect(reaches(LAND.w - 1, LAND.h - 1)).toBe(true);
    expect(beyondReach({ do: "build", kind: MILL, x: LAND.w - 8, y: LAND.h - 8, dir: 0, grade: 1 })).toBeNull();
  });

  test("the reach research is not listed, and a yard that knows it keeps it", async () => {
    const y = create({ seed: 6, tier: 5 });
    y.done = [...y.done.filter((g) => !REACH_RESEARCH.includes(GOALS[g]?.id ?? "")), goal("longreach")];
    reopen(y);
    await opened(y);
    const listed = researchOf().map((g) => GOALS[g]?.id);
    expect(listed.length).toBeGreaterThan(0);
    for (const id of REACH_RESEARCH) expect(listed).not.toContain(id);
    expect([y.done.includes(goal("longreach")), y.open.range]).toEqual([true, 2]);
  });
});
