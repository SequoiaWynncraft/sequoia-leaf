import { expect, test } from "bun:test";

import { artOf } from "@sequoia-leaf/figures/figures.ts";
import { TOWNS_OWN } from "@sequoia-leaf/figures/pal.ts";
import { everyShared } from "@sequoia-leaf/raid/content/catalog.ts";
import { CELL } from "@sequoia-leaf/town/map/grid.ts";
import { figureThing, thingOf } from "@sequoia-leaf/town/things.ts";

test("every figure of the raid has a thing for the camp and a picture no wider than the ground it takes", () => {
  const wrong = everyShared().filter((id) => {
    const thing = thingOf(figureThing(id));
    // Its rows as typed, and the dark edge the baking adds on either side.
    const wide = Math.max(0, ...artOf(id).rows.map((row) => row.length)) + 2;
    return !thing || wide <= 2 || wide > thing.w * CELL;
  });
  expect(wrong).toEqual([]);
});

test("a colour the figures take from the town's own creatures is one the town draws them in", async () => {
  const art = await Promise.all(
    ["folkart.ts", "campart.ts", "sprites.ts"].map((file) => Bun.file(`${import.meta.dir}/${file}`).text()),
  );
  const gone = Object.values(TOWNS_OWN).filter((colour) => !art.some((source) => source.includes(`"${colour}"`)));
  expect(gone).toEqual([]);
});
