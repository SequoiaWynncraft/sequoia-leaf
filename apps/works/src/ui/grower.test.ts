/**
 * Tier 7 on the page: the grower's card (what it gives out, takes and nets a minute, as the rules'
 * `rateOf` gives its runs, headline and rows alike), what it took in and gave out in the last minute
 * as the page counted it, its map's lit middle and its picture's points read from the rules' one
 * reading of it, a run of belt tapped from any of its tiles beginning at its way out, and star
 * crystal's card, which names the grower before it is known, and the gatherer at star crystal's own pace.
 */
import { expect, test } from "bun:test";

import {
  at,
  build,
  create,
  growthAt,
  holderOf,
  item,
  kind,
  locked,
  portTo,
  put,
  type Yard,
} from "@sequoia-leaf/factory";
import type { Row } from "@sequoia-leaf/kit/card.ts";
import { perMinute } from "@sequoia-leaf/kit/say.ts";

import { ctx, opened, useFakeLeaf } from "../../test/fake-leaf.ts";
import { countedAt } from "../grown.ts";
import { grower } from "../kinds/grower.ts";
import { S } from "../state.ts";
import { setTool } from "../tools.ts";
import { runOut } from "../ways.ts";
import { runYard } from "../yard.ts";
import { ownPace } from "./flow.ts";
import { madeRows } from "./made.ts";
import { printOf } from "./prints.ts";
import { itemRef, machineRef, tileRef } from "./refs.ts";

useFakeLeaf();

const GROWER = kind("grower");
const CRYSTAL = item("crystal");
const FEED = item("feed");

/** A row as its things and their notes. */
const noted = (row: Row | undefined): string[] =>
  (row?.things ?? []).map((t) => `${t.ref} ${typeof t.note === "string" ? t.note : ""}`);
/** The rows of a card, as labels and notes. */
const rowsOf = (rows: readonly Row[]): (string | string[])[][] => rows.map((r) => [r.label, noted(r)]);

/** A yard with all of tier 7 known on the guild's land, owning its yard plot, a mouse in hand. */
function yard(tier = 8): Yard {
  const y = create({ seed: 5, tier });
  // Its moment on Leaf's clock is the stand-in Leaf's now, as Leaf makes a yard.
  y.at = ctx().now;
  y.history = [];
  S.finger = false;
  setTool(null);
  return y;
}
/** The yard plot's corner: its tiles are 16 across and 12 down, the depot in their middle. */
function corner(y: Yard): readonly [number, number] {
  const p = y.land.plots.find((q) => q.plot === y.plots[0]);
  return [p?.x ?? 0, p?.y ?? 0];
}
/** Builds a grower facing east with its own tile `dx`, `dz` from the yard plot's corner, at a grade: its tile. */
function growerAt(y: Yard, dx: number, dz: number, grade = 1): number {
  const [x0, z0] = corner(y);
  expect(build(y, GROWER, x0 + dx, z0 + dz, 0, Infinity).ok).toBe(true);
  const i = at(y, x0 + dx, z0 + dz);
  y.grade[i] = grade;
  return i;
}
/** Puts things into the grower on a tile, as a line would have. */
function fill(y: Yard, i: number, n: number, count: number): void {
  for (let k = 0; k < count; k++) put(y.holders, holderOf(y, i), n);
}

test("the grower's card says what it gives out, takes and nets a minute at each grade: 15, 10 of each and 5 at grade I", async () => {
  await opened(yard(), 1_000);
  expect([1, 2, 3].map((g) => grower.pace?.(GROWER, g)?.value)).toEqual(["5 /min", "7.5 /min", "10 /min"]);
  const print = printOf(machineRef(GROWER));
  const rows = print?.card === "machine" ? (grower.rows?.(print) ?? []) : [];
  expect(rowsOf(rows)).toEqual([
    ["Gives out", [`${itemRef(CRYSTAL)} 15 /min`]],
    ["Takes", [`${itemRef(CRYSTAL)} 10 /min`, `${itemRef(FEED)} 10 /min`]],
    ["Net", [`${itemRef(CRYSTAL)} 5 /min`]],
  ]);
});

