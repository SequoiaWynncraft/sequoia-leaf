/**
 * The story played by script on both rules from a new yard: the same commands, compared after each
 * and every 100 ticks, through the first orders of the story; then a standing order filled and
 * handed over the same way.
 */
import { expect, test } from "bun:test";

import * as Y from "@sequoia-leaf/yard";

import * as F from "../src/index.ts";
import { Pair } from "./sides.ts";
import { fillStanding, playStory } from "./story.ts";

test("the story, played by script from a new yard, is the same game in both through its first fifteen orders and a standing order handed over", () => {
  const pair = new Pair(Y.create({ seed: 20261121 }), F.create({ seed: 20261121 }));
  const t0 = performance.now();
  playStory(pair, 15);
  expect(pair.yard.story).toBeGreaterThanOrEqual(15);
  expect(pair.flat.story).toBe(pair.yard.story);
  fillStanding(pair);
  expect(pair.yard.done).toBeGreaterThanOrEqual(1);
  expect(pair.flat.done).toBe(pair.yard.done);
  console.log(
    `story ${pair.yard.story}, standing orders handed over ${pair.yard.done}, plans ${pair.yard.plans.join(" ")}, plots ${pair.yard.plots.join(" ")}: ${pair.commands} commands, ${pair.ticks} ticks, ${pair.compared} comparisons, ${(performance.now() - t0).toFixed(0)} ms`,
  );
}, 120_000);
