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
  BENCH,
  build,
  carried,
  create,
  feeders,
  item,
  kind,
  makes,
  MILL,
  price,
  RECIPE,
  setRecipe,
  type Yard,
} from "@sequoia-leaf/factory";
import { xy } from "@sequoia-leaf/factory/test/near.ts";
import { deck } from "@sequoia-leaf/kit/card.ts";

import { PAGES } from "./kinds/index.ts";
import type { Lamp } from "./lamps.ts";
import { markedTiles, pinBoxes } from "./pinned.ts";
import { blockColour } from "./plan.ts";
import { DRAWN, draws, S } from "./state.ts";
import { itemRef, tileRef } from "./ui/card.ts";
import { madeSays } from "./ui/flow.ts";
import { printOf } from "./ui/prints.ts";

const ASSEMBLER = kind("assembler");

/** A yard with tier 5's research done, an assembler of a grade at (-6, -4) told to make tools, and a belt of `belt`'s grade ahead of its way out, or none. */
function hall(grade: number, belt: number | null): Yard {
  const y = create({ seed: 5, tier: 6 });
  expect(build(y, ASSEMBLER, ...xy(-6, -4), 0, Infinity, { grade })).toEqual({
    ok: true,
    cost: price(ASSEMBLER, grade),
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

  test("where its belt carries less than it makes, says up to that in its header, its output and its parts, and counts the mills for that", () => {
    const tool = RECIPE[item("tool")];
    if (!tool) throw new Error("no recipe");
    // A grade I hall makes 270 tools a minute; a grade I belt carries 150: its header and its output say
    // up to 150, its parts are what 150 tools take, and the mills before them are counted for 150.
    const capped = printOf(tileRef(at(hall(1, 1), ...xy(-6, -4))));
    const mills = feeders(1, tool, 1).map((f) => (f.count * 150) / makes(tool.by, 1, tool));
    expect(capped).toMatchObject({
      flow: {
        perMinute: 150,
        most: 150,
        parts: [
          { item: item("plank"), perMinute: 150, by: { kind: MILL, count: expect.closeTo(mills[0] ?? 0, 9) } },
          { item: item("ingot"), perMinute: 150, by: { kind: MILL, count: expect.closeTo(mills[1] ?? 0, 9) } },
        ],
      },
    });
    expect(capped?.card === "standing" && capped.flow ? madeSays(capped.flow) : null).toBe("up to 150 /min");
    expect(carried(1)).toBe(150);
    // A grade III hall makes 540 a minute; a grade III belt carries 300.
    expect(printOf(tileRef(at(hall(3, 3), ...xy(-6, -4))))).toMatchObject({ flow: { perMinute: 300, most: 300 } });
    // A grade I hall onto a grade III belt makes less than it carries: its own number, no "up to".
    const free = printOf(tileRef(at(hall(1, 3), ...xy(-6, -4))));
    expect(free).toMatchObject({ flow: { perMinute: 270, most: null } });
    expect(free?.card === "standing" && free.flow ? madeSays(free.flow) : null).toBe("270 /min");
  });
});

describe("the assembler on the page", () => {
  test("is drawn and in the dock, has a lamp while it works, and is brick on the map", () => {
    expect([DRAWN.includes(ASSEMBLER), draws(ASSEMBLER)]).toEqual([true, true]);
    expect(PAGES.assembler.dock).toBe(15);
    expect(blockColour(ASSEMBLER)).toBe(PAGES.assembler.map?.[0] ?? "");
    const out: Lamp[] = [];
    const lit = { pace: 1, bright: 1, reach: 1, tall: false, kiln: () => false };
    PAGES.assembler.lamps?.(S.world, 0, 100, 200, { ...lit, working: () => true }, out);
    PAGES.assembler.lamps?.(S.world, 0, 100, 200, { ...lit, working: () => false }, out);
    expect(out).toEqual([{ x: 100, y: 188, r: 26, power: 0.6, reach: false }]);
  });

  test("is listed on the card of each thing it makes once the yard may build it, with what one makes a minute", () => {
    hall(1, null);
    expect(printOf(itemRef(item("tool")))).toMatchObject({ makers: [BENCH, ASSEMBLER] });
    S.world = create({ seed: 5, tier: 5 });
    expect(printOf(itemRef(item("tool")))).toMatchObject({ makers: [BENCH] });
  });

  test("pinned, is marked round all 9 of its tiles as one box", () => {
    const y = hall(1, null);
    const own = at(y, ...xy(-6, -4));
    deck.open = { stack: [`tile:${own}`], pinned: true, via: "mouse", at: {}, from: {}, side: false, preview: false };
    try {
      expect(markedTiles().toSorted((a, b) => a - b)).toEqual(
        [-1, 0, 1].flatMap((dz) => [-1, 0, 1].map((dx) => at(y, ...xy(-6 + dx, -4 + dz)))).toSorted((a, b) => a - b),
      );
      const [x0, z0] = xy(-7, -5);
      expect(pinBoxes(y, 0, 0, 0, 0)).toEqual([{ x: x0 * 16, y: z0 * 16, w: 48, h: 48 }]);
    } finally {
      deck.open = null;
    }
  });
});
