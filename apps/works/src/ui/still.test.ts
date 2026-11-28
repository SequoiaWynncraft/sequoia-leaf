/**
 * Tier 6 on the page: the still's card (what it distils a minute, its mix of 6 and what each way out
 * sends), the powerhouse's (what it burns and the smog each fuel makes), and the cards of what is
 * distilled, which say what it is distilled from and by which way out it leaves.
 */
import { expect, test } from "bun:test";

import {
  at,
  BREAKER,
  build,
  buyPlot,
  create,
  item,
  type ItemName,
  kind,
  plot,
  plotPrice,
  plotState,
  PYLON,
  setLevel,
  smogPace,
  type Yard,
} from "@sequoia-leaf/factory";
import type { Row } from "@sequoia-leaf/kit/card.ts";

import { opened, useFakeLeaf } from "../../test/fake-leaf.ts";
import { breaker } from "../kinds/breaker.ts";
import { powerhouse } from "../kinds/powerhouse.ts";
import { still } from "../kinds/still.ts";
import { S } from "../state.ts";
import { setTool } from "../tools.ts";
import { ownPace } from "./flow.ts";
import { madeRows } from "./made.ts";
import { printOf } from "./prints.ts";
import { itemRef, machineRef, tileRef } from "./refs.ts";

useFakeLeaf();

const STILL = kind("still");
const CRACKER = kind("cracker");
const POWERHOUSE = kind("powerhouse");
const WORKINGS = plot("workings");

