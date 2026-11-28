import { describe, expect, test } from "bun:test";

import { type Ctx, DAY_MS } from "@sequoia-leaf/core";
import { pinTests } from "@sequoia-leaf/core/review/checks.ts";
import { readsOtherwise } from "@sequoia-leaf/core/review/pins.ts";

import { TOWN } from "../src/game.ts";
import { PINS, played, seenNow, VERSIONS } from "./pins.ts";

const ctx = (now: number): Ctx => ({
  now,
  player: { id: "00000000-0000-4000-8000-00000000601d", guest: false },
  seed: 7,
  room: 1e9,
  awards: [],
  postcards: {},
});
const seen = () => {
  const s = seenNow();
  played(s);
  return s;
};

describe("the town's stored shapes", () => {
  pinTests(PINS, seen, VERSIONS, "town_");
  test.each(PINS.rows("town").map((r) => [r.path, r.row] as const))(
    "%s reads as the town it was written from, reads the same once stored again, and goes on a week",
    (_, row) => {
      const s = TOWN.decode(row.text);
      if (!s) throw new Error("does not read");
      expect(readsOtherwise(row.read, s)).toEqual([]);
      expect(TOWN.decode(TOWN.encode(s))).toEqual(s);
      const later = TOWN.advance(s, ctx(s.nextCall + 7 * DAY_MS));
      expect(TOWN.decode(TOWN.encode(later))).toEqual(later);
    },
  );
});
