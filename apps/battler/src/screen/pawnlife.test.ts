import { describe, expect, test } from "bun:test";

import { fadingOf, goneOnLanding, type Life, lifeAfter, type LifeEvent, placeOf } from "./pawnlife.ts";

const after = (life: Life, ...events: LifeEvent[]): Life => events.reduce(lifeAfter, life);
const seat = { on: "board", at: 3 } as const;
const bench = { on: "bench", at: 0 } as const;

describe("a pawn's life", () => {
  test("here, it has its place, and goes with its figure to another", () => {
    const here: Life = { is: "here", spot: seat };
    expect(placeOf(here)).toEqual(seat);
    expect(placeOf(after(here, { e: "placed", spot: bench }))).toEqual(bench);
    expect(goneOnLanding(here)).toBe(false);
  });

  test("going into another figure, it has no place, waits, and is gone when its last hop lands", () => {
    const spoken = after({ is: "here", spot: seat }, { e: "spoken", to: "merge" });
    expect([placeOf(spoken), goneOnLanding(spoken), fadingOf(spoken)]).toEqual([null, false, false]);
    const hopping = after(spoken, { e: "last hop" });
    expect(goneOnLanding(hopping)).toBe(true);
  });

  test("sold, it fades on its last hop to the stall", () => {
    const sold = after({ is: "here", spot: bench }, { e: "spoken", to: "stall" }, { e: "last hop" });
    expect([placeOf(sold), fadingOf(sold), goneOnLanding(sold)]).toEqual([null, true, true]);
  });

  test("bought straight into three of a kind, it is loose until it goes into the one that stays", () => {
    const loose: Life = { is: "loose" };
    expect([placeOf(loose), goneOnLanding(loose)]).toEqual([null, false]);
    expect(after(loose, { e: "last hop" })).toBe(loose);
    expect(goneOnLanding(after(loose, { e: "spoken", to: "merge" }, { e: "last hop" }))).toBe(true);
  });

  test("a figure the rules still have at a place is here again, even on its way out; spoken for twice, the first stands", () => {
    const going = after({ is: "here", spot: seat }, { e: "spoken", to: "merge" }, { e: "last hop" });
    expect(after(going, { e: "placed", spot: seat })).toEqual({ is: "here", spot: seat });
    expect(after(going, { e: "spoken", to: "stall" })).toBe(going);
  });
});