/** A yard with all of tier 6 known that owns today's nine plots and The Old Workings, with a mouse. */
function workings(): Yard {
  const y = create({ seed: 5, tier: 7 });
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

/** Pylons down to The Old Workings from the depot. */
function pylons(y: Yard): void {
  for (const z of [46, 50, 54, 58, 62, 66]) build(y, PYLON, 58, z, 0, Infinity);
  for (const x of [54, 50]) build(y, PYLON, x, 68, 0, Infinity);
}

/** A row as its things and their notes, and the tag of each that has one. */
const noted = (row: Row | undefined): string[] =>
  (row?.things ?? []).map(
    (t) => `${t.ref} ${typeof t.note === "string" ? t.note : ""}${t.tag === undefined ? "" : ` (${t.tag})`}`,
  );
const things = (names: readonly ItemName[]): string[] => names.map((n) => itemRef(item(n)));
/** A thing's card's rows of where it comes from, as labels and notes. */
function rowsOf(name: ItemName): (string | string[])[][] {
  const print = printOf(itemRef(item(name)));
  return (print?.card === "item" ? madeRows(print) : []).map((r) => [r.label, noted(r)]);
}

test("the still's card says what it distils a minute at each grade, its mix of 6, and what each way out sends a minute", async () => {
  await opened(workings(), 1_000);
  expect([1, 2, 3].map((g) => still.pace?.(STILL, g)?.value)).toEqual(["120 /min", "180 /min", "240 /min"]);
  const print = printOf(machineRef(STILL));
  const rows = print?.card === "machine" ? (still.rows?.(print) ?? []) : [];
  expect(rows.map((r) => [r.label, r.look ?? "list", noted(r)])).toEqual([
    [
      "Gives, in this order",
      "icons",
      things(["pitch", "creosote", "pitch", "spirit", "pitch", "creosote"]).map((t) => `${t} `),
    ],
    ["Left way out", "list", [`${itemRef(item("pitch"))} 60 /min`]],
    ["Middle way out", "list", [`${itemRef(item("creosote"))} 40 /min`]],
    ["Right way out", "list", [`${itemRef(item("spirit"))} 20 /min`]],
  ]);
});

test("a standing still's and breaker's headline is the rate its rows are of: on a plot at half pace, a still III distils 120 a minute, not 240", async () => {
  const y = workings();
  pylons(y);
  const corner = y.land.plots.find((p) => p.plot === WORKINGS);
  const [x, z] = [(corner?.x ?? 0) + 4, (corner?.y ?? 0) + 10];
  const [bx, bz] = [(corner?.x ?? 0) + 8, (corner?.y ?? 0) + 2];
  expect([build(y, STILL, x, z, 0, Infinity).ok, build(y, BREAKER, bx, bz, 0, Infinity).ok]).toEqual([true, true]);
  y.grade[at(y, x, z)] = 3;
  y.grade[at(y, bx, bz)] = 3;
  // The Old Workings' smog at step 2: its machines work 1 tick in 2.
  setLevel(y, WORKINGS, 2500);
  await opened(y, 1_000);
  expect(smogPace(S.world, at(S.world, x, z))).toBe(0.5);
  const standing = printOf(tileRef(at(S.world, x, z)));
  if (standing?.card !== "standing") throw new Error("no standing card");
  const rows = still.standing?.rows?.(standing) ?? [];
  const headline = ownPace([still.pace?.(STILL, 3) ?? "none"], null, still.standing?.pace?.(standing) ?? null);
  expect([standing.rate, headline, rows.slice(1).map(noted)]).toEqual([
    120,
    [{ label: "Distils", value: "120 /min" }],
    [
      [`${itemRef(item("pitch"))} 60 /min`],
      [`${itemRef(item("creosote"))} 40 /min`],
      [`${itemRef(item("spirit"))} 20 /min`],
    ],
  ]);
  expect(rows[0]?.things.findIndex((t) => t.lit)).toBe(0);
  // The breaker the same: 200 a minute flat out at grade III, 100 at half pace, headline and rows alike.
  const broken = printOf(tileRef(at(S.world, bx, bz)));
  if (broken?.card !== "standing") throw new Error("no standing card");
  const [, each] = breaker.standing?.rows?.(broken) ?? [];
  expect([
    ownPace([breaker.pace?.(BREAKER, 3) ?? "none"], null, breaker.standing?.pace?.(broken) ?? null),
    noted(each)[0],
  ]).toEqual([[{ label: "Breaks", value: "100 /min" }], `${itemRef(item("copper"))} 40 /min`]);
});

test("the powerhouse's card says what it burns a minute of each fuel, heaviest first, and the smog each makes", async () => {
  await opened(workings(), 1_000);
  const print = printOf(machineRef(POWERHOUSE));
  const rows = print?.card === "machine" ? (powerhouse.rows?.(print) ?? []) : [];
  const fuels = things(["pitch", "creosote", "spirit"]);
  expect(rows.map((r) => [r.label, noted(r)])).toEqual([
    ["Burns, heaviest first", fuels.map((t, n) => `${t} ${["60", "40", "30"][n]} /min`)],
    ["Smog made", fuels.map((t, n) => `${t} ${["240", "80", "30"][n]} /min`)],
  ]);
});

test("what a still gives says it is distilled from tar and by which way out; creosote, made from pitch too, says so after", async () => {
  await opened(workings(), 1_000);
  const tar = [`${itemRef(item("tar"))} `];
  expect(rowsOf("pitch")).toEqual([
    ["Distilled from", tar],
    ["In", [`${machineRef(STILL)} 60 /min (left way out)`]],
  ]);
  expect(rowsOf("creosote")).toEqual([
    ["Distilled from", tar],
    ["In", [`${machineRef(STILL)} 40 /min (middle way out)`]],
    ["Made from", [`${itemRef(item("pitch"))} `]],
    ["In", [`${machineRef(CRACKER)} 60 /min`]],
  ]);
  // A thing the breaker gives as well as a machine makes: the recipe first, then the mix.
  const ingot = rowsOf("ingot");
  expect(ingot.map(([label]) => label)).toEqual(["Made from", "In", "Broken from", "In"]);
  expect(ingot[3]).toEqual(["In", [`${machineRef(kind("breaker"))} 25 /min`]]);
});
