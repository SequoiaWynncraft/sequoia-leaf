/**
 * Tier 8 on the page: the charger's card and its pips (the bars of the cell it holds ready, filling as
 * it charges, all out just after a beat); the charged cells' and the rockets' cards, which name the
 * charger and the launch pad before either is known; the pad's card (each part filling, its charged
 * cells by bars, the beat to come, and what the page counted: the most since its last launch and what
 * came in over the last minute), its buttons for a rocket, which name the rocket it showed, and its
 * picture's stage and pips; and a run of belt tapped from any of its tiles beginning at its way out.
 */
import { expect, test } from "bun:test";

import {
  type Act,
  at,
  build,
  CHARGED,
  create,
  holderOf,
  type Item,
  item,
  type Kind,
  kind,
  litAt,
  padAt,
  portTo,
  put,
  setRecipe,
  type Yard,
} from "@sequoia-leaf/factory";
import type { Row } from "@sequoia-leaf/kit/card.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";

import { ctx, opened, useFakeLeaf } from "../../test/fake-leaf.ts";
import { charger, pipsOf } from "../kinds/charger.ts";
import { launchpad, lookOf, rocketButtons } from "../kinds/launchpad.ts";
import { S } from "../state.ts";
import { setTool } from "../tools.ts";
import { runOut } from "../ways.ts";
import { runYard } from "../yard.ts";
import { madeRows } from "./made.ts";
import { printOf } from "./prints.ts";
import { itemRef, machineRef, tileRef } from "./refs.ts";

useFakeLeaf();

const CHARGER = kind("charger");
const PAD = kind("launchpad");
const ONE = item("charged1");
const TWO = item("charged2");
const THREE = item("charged3");
const HULL = item("hull");
const FUEL = item("fuel");

/** A row as its things and their notes or counts. */
const noted = (row: Row | undefined): string[] =>
  (row?.things ?? []).map((t) => `${t.ref} ${typeof t.note === "string" ? t.note : (t.count ?? "")}`);
const rowsOf = (rows: readonly Row[]): (string | string[])[][] => rows.map((r) => [r.label, noted(r)]);

/** A charger holding `out` ready, at rest, as its picture is given it. */
const ready = (out: number): { out: number; working: boolean; work: number } => ({ out, working: false, work: 0 });
/** A thing's card's rows of where it comes from, as labels and notes. */
function madeOf(n: Item): (string | string[])[][] {
  const print = printOf(itemRef(n));
  return rowsOf(print?.card === "item" ? madeRows(print) : []);
}

/** A yard on the guild's land, every goal below `tier` done (9: tier 8 known), a mouse in hand. */
function yard(tier = 9): Yard {
  const y = create({ seed: 5, tier });
  y.at = ctx().now;
  y.history = [];
  S.finger = false;
  setTool(null);
  return y;
}
/** The yard plot's corner. */
function corner(y: Yard): readonly [number, number] {
  const p = y.land.plots.find((q) => q.plot === y.plots[0]);
  return [p?.x ?? 0, p?.y ?? 0];
}
/** Builds a piece facing east with its own tile `dx`, `dz` from the yard plot's corner: its tile. */
function piece(y: Yard, k: Kind, dx: number, dz: number): number {
  const [x0, z0] = corner(y);
  const did = build(y, k, x0 + dx, z0 + dz, 0, Infinity);
  expect(did.ok).toBe(true);
  return at(y, x0 + dx, z0 + dz);
}
function fill(y: Yard, i: number, n: number, count: number): void {
  for (let k = 0; k < count; k++) put(y.holders, holderOf(y, i), n);
}

test("the charger's card says it charges 60, 90 and 120 cells a minute at its grades, and what it charges", async () => {
  await opened(yard(), 1_000);
  expect([1, 2, 3].map((g) => charger.pace?.(CHARGER, g)?.value)).toEqual(["60 /min", "90 /min", "120 /min"]);
  const print = printOf(machineRef(CHARGER));
  const rows = print?.card === "machine" ? (charger.rows?.(print) ?? []) : [];
  expect(rowsOf(rows)).toEqual([
    ["Charges", [`${itemRef(CHARGED.plain)} `, `${itemRef(ONE)} `, `${itemRef(TWO)} `]],
    ["Gives", [`${itemRef(THREE)} `]],
  ]);
});

test("its pips show the bars of the cell it holds ready, fill as it charges, and are all out just after a beat", () => {
  expect([THREE, TWO, ONE, CHARGED.plain].map((n) => pipsOf(150, ready(n)))).toEqual([3, 2, 1, 0]);
  expect([0, 5, 10, 19].map((work) => pipsOf(150, { out: 255, working: true, work }))).toEqual([0, 1, 2, 3]);
  expect([200, 204, 205].map((tick) => pipsOf(tick, ready(THREE)))).toEqual([0, 0, 3]);
});

test("a charged cell's card and a rocket's name the charger and the launch pad before either is known", async () => {
  await opened(yard(8), 1_000);
  expect(madeOf(TWO)).toEqual([
    ["Charged from", [`${itemRef(CHARGED.plain)} `, `${itemRef(ONE)} `, `${itemRef(TWO)} `]],
    ["In", [`${machineRef(CHARGER)} 60 /min`]],
    ["Every 20 seconds it becomes", [`${itemRef(ONE)} `]],
  ]);
  expect(madeOf(ONE).at(-1)).toEqual(["Every 20 seconds it becomes", [`${itemRef(CHARGED.plain)} `]]);
  expect(madeOf(item("rocket"))).toEqual([
    ["Launched with", [`${itemRef(HULL)} ×900`, `${itemRef(FUEL)} ×3,600`, `${itemRef(THREE)} ×1,000`]],
    ["From", [`${machineRef(PAD)} `]],
  ]);
});

