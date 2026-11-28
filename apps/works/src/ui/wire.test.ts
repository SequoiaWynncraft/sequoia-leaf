/**
 * Tier 5 on the page: the breaker's card (what it breaks a minute at each grade, and its mix of 20 in
 * order, the next picked out on one standing), and smog as a player reads it: on a plot's card, a
 * plot's for sale, and in the Trouble view, which counts it on its button.
 */
import { expect, test } from "bun:test";

import {
  at,
  BREAKER,
  build,
  buyPlot,
  create,
  holderOf,
  MIX_OF,
  plot,
  plotPrice,
  plotState,
  type Yard,
} from "@sequoia-leaf/factory";

import { opened, useFakeLeaf } from "../../test/fake-leaf.ts";
import { breaker } from "../kinds/breaker.ts";
import { S } from "../state.ts";
import { setTool } from "../tools.ts";
import { smoggy } from "../trouble.ts";
import type { PlotPrint } from "./land.ts";
import { printOf } from "./prints.ts";
import { machineRef, plotRef, tileRef } from "./refs.ts";
import { wrongCount } from "./views.ts";

useFakeLeaf();

const WORKINGS = plot("workings");

/** A yard past tier 4's commission (or with `tier` 6, all of tier 5 known) that owns today's nine plots and The Old Workings, with a mouse. */
function workings(tier = 5): Yard {
  const y = create({ seed: 5, tier });
  for (let more = true; more;) {
    const p = y.land.plots.find((q) => q.ring === 1 && plotState(y, q.plot).state === "for sale");
    more = p !== undefined;
    if (p) buyPlot(y, p.plot, plotPrice(y, p.plot), Infinity);
  }
  y.cleared.push(WORKINGS);
  buyPlot(y, WORKINGS, plotPrice(y, WORKINGS), Infinity);
  y.history = [];
  S.finger = false;
  setTool(null);
  return y;
}

/** A plot's card's print as the page has it now. */
function plotPrint(name: Parameters<typeof plot>[0]): PlotPrint {
  const p = printOf(plotRef(plot(name)));
  if (p?.card !== "plot") throw new Error("no plot card");
  return p;
}

test("the breaker's card says what it breaks a minute at each grade, and its mix of 20 in order", async () => {
  await opened(workings(6), 1_000);
  expect([1, 2, 3].map((g) => breaker.pace?.(BREAKER, g)?.value)).toEqual(["100 /min", "150 /min", "200 /min"]);
  const gives = MIX_OF[BREAKER]?.gives ?? [];
  const print = printOf(machineRef(BREAKER));
  const [row] = print?.card === "machine" ? (breaker.rows?.(print) ?? []) : [];
  expect([row?.label, row?.look, row?.things.length, row?.things.some((t) => t.lit)]).toEqual([
    "Gives, in this order",
    "icons",
    20,
    false,
  ]);
  expect(row?.things.map((t) => t.ref)).toEqual(gives.map((k) => `item:${k}`));
});

test("a standing breaker's card picks out the next thing of its mix it gives", async () => {
  const y = workings(6);
  const corner = y.land.plots.find((p) => p.plot === WORKINGS);
  const i = at(y, (corner?.x ?? 0) + 2, (corner?.y ?? 0) + 9);
  if (!build(y, BREAKER, i % y.land.w, Math.floor(i / y.land.w), 0, Infinity).ok) throw new Error("no breaker");
  y.holders.mix[holderOf(y, i)] = 5;
  await opened(y, 1_000);
  const print = printOf(tileRef(i));
  const [row] = print?.card === "standing" ? (breaker.standing?.rows?.(print) ?? []) : [];
  expect([row?.label, row?.things.flatMap((t, n) => (t.lit ? [n] : []))]).toEqual(["Gives next", [5]]);
});

test("a plot the yard owns says its smog on its card: its level, what is made and cleared, and how its machines work", async () => {
  const y = workings();
  const n = y.land.plots.findIndex((p) => p.plot === WORKINGS);
  y.smog.level[n] = 1240;
  await opened(y, 1_000);
  expect(plotPrint("workings").smog).toBe(
    "Smog 1,240 of 3,000. Made 0 /min. Cleared 420 /min: the ground 300, 1 redwood 120. Machines here work 3 ticks in 4.",
  );
  S.world.smog.level[n] = 300;
  expect(plotPrint("workings").smog).toBe(
    "Smog 300 of 3,000. Made 0 /min. Cleared 420 /min: the ground 300, 1 redwood 120. Machines here work at full pace.",
  );
  // A plot not yet the yard's says what it would clear: Long Acre has two redwoods.
  expect(plotPrint("acre").smog).toBe("Clears 540 smog /min: the ground 300, 2 redwoods 240.");
});

test("a plot at step 1 or more is in the Trouble view, by name, and counted on its button", async () => {
  const y = workings();
  const n = y.land.plots.findIndex((p) => p.plot === WORKINGS);
  await opened(y, 1_000);
  const before = wrongCount();
  S.world.smog.level[n] = 2000;
  expect(smoggy(S.world)).toEqual([
    { n, plot: WORKINGS, line: "Smog on The Old Workings: its machines work 2 ticks in 4." },
  ]);
  expect(wrongCount()).toBe(before + 1);
  S.world.smog.level[n] = 3000;
  expect(smoggy(S.world)[0]?.line).toBe("Smog on The Old Workings: its machines work 1 tick in 4.");
});
