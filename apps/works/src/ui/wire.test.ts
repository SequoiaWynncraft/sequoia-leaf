/**
 * Tier 5 on the page: the breaker's card (what it breaks a minute at each grade, and its mix of 20 in
 * order, the next picked out on one standing), and smog as a player reads it: on a plot's card, a
 * plot's for sale, and in the Trouble view, which counts it on its button.
 */
import { expect, test } from "bun:test";

import {
  at,
  BELT,
  BREAKER,
  build,
  buyPlot,
  create,
  holderOf,
  item,
  MIX_OF,
  outsOf,
  plot,
  plotPrice,
  plotState,
  PYLON,
  rewire,
  setLevel,
  STUDY,
  type Yard,
} from "@sequoia-leaf/factory";
import type { Row } from "@sequoia-leaf/kit/card.ts";

import { opened, useFakeLeaf } from "../../test/fake-leaf.ts";
import { breaker, outOf } from "../kinds/breaker.ts";
import { S } from "../state.ts";
import { setTool } from "../tools.ts";
import { smoggy } from "../trouble.ts";
import type { PlotPrint } from "./land.ts";
import { madeRows } from "./made.ts";
import { numbersOf } from "./numbers.ts";
import { printOf } from "./prints.ts";
import { itemRef, machineRef, plotRef, tileRef } from "./refs.ts";
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
  expect([row?.label, row?.things.flatMap((t, n) => (t.lit ? [n] : []))]).toEqual(["Gives, in this order", [5]]);
});

test("a plot the yard owns says its smog on its card: its level, what is made and cleared, and how its machines work", async () => {
  const y = workings();
  const n = y.land.plots.findIndex((p) => p.plot === WORKINGS);
  setLevel(y, n, 1240);
  await opened(y, 1_000);
  expect(plotPrint("workings").smog).toBe(
    "Smog 1,240 of 3,000. Made 0 /min. Cleared 420 /min: the ground 300, 1 redwood 120. Machines here work at 75% of their pace.",
  );
  setLevel(S.world, n, 300);
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
  setLevel(S.world, n, 2000);
  expect(smoggy(S.world)).toEqual([
    { n, plot: WORKINGS, line: "Smog on The Old Workings: its machines work at 50% of their pace." },
  ]);
  expect(wrongCount()).toBe(before + 1);
  setLevel(S.world, n, 3000);
  expect(smoggy(S.world)[0]?.line).toBe("Smog on The Old Workings: its machines work at 25% of their pace.");
});

test("a Study slowed by smog says smog slows it, not that power is short; with power short too, both", async () => {
  const y = workings(6);
  // Pylons down to The Old Workings from the depot, and a Study on its clear bottom row.
  pylons(y);
  const corner = y.land.plots.find((p) => p.plot === WORKINGS);
  const [x, z] = [(corner?.x ?? 0) + 1, (corner?.y ?? 0) + 10];
  expect(build(y, STUDY, x, z, 0, Infinity).ok).toBe(true);
  const n = y.land.plots.findIndex((p) => p.plot === WORKINGS);
  setLevel(y, n, 2000);
  await opened(y, 1_000);
  const i = at(S.world, x, z);
  expect(numbersOf(S.world, i)).toEqual([expect.stringMatching(/^Studies .+ \/min: smog slows it\.$/)]);
  // The depot's power cut by hand, and the plumbing worked out again: now power is short as well.
  Object.assign(S.world.open, { depot: 1 });
  rewire(S.world);
  expect(numbersOf(S.world, i)).toEqual([expect.stringMatching(/: power is short and smog slows it\.$/)]);
});

test("a breaker's chute is drawn at its way out whichever way it faces, placed or about to be", () => {
  const y = workings(6);
  const corner = y.land.plots.find((p) => p.plot === WORKINGS);
  const outs = ([0, 1, 2, 3] as const).map((d) => {
    const [x, z] = [(corner?.x ?? 0) + 1 + 3 * d, (corner?.y ?? 0) + 10];
    expect(build(y, BREAKER, x, z, d, Infinity).ok).toBe(true);
    const o = outsOf(y, at(y, x, z))[0];
    if (!o) throw new Error("a breaker with no way out");
    // The preview's, from the way alone, is the standing one's.
    expect(outOf(d)).toEqual([o.dx, o.dy, o.way]);
    return outOf(d).slice(0, 2).join(",");
  });
  expect(new Set(outs).size).toBe(4);
});

/** Each thing of a row as its picture's ref and its note: "item:31 40 /min". */
const noted = (row: Row | undefined): string[] =>
  (row?.things ?? []).map((t) => `${t.ref} ${typeof t.note === "string" ? t.note : ""}`);
/** Pylons down to The Old Workings from the depot. */
function pylons(y: Yard): void {
  for (const z of [46, 50, 54, 58, 62, 66]) build(y, PYLON, 58, z, 0, Infinity);
  for (const x of [54, 50]) build(y, PYLON, x, 68, 0, Infinity);
}

test("the breaker's card gives each thing a minute at its grade; a standing one what it gives now, no more than its belt carries", async () => {
  const y = workings(6);
  pylons(y);
  const corner = y.land.plots.find((p) => p.plot === WORKINGS);
  const [x, z] = [(corner?.x ?? 0) + 2, (corner?.y ?? 0) + 9];
  expect(build(y, BREAKER, x, z, 0, Infinity).ok).toBe(true);
  // A grade III breaker onto a grade I belt: 150 a minute of its 200.
  y.grade[at(y, x, z)] = 3;
  expect(build(y, BELT, x + 2, z, 0, Infinity).ok).toBe(true);
  await opened(y, 1_000);
  const things = (["copper", "ingot", "glass", "slag", "gear"] as const).map((n) => itemRef(item(n)));
  const each = (values: readonly string[]): string[] => things.map((t, n) => `${t} ${values[n] ?? ""} /min`);
  const machine = printOf(machineRef(BREAKER));
  const [, flat] = machine?.card === "machine" ? (breaker.rows?.(machine) ?? []) : [];
  expect([flat?.label, noted(flat)]).toEqual(["A minute", each(["40", "25", "15", "15", "5"])]);
  // 8, 5, 3, 3 and 1 of every 20 of the 150 its belt carries, as every rate is said.
  const standing = printOf(tileRef(at(S.world, x, z)));
  const [, now] = standing?.card === "standing" ? (breaker.standing?.rows?.(standing) ?? []) : [];
  expect([standing?.card === "standing" && standing.rate, noted(now)]).toEqual([
    150,
    each(["60", "38", "23", "23", "7.5"]),
  ]);
});

test("copper's and slag's cards say what they are broken from and in what, as a recipe's say what makes them", async () => {
  await opened(workings(6), 1_000);
  for (const [name, each] of [
    ["copper", "40 /min"],
    ["slag", "15 /min"],
  ] as const) {
    const print = printOf(itemRef(item(name)));
    const rows = print?.card === "item" ? madeRows(print) : [];
    expect(rows.map((r) => [r.label, noted(r)])).toEqual([
      ["Broken from", [`${itemRef(item("salvage"))} `]],
      ["In", [`${machineRef(BREAKER)} ${each}`]],
    ]);
  }
});