test("a standing pad's card shows each part filling, its charged cells by bars, the beat to come, and what came in over the last minute", async () => {
  const y = yard();
  // Its front lets plain cells out into the depot.
  const pad = piece(y, PAD, 4, 6);
  // A charger at grade I against its back, fed cells; its hull sections and fuel in it.
  const c = piece(y, CHARGER, 0, 4);
  expect(portTo(y, c, 0)).toBe(pad - 2 - 2 * y.land.w);
  // A pylon beside them, so power reaches the charger.
  piece(y, kind("pylon"), 1, 2);
  expect([litAt(y, c), litAt(y, pad)]).toEqual([true, true]);
  fill(y, pad, HULL, 60);
  fill(y, pad, FUEL, 200);
  await opened(y, 1_000);
  // A line brings it a cell a second: the charger charges them all.
  for (let s = 1; s <= 70; s++) {
    if ((S.world.holders.count[holderOf(S.world, c)] ?? 0) < 4)
      put(S.world.holders, holderOf(S.world, c), CHARGED.plain);
    if (s === 2) fill(S.world, pad, FUEL, 40);
    runYard(1000 + s * 1000);
  }
  const print = printOf(tileRef(pad));
  if (print?.card !== "standing") throw new Error("no card");
  const reading = padAt(S.world, pad);
  const rows = rowsOf(launchpad.standing?.rows?.(print) ?? []);
  expect(rows.slice(0, 2)).toEqual([
    ["Parts", [`${itemRef(HULL)} 60 of 60`, `${itemRef(FUEL)} 240 of 240`]],
    [
      `Charged cells, ${reading?.charged} of 100`,
      [THREE, TWO, ONE].map((n, b) => `${itemRef(n)} ${reading?.bars[2 - b]}`),
    ],
  ]);
  const said = (launchpad.standing?.blocks?.(print) ?? []).map((b) => b.body);
  const counted = print.launch?.counted;
  expect([said.length, counted?.seconds, (counted?.came ?? 0) > 40 && (counted?.came ?? 0) <= 70]).toEqual([
    3,
    60,
    true,
  ]);
  expect(said[0]).toMatch(/^Every charged cell loses a bar in \d+ seconds?\.$/);
  expect(said[2]).toBe(
    `In the last minute, ${counted?.came} charged cells came in. To hold 100 at once, it needs about 110 /min.`,
  );
  // It never held 100 at once from one charger at grade I: its picture shows its rocket whole and its pips part lit.
  expect([lookOf(reading).stage, lookOf(reading).lit > 0, (counted?.most ?? 0) < 100]).toEqual([4, true, true]);
}, 60_000);

test("its buttons set it to each rocket that comes with it, naming the rocket the card showed, and say what changing tips out", async () => {
  const y = yard();
  const pad = piece(y, PAD, 12, 6);
  fill(y, pad, HULL, 60);
  fill(y, pad, FUEL, 240);
  // A second pad, set to the rocket and full: changing it to the test rocket would tip out most of it.
  const full = piece(y, PAD, 4, 6);
  const [x0, z0] = corner(y);
  expect(setRecipe(y, x0 + 4, z0 + 6, item("rocket"), item("testrocket"))).toBeNull();
  fill(y, full, HULL, 900);
  fill(y, full, FUEL, 3600);
  fill(y, full, THREE, 300);
  await opened(y, 1_000);
  const print = printOf(tileRef(pad));
  if (print?.card !== "standing") throw new Error("no card");
  const sent: Act[] = [];
  const hands = { act: (a: Act): boolean => (sent.push(a), true) };
  const buttons = rocketButtons(print, hands);
  expect(buttons.map((b) => [b.label, b.lit, b.about])).toEqual([
    ["Test rocket", true, "It is set to this rocket."],
    ["Rocket", false, "Nothing it holds is tipped out."],
  ]);
  const other = printOf(tileRef(full));
  if (other?.card !== "standing") throw new Error("no card");
  expect(rocketButtons(other, hands)[0]?.about).toBe(
    "Tips out 840 hull sections, 3,360 rocket fuel and 200 charged cells.",
  );
  // A button to press it with, from a stand-in document, as the page has none here.
  Object.defineProperty(globalThis, "document", { value: { createElement: () => ({}) }, configurable: true });
  buttons[1]?.on(el("button"));
  expect(sent).toEqual([{ do: "recipe", x: print.x, y: print.y, item: item("rocket"), was: item("testrocket") }]);
});

test("a run of belt tapped from any of its tiles begins at its one way out, the middle of its front", () => {
  const y = yard();
  const pad = piece(y, PAD, 12, 6);
  const [x0, z0] = corner(y);
  const out = portTo(y, pad, 0);
  expect(out).toBe(at(y, x0 + 15, z0 + 6));
  for (let x = x0 + 10; x <= x0 + 14; x++)
    for (let z = z0 + 4; z <= z0 + 8; z++) expect([x, z, runOut(y, at(y, x, z))]).toEqual([x, z, out]);
});
