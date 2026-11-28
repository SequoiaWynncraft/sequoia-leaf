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
  GOALS,
  holderOf,
  item,
  kind,
  makes,
  MILL,
  NONE,
  power,
  price,
  put,
  RECIPE,
  reopen,
  setRecipe,
  step,
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
import { adviceOf, saidOf } from "./ui/cards.ts";
import { madeSays } from "./ui/flow.ts";
import { printOf } from "./ui/prints.ts";

const ASSEMBLER = kind("assembler");

/** A yard with tier 5's research done, an assembler of a grade at (-6, -4) told to make tools, and a belt of `belt`'s grade ahead of its way out, or none. */
function hall(grade: number, belt: number | null): Yard {
  const y = create({ seed: 5, tier: 6 });
  // But for tier 5's long work that raises the depot's power to 150: the numbers here are the depot's 100.
  y.done = y.done.filter((g) => GOALS[g]?.id !== "wholewood");
  reopen(y);
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

  test("between batches says what it said during them: counted for what it last made", () => {
    const y = hall(1, 1);
    expect(setRecipe(y, ...xy(-6, -4), null)).toBeNull();
    const own = at(y, ...xy(-6, -4));
    const r = holderOf(y, own);
    put(y.holders, r, item("plank"));
    put(y.holders, r, item("ingot"));
    for (let t = 0; t < 60; t++) step(y);
    // Its tool is on the belt and it holds nothing: still up to 150 a minute, not its kind's range.
    expect([y.holders.count[r], y.holders.out[r]]).toEqual([0, NONE]);
    const p = printOf(tileRef(own));
    expect(p?.card === "standing" && p.flow ? [p.flow.out, madeSays(p.flow)] : null).toEqual([
      item("tool"),
      "up to 150 /min",
    ]);
  });

  test("short of power, counts the machines before it at the same share of power", () => {
    const y = hall(1, 1);
    // Two more halls and three benches near the depot: 120 drawn for the depot's 100.
    for (const [dx, dz] of [
      [-6, 1],
      [4, -5],
    ] as const)
      expect(build(y, ASSEMBLER, ...xy(dx, dz), 0, Infinity).ok).toBe(true);
    for (const dx of [2, 3, 4]) expect(build(y, BENCH, ...xy(dx, 3), 0, Infinity).ok).toBe(true);
    const share = power(y).pace;
    expect(share).toBeLessThan(1);
    const tool = RECIPE[item("tool")];
    if (!tool) throw new Error("no recipe");
    const p = printOf(tileRef(at(y, ...xy(-6, -4))));
    const flow = p?.card === "standing" ? p.flow : null;
    // It makes 270 a minute at full power: 270 times the share, then no more than the belt's 150.
    const now = Math.min(270 * share, 150);
    expect(flow?.perMinute).toBeCloseTo(now, 9);
    // Each mill makes its flat-out pace times the share: as many as make `now` planks at that.
    const mill = makes(MILL, 1, RECIPE[item("plank")] ?? null);
    expect(flow?.parts[0]?.by?.count).toBeCloseTo(now / (mill * share), 9);
  });

  test("full of one part, says the rules' own diagnosis, and its advice names the assembler", () => {
    const y = hall(1, null);
    const own = at(y, ...xy(-6, -4));
    expect(setRecipe(y, ...xy(-6, -4), null)).toBeNull();
    const r = holderOf(y, own);
    for (let n = 0; n < 36; n++) put(y.holders, r, item("glass"));
    const p = printOf(tileRef(own));
    if (p?.card !== "standing") throw new Error("no card");
    expect([p.state, p.trouble]).toEqual(["starved", true]);
    expect(saidOf(p)).toBe(p.line ?? "");
    expect(saidOf(p).startsWith("Full of glass")).toBe(true);
    expect(adviceOf(p)?.startsWith("An assembler takes things in at its back and both sides.")).toBe(true);
  });
});