test("a standing grower's headline and rows are its runs as the rules give them: short of power, a grower III below its pace", async () => {
  const y = yard();
  const i = growerAt(y, 3, 3, 3);
  // Two more growers III by the depot, drawing more than it gives: the yard works at its share of what they draw.
  growerAt(y, 3, 9, 3);
  growerAt(y, 13, 3, 3);
  await opened(y, 1_000);
  const standing = printOf(tileRef(i));
  if (standing?.card !== "standing") throw new Error("no standing card");
  const runs = standing.rate ?? 0;
  expect(runs > 0 && runs < 20).toBe(true);
  const headline = ownPace([grower.pace?.(GROWER, 3) ?? "none"], null, grower.standing?.pace?.(standing) ?? null);
  const rows = grower.standing?.rows?.(standing) ?? [];
  const per = (n: number): string => perMinute(n);
  expect([headline, rowsOf(rows)]).toEqual([
    [{ label: "Grows, net", value: per(runs * 0.5) }],
    [
      ["Gives out", [`${itemRef(CRYSTAL)} ${per(runs * 1.5)}`]],
      ["Takes", [`${itemRef(CRYSTAL)} ${per(runs)}`, `${itemRef(FEED)} ${per(runs)}`]],
      ["Net", [`${itemRef(CRYSTAL)} ${per(runs * 0.5)}`]],
    ],
  ]);
  expect(i).toBeGreaterThan(0);
});

test("standing, its card says what it took in and gave out of star crystals in the last minute, as the page counted it", async () => {
  const y = yard();
  const i = growerAt(y, 3, 3);
  // Its way out into a shut crate, and 4 star crystals and 4 feed in it.
  const [x0, z0] = corner(y);
  build(y, kind("crate"), x0 + 5, z0 + 3, 0, Infinity);
  y.holders.open[holderOf(y, at(y, x0 + 5, z0 + 3))] = 0;
  fill(y, i, CRYSTAL, 4);
  fill(y, i, FEED, 4);
  await opened(y, 1_000);
  // The tests hold the page's clock at 1,000 ms (`useFakeLeaf`).
  const t0 = 1000;
  // The copy run on a second at a time, the grower fed 1 star crystal and 1 feed each 6 seconds as a line would.
  for (let s = 1; s <= 70; s++) {
    if (s % 6 === 0) {
      fill(S.world, i, CRYSTAL, 1);
      fill(S.world, i, FEED, 1);
    }
    runYard(t0 + s * 1000);
  }
  const counted = countedAt(S.world, i);
  const standing = printOf(tileRef(i));
  if (standing?.card !== "standing" || !counted) throw new Error("not counted");
  // In the last minute: 10 runs (each 6 seconds), 10 star crystals taken in, 15 given out, give or take a run at each end.
  expect([counted.seconds, counted.took >= 9 && counted.took <= 11, counted.gave >= 13 && counted.gave <= 17]).toEqual([
    60,
    true,
    true,
  ]);
  expect(grower.standing?.blocks?.(standing).map((b) => b.body)).toEqual([
    `In the last minute it took in ${counted.took} star crystals and gave out ${counted.gave}.`,
  ]);
});

test("its map's middle and its picture's points read what it holds, as its status does: an empty dome where it holds none", () => {
  const y = yard();
  const i = growerAt(y, 3, 3);
  const lit = (): boolean => grower.mapMid?.lit(y, i) ?? false;
  expect([lit(), growthAt(y, i).crystals]).toEqual([false, 0]);
  fill(y, i, CRYSTAL, 3);
  expect([lit(), growthAt(y, i).crystals]).toEqual([true, 3]);
});

test("a run of belt tapped from any of its tiles begins at its one way out, the middle of its front", () => {
  const y = yard();
  const i = growerAt(y, 3, 3);
  const [x0, z0] = corner(y);
  const out = portTo(y, i, 0);
  expect(out).toBe(at(y, x0 + 5, z0 + 3));
  for (let x = x0 + 2; x <= x0 + 4; x++)
    for (let z = z0 + 2; z <= z0 + 4; z++) expect([x, z, runOut(y, at(y, x, z))]).toEqual([x, z, out]);
});

test("star crystal's card names the grower before it is known, from crystal feed, and the gatherer at star crystal's own pace", async () => {
  await opened(create({ seed: 5, tier: 7 }), 1_000);
  expect(locked(S.world.open, { build: GROWER })).toBe("The grower is not unlocked yet");
  const print = printOf(itemRef(CRYSTAL));
  const rows = print?.card === "item" ? madeRows(print) : [];
  expect(rowsOf(rows).slice(0, 3)).toEqual([
    ["Grown from", [`${itemRef(CRYSTAL)} `, `${itemRef(FEED)} `]],
    ["In", [`${machineRef(GROWER)} 5 /min`]],
    ["Gathered by", [`${machineRef(kind("gatherer"))} 0.4 /min`]],
  ]);
  // It lies in ten plots of the third ring, 47 tiles in all.
  const lies = rows[3]?.things ?? [];
  const tiles = lies.reduce((n, t) => n + Number.parseInt(String(t.note), 10), 0);
  expect([rows[3]?.label, lies.length, tiles]).toEqual(["Lies in", 10, 47]);
});
