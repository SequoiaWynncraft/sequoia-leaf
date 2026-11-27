/**
 * The assembler on the page: its card says what it makes a minute as 9 benches or 9 workshops, and
 * how many of the machine before it each part takes at that pace; where that is more than the belt it
 * hands to carries, it says "up to" what the belt carries. It is in the dock once its research is
 * done, and is drawn, lit and coloured on the map as its module says.
 */
import { describe, expect, test } from "bun:test";

import {
  at,
  BELT,
  build,
  carried,
  create,
  feeders,
  item,
  kind,
  makes,
  MILL,
  RECIPE,
  setRecipe,
  type Yard,
} from "@sequoia-leaf/factory";
import { xy } from "@sequoia-leaf/factory/test/near.ts";

import { PAGES } from "./kinds/index.ts";
import type { Lamp } from "./lamps.ts";
import { blockColour } from "./plan.ts";
import { DRAWN, draws, S } from "./state.ts";
import { tileRef } from "./ui/card.ts";
import { printOf } from "./ui/prints.ts";

const ASSEMBLER = kind("assembler");

/** A yard with tier 5's research done, an assembler of a grade at (-6, -4) told to make tools, and a belt of `belt`'s grade ahead of its way out, or none. */
function hall(grade: number, belt: number | null): Yard {
  const y = create({ seed: 5, tier: 6 });
  expect(build(y, ASSEMBLER, ...xy(-6, -4), 0, Infinity, { grade })).toEqual({
    ok: true,
    cost: [400, 1200, 3200][grade - 1],
  });
  expect(setRecipe(y, ...xy(-6, -4), item("tool"))).toBeNull();
  if (belt !== null) expect(build(y, BELT, ...xy(-4, -4), 0, Infinity, { grade: belt }).ok).toBe(true);
  S.world = y;
  return y;
}

describe("the assembler's card", () => {
  test("says what it makes a minute as 9 benches, and the mills its parts take at that pace", () => {
    const y = hall(1, null);
    const tool = RECIPE[item("tool")];
    if (!tool) throw new Error("no recipe");
    const bench = makes(tool.by, 1, tool);
    const mills = feeders(1, tool, 1).map((f) => 9 * f.count);
    expect(printOf(tileRef(at(y, ...xy(-6, -4))))).toMatchObject({
      perMinute: `${9 * bench} /min`,
      flow: {
        out: item("tool"),
        perMinute: 9 * bench,
        most: null,
        parts: [
          { item: item("plank"), perMinute: 9 * bench, by: { kind: MILL, count: expect.closeTo(mills[0] ?? 0, 9) } },
          { item: item("ingot"), perMinute: 9 * bench, by: { kind: MILL, count: expect.closeTo(mills[1] ?? 0, 9) } },
        ],
      },
    });
  });

  test("says up to what its belt carries where it makes more: 270 a minute onto a grade I belt carrying 150", () => {
    expect(printOf(tileRef(at(hall(1, 1), ...xy(-6, -4))))).toMatchObject({
      flow: { perMinute: 270, most: carried(1) },
    });
    expect(carried(1)).toBe(150);
    // A grade III hall makes 540 a minute; a grade III belt carries 300.
    expect(printOf(tileRef(at(hall(3, 3), ...xy(-6, -4))))).toMatchObject({ flow: { perMinute: 540, most: 300 } });
    // A grade I hall onto a grade III belt makes less than it carries: no "up to".
    expect(printOf(tileRef(at(hall(1, 3), ...xy(-6, -4))))).toMatchObject({ flow: { perMinute: 270, most: null } });
  });
});

describe("the assembler on the page", () => {
  test("is drawn and in the dock, has a lamp while it works, and is brick on the map", () => {
    expect([DRAWN.includes(ASSEMBLER), draws(ASSEMBLER)]).toEqual([true, true]);
    expect(PAGES.assembler.dock).toBe(15);
    expect(blockColour(ASSEMBLER)).toBe(PAGES.assembler.map?.[0]);
    const out: Lamp[] = [];
    const lit = { pace: 1, bright: 1, reach: 1, tall: false, kiln: () => false };
    PAGES.assembler.lamps?.(S.world, 0, 100, 200, { ...lit, working: () => true }, out);
    PAGES.assembler.lamps?.(S.world, 0, 100, 200, { ...lit, working: () => false }, out);
    expect(out).toEqual([{ x: 100, y: 188, r: 26, power: 0.6, reach: false }]);
  });
});
