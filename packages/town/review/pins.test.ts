import { describe, expect, test } from "bun:test";

import { type Ctx, DAY_MS } from "@sequoia-leaf/core";
import { pinsNow } from "@sequoia-leaf/core/review/pins.ts";

import { decodeTown, encodeTown, TOWN } from "../src/game.ts";
import { PINS, played, seenNow, VERSIONS } from "./pins.ts";

const ctx = (now: number): Ctx => ({
  now,
  player: { id: "00000000-0000-4000-8000-00000000601d", guest: false },
  seed: 7,
  room: 1e9,
  awards: [],
  postcards: {},
});

describe("the town's stored shapes", () => {
  test("are written with the keys pinned beside their versions, and every row first seen is kept", () => {
    const seen = seenNow();
    played(seen);
    expect(pinsNow(PINS, seen, VERSIONS)).toEqual({ refused: [], unpinned: [], unkept: [] });
  });
  test.each(PINS.rows("town"))("%s reads, reads the same once stored again, and goes on a week", (_, text) => {
    const s = decodeTown(text);
    if (!s) throw new Error("does not read");
    expect(encodeTown(s)).toBe(JSON.stringify(JSON.parse(text)));
    const later = TOWN.advance(s, ctx(s.nextCall + 7 * DAY_MS));
    expect(decodeTown(encodeTown(later))).toEqual(later);
  });
});
