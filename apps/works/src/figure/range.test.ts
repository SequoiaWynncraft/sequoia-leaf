/**
 * Reach grows with research: the one box every question of reach asks (`reachBox`) is the plot you
 * stand on and the yard's range of plots out on every side, 1, 2 with Long reach and 3 with Longer
 * reach, on the guild's land and on one grown by two rings (7 plots a side). A card's Upgrade is the
 * grade command, so a piece far out of reach is raised from its card, for what a build over it costs.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { at, build, create, goal, LAND, type Land, MILL, priceAt, reopen, type Yard } from "@sequoia-leaf/factory";
import { SEVEN } from "@sequoia-leaf/factory/test/ring.ts";

import { opened, until, useFakeLeaf } from "../../test/fake-leaf.ts";
import { S } from "../state.ts";
import { raiseAt } from "../tools.ts";
import { beyondReach, OUT_OF_REACH, reachBox, reaches } from "./reach.ts";
import { leave, placeYou } from "./you.ts";

useFakeLeaf();
afterEach(() => leave());

const REACHES = ["longreach", "longerreach"] as const;
/** A yard at tier 5 on a land, owning every plot of it, with so many of the reach research known: 0, 1 or 2. */
function yardOf(land: Land, known: number): Yard {
  const y = create({ seed: 6, tier: 5, land });
  y.plots = land.plots.map((p) => p.plot);
  const keep = REACHES.slice(0, known).map(goal);
  y.done = [...y.done.filter((g) => !REACHES.some((id) => goal(id) === g)), ...keep];
  reopen(y);
  return y;
}
/** The middle of a plot, in pixels of the art, by its column and row of plots across the land. */
function plotMiddle(land: Land, col: number, row: number): { x: number; y: number } {
  const p = land.plots.find((q) => q.x === col * q.w && q.y === row * q.h);
  if (!p) throw new Error(`no plot at ${col}, ${row}`);
  return { x: (p.x + p.w / 2) * 16, y: (p.y + p.h / 2) * 16 };
}

/** Stands you on a plot of a yard and gives back the reach box. */
function boxFrom(y: Yard, col: number, row: number): ReturnType<typeof reachBox> {
  S.world = y;
  S.visiting = null;
  leave();
  placeYou(plotMiddle(y.land, col, row));
  return reachBox();
}

describe("the reach box grows with the yard's range", () => {
  test("on the guild's land: from a corner plot the eight round it, then the whole yard; from the middle, the whole yard always", () => {
    for (const [known, corner] of [
      [0, { x0: -16, y0: -12, x1: 31, y1: 23 }],
      [1, { x0: -32, y0: -24, x1: 47, y1: 35 }],
      [2, { x0: -48, y0: -36, x1: 63, y1: 47 }],
    ] as const) {
      const y = yardOf(LAND, known);
      expect([known, y.open.range]).toEqual([known, known + 1]);
      expect(boxFrom(y, 0, 0)).toEqual(corner);
      // The far corner of the yard: out of reach at 1 plot, in reach at 2.
      expect([known, reaches(47, 35)]).toEqual([known, known > 0]);
      expect(boxFrom(y, 1, 1)).toEqual({
        x0: 16 - (known + 1) * 16,
        y0: 12 - (known + 1) * 12,
        x1: 16 + (known + 2) * 16 - 1,
        y1: 12 + (known + 2) * 12 - 1,
      });
      expect([reaches(0, 0), reaches(47, 35)]).toEqual([true, true]);
    }
  });

  test("on a land of 7 plots a side: from a corner plot and from the middle, 1, 2 and 3 plots out", () => {
    const land = SEVEN;
    expect([land.w, land.h]).toEqual([7 * 16, 7 * 12]);
    for (const known of [0, 1, 2]) {
      const r = known + 1;
      const y = yardOf(land, known);
      expect(boxFrom(y, 0, 0)).toEqual({ x0: -r * 16, y0: -r * 12, x1: (r + 1) * 16 - 1, y1: (r + 1) * 12 - 1 });
      expect([reaches((r + 1) * 16 - 1, 0), reaches((r + 1) * 16, 0), reaches(0, (r + 1) * 12)]).toEqual([
        true,
        false,
        false,
      ]);
      expect(boxFrom(y, 3, 3)).toEqual({
        x0: (3 - r) * 16,
        y0: (3 - r) * 12,
        x1: (4 + r) * 16 - 1,
        y1: (4 + r) * 12 - 1,
      });
      // From the middle at 3 plots out, the whole land.
      expect([known, reaches(0, 0), reaches(land.w - 1, land.h - 1)]).toEqual([known, r === 3, r === 3]);
      // What a press would send is judged on the same box: the first tile past it, while there is one on the land.
      const far = { do: "build", kind: MILL, x: (4 + r) * 16, y: 40, dir: 0, grade: 1 } as const;
      if (r < 3) expect(beyondReach(far)).toEqual({ refused: "out_of_reach", why: OUT_OF_REACH });
      expect(beyondReach({ ...far, x: (4 + r) * 16 - 1 })).toBeNull();
    }
  });
});

describe("a card's Upgrade, from anywhere", () => {
  test("a piece far out of reach is raised from its card: the grade command, charged what the build over it cost", async () => {
    const y = yardOf(LAND, 0);
    if (!build(y, MILL, 44, 33, 0, Infinity).ok) throw new Error("no mill");
    const fake = await opened(y, 100_000);
    // Windfall Hollow, the north-west corner: the mill, in the south-east corner, is two plots away.
    placeYou({ x: 8 * 16 + 8, y: 6 * 16 + 8 });
    expect(reaches(44, 33)).toBe(false);
    const cost = priceAt(S.world, MILL, 44, 33, 2);
    expect(beyondReach({ do: "build", kind: MILL, x: 44, y: 33, dir: 0, grade: 2 })).not.toBeNull();
    expect(raiseAt(44, 33)).toBe(true);
    const i = at(S.world, 44, 33);
    expect(S.world.grade[i]).toBe(2);
    await until(() => fake.leaf.commands.length > 0);
    expect(fake.leaf.commands).toMatchObject([{ do: "upgrade", tiles: [i], grade: 2, kind: "mill", from: 1 }]);
    expect(fake.leaf.coins).toBe(100_000 - cost);
  });
});
