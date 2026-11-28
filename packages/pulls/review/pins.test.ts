import { describe, expect, test } from "bun:test";

import { pinTests } from "@sequoia-leaf/core/review/checks.ts";
import { readsOtherwise } from "@sequoia-leaf/core/review/pins.ts";

import { PULLS } from "../src/game.ts";
import { PINS, played, pullsMaterial, seenNow, storedAgain, VERSIONS } from "./pins.ts";

const seen = () => {
  const s = seenNow();
  played(s);
  storedAgain(s);
  return s;
};

describe("the pulls' stored shapes", () => {
  pinTests(PINS, seen, VERSIONS, "pulls_");
  test.each(PINS.rows("pulls").map((r) => [r.path, r.row] as const))(
    "%s reads, on its first read, with all it was written with, and the same once stored again",
    (_, row) => {
      const s = PULLS.decode(row.text);
      if (!s) throw new Error("does not read");
      expect(readsOtherwise(row.read, pullsMaterial(s))).toEqual([]);
      expect(PULLS.decode(PULLS.encode(s))).toEqual(s);
    },
  );
});
