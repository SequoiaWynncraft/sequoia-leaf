import { describe, expect, test } from "bun:test";

import { pinsNow } from "@sequoia-leaf/core/review/pins.ts";

import { decodePulls, encodePulls } from "../src/game.ts";
import { PINS, played, seenNow, storedAgain, VERSIONS } from "./pins.ts";

describe("the pulls' stored shapes", () => {
  test("are written with the keys pinned beside their versions, and every row first seen is kept", () => {
    const seen = seenNow();
    played(seen);
    storedAgain(seen);
    expect(pinsNow(PINS, seen, VERSIONS)).toEqual({ refused: [], unpinned: [], unkept: [] });
  });
  test.each(PINS.rows("pulls"))("%s reads, and reads the same once stored again", (_, text) => {
    const s = decodePulls(text);
    if (!s) throw new Error("does not read");
    expect(decodePulls(encodePulls(s))).toEqual(s);
  });
});
