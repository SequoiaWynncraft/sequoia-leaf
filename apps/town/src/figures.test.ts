import { expect, test } from "bun:test";

import { ART } from "@sequoia-leaf/figures/figures.ts";
import { FIGURE_IDS } from "@sequoia-leaf/raid/content/figures.ts";
import { figureThing, thingOf } from "@sequoia-leaf/town/things.ts";

import { CELL } from "./grid.ts";

test("every figure of the raid has a thing for the camp and a picture no wider than the ground it takes", () => {
  const wrong = FIGURE_IDS.filter((id) => {
    const thing = thingOf(figureThing(id));
    // Its rows as typed, and the dark edge the baking adds on either side.
    const wide = Math.max(0, ...ART[id].rows.map((row) => row.length)) + 2;
    return !thing || wide <= 2 || wide > thing.w * CELL;
  });
  expect(wrong).toEqual([]);
});
