/**
 * What the page counts of a launch pad (`pads.ts`), a tick at a time as the page's loop counts it:
 * cells of every bars that come in across beats, those with 1 bar that go flat on the tick they came
 * in included; and after a launch that leaves charged cells behind (its rocket's cells used, the fewest
 * bars first), only what came in after it.
 */
import { expect, test } from "bun:test";

import * as F from "@sequoia-leaf/factory";
import {
  bareYard,
  drop,
  fill,
  holding,
  ONE,
  put,
  pylons,
  rocketPad,
  run,
  THREE,
  TWO,
} from "@sequoia-leaf/factory/test/launch.ts";
import { must } from "@sequoia-leaf/factory/test/yards.ts";

import { beginCounts, commanded, notePads, padCounted } from "./pads.ts";

/** A tick of the yard, counted as the page counts it. */
function tick(y: F.Yard): void {
  F.step(y);
  notePads(y);
}

test("cells of every bars that come in across two beats are all counted, those with 1 bar that go flat on a beat's tick too", () => {
  const y = bareYard(32, 30, [27, 25]);
  const pad = put(y, "launchpad", [14, 14], 0);
  beginCounts(y);
  // With no power it never launches: one cell of each bars comes in on every tick, the beats' ticks too.
  for (let k = 0; k < 400; k++) {
    for (const n of [ONE, TWO, THREE]) fill(y, pad, n, 1);
    tick(y);
  }
  const counted = padCounted(y, pad);
  expect([y.tick, holding(y, pad, [F.CHARGED.plain])[0], counted?.came, counted?.sinceLaunch]).toEqual([
    400,
    600,
    1200,
    false,
  ]);
});

test("after a launch that leaves charged cells behind, only what came in after it is counted", () => {
  const y = bareYard(32, 30, [27, 25]);
  const pad = rocketPad(y);
  for (const n of [ONE, TWO, THREE]) fill(y, pad, n, 50);
  // A belt into its back, fed a charged cell with 3 bars whenever its first tile is free.
  run(y, [4, 14], 0, 8);
  const start = F.at(y, 4, 14);
  pylons(y);
  beginCounts(y);
  must(y, { do: "recipe", x: 14, y: 14, item: "testrocket", was: "rocket" });
  commanded(y);
  let fed = 0;
  for (let k = 0; k < 300; k++) {
    if (y.item[start] === F.NONE) fed++;
    drop(y, start);
    tick(y);
  }
  // Its first tick launched a test rocket with the 50 cells with 1 bar and the 50 with 2, and the 50 with 3 stayed;
  // a second launched from those and what came in.
  const onBelt = Array.from({ length: 8 }, (_, k) => F.at(y, 4 + k, 14)).filter((i) => y.item[i] !== F.NONE).length;
  const counted = padCounted(y, pad);
  expect([y.depot[F.item("testrocket")], counted?.came, counted?.sinceLaunch]).toEqual([2, fed - onBelt, true]);
});
