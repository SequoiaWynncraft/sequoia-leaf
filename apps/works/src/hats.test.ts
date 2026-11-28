/** A gatherer's hat says its grade: each grade its own colour, none of them Pipwick's. */

import { describe, expect, test } from "bun:test";

import { GRADES } from "@sequoia-leaf/factory/content/machines.ts";

import { gathererHat, PIPWICK_HAT } from "./art/hats.ts";

describe("a gatherer's hat", () => {
  test("each grade has a hat of its own, and none is Pipwick's", () => {
    const hats = GRADES.map((_, i) => gathererHat(i + 1));
    expect(new Set(hats).size).toBe(GRADES.length);
    expect(hats).not.toContain(PIPWICK_HAT);
  });
});
