/**
 * Tier 8, the launch (SPEC-2 sections 1 to 3, and section 8's PR 5 row): its tables in the spec's
 * line-hours; the beat, everywhere a charged cell can be, and never in a yard that does not know the
 * charger; the charger; the launch pad, which takes charged cells only once it holds the rest and no
 * plain cell ever, launches at a moment it holds its rocket's cells, and counts a launch as its rocket
 * reaching the depot; a rocket chosen on its card; and its words.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import {
  type At,
  bareYard,
  CELL,
  chargedIn,
  CHARGER,
  crate,
  drop,
  fill,
  FUEL,
  holding,
  HULL,
  ONE,
  PAD,
  put,
  pylons,
  run,
  THREE,
  TWO,
  until,
} from "./launch.ts";
import { tunnel } from "./tier5.ts";
import { give, must } from "./yards.ts";

/** SPEC-2's line-hours of tier 8's goals. */
const HOURS: readonly (readonly [string, number])[] = [
  ["warmhats", 0.83],
  ["testfiring", 0.13],
  ["launch", 1.8],
  ["moonlumps", 8.9],
  ["towncells", 139],
  ["threelights", 71],
  ["skyroad", 114],
  ["cells", 11],
  ["charging", 17],
  ["hulls", 11],
  ["rocketfuel", 11],
  ["launchpad", 56],
  ["charger2", 22],
  ["charger3", 56],
];

/** A goal's grade III line-hours: each thing it wants, as the planner counts it (`lineHours`: a rocket as its parts). */
const lineHours = (g: F.Goal): number =>
  F.ALL_ITEMS.reduce((sum, n) => sum + F.lineHours(n, F.GOALS[g]?.want[n] ?? 0), 0);

const bars: readonly F.Item[] = [ONE, TWO, THREE];

/** Every charged cell in a yard, by its bars (1, 2, 3), and the plain cells: on what carries, under the ground and in every holder. */
function everyCell(y: F.Yard): number[] {
  const count = [0, 0, 0, 0];
  const tally = (n: number, c = 1): void => {
    const at = n === CELL ? 0 : bars.findIndex((b) => b === n) + 1;
    if (at > 0 || n === CELL) count[at] = (count[at] ?? 0) + c;
  };
  for (const n of y.item) tally(n);
  for (let k = 0; k < y.tunnels.size * F.SPAN_MOST; k++) tally(y.tunnels.under[k] ?? F.NONE);
  for (let r = 0; r < y.holders.size; r++) {
    tally(y.holders.out[r] ?? F.NONE);
    for (const n of [CELL, ...bars]) tally(n, F.held(y.holders, r, n));
  }
  return count;
}

describe("tier 8's tables", () => {
  test("every node and piece of research is in the spec's line-hours, by the planner, within 5%", () => {
    const tier8 = F.ALL_GOALS.filter((g) => F.GOALS[g]?.tier === 8).map((g) => F.GOALS[g]?.id ?? "");
    expect(tier8.toSorted()).toEqual(HOURS.map(([id]) => id).toSorted());
    for (const [id, hours] of HOURS) {
      const got = lineHours(F.goal(id));
      expect([id, Math.abs(got / hours - 1) <= 0.05 ? hours : got]).toEqual([id, hours]);
    }
    expect(F.TIERS[8]?.name).toBe("The launch");
    // A rocket is 1.78 line-hours, a heavy rocket 4.03 and a test rocket 0.13 (SPEC-2 0.6).
    const each = (["rocket", "heavyrocket", "testrocket"] as const).map((n) => +F.lineHours(F.item(n), 1).toFixed(2));
    expect(each).toEqual([1.78, 4.03, 0.13]);
  });

  test("the charger and the launch pad are the last two kinds; a charged cell is planned from a cell by a charger, a rocket from its parts by a launch pad", () => {
    expect(F.KINDS.slice(-2)).toEqual(["charger", "launchpad"]);
    expect([F.sizeOf(CHARGER, 0), F.sizeOf(PAD, 0)]).toEqual([
      [2, 2],
      [5, 5],
    ]);
    for (const n of [CELL, ...bars].slice(1)) {
      const { kind, recipe } = F.makerOf(n);
      expect([F.kindName(kind), recipe?.from.map(F.itemName), F.kindsMaking(n).map(F.kindName)]).toEqual([
        "charger",
        ["cell"],
        ["charger"],
      ]);
    }
    expect([1, 2, 3].map((g) => F.makes(CHARGER, g, null))).toEqual([60, 90, 120]);
    const rocket = F.makerOf(F.item("rocket"));
    expect([F.kindName(rocket.kind), rocket.recipe?.from.map(F.itemName), rocket.recipe?.need]).toEqual([
      "launchpad",
      ["hull", "fuel", "charged3"],
      [900, 3600, 1000],
    ]);
    expect(F.kindsMaking(F.item("testrocket")).map(F.kindName)).toEqual(["launchpad"]);
    // Before either is researched, a thing's maker is named and locked.
    const y = F.create({ seed: 1, tier: 8 });
    expect(F.locked(y.open, { make: THREE })).toBe("The charger is not unlocked yet");
    expect(F.locked(y.open, { make: F.item("rocket") })).toBe("The launch pad is not unlocked yet");
  });

  test("the board never asks for a rocket or a charged cell, even with every tier 8 node done and every thing makeable", () => {
    const raws = F.ALL_ITEMS.filter(F.isRaw).map((n, k): [number, number, F.ItemName] => [1 + k, 1, F.itemName(n)]);
    const y = F.create({ land: bareLand(20, 12, raws, [16, 6]), seed: 4, tier: 9 });
    const asked = new Set<string>(F.askable(y).map(F.itemName));
    expect(["cell", "hull", "fuel"].every((n) => asked.has(n))).toBe(true);
    expect(
      ["rocket", "testrocket", "heavyrocket", "charged1", "charged2", "charged3"].filter((n) => asked.has(n)),
    ).toEqual([]);
  });
});

/**
 * A yard with charged cells with 3 bars everywhere one can be: at the end of a belt, under a tunnel
 * (behind one at its far mouth), in a shut crate, held ready by a charger with nothing ahead, and in a
 * launch pad. With tier 8 known (`tier` 9) or not (8, where no charger or pad can stand).
 */
function cellsEverywhere(tier: number): { y: F.Yard; charger: number; pad: number; box: number } {
  const y = bareYard(32, 22, [27, 11], tier);
  const belt = put(y, "belt", [2, 2], 0);
  y.item[belt] = THREE;
  y.prog[belt] = 8;
  must(y, tunnel(2, 18, 4));
  const far = F.at(y, 7, 18);
  y.item[far] = THREE;
  y.prog[far] = 8;
  y.tunnels.under[F.tunnelOf(y, F.at(y, 2, 18)) * F.SPAN_MOST + 3] = THREE;
  const box = crate(y, [2, 8], 0, THREE, 5, true);
  let charger = -1;
  let pad = -1;
  if (tier > 8) {
    charger = put(y, "charger", [5, 12], 0);
    y.holders.out[F.holderOf(y, charger)] = THREE;
    pad = put(y, "launchpad", [14, 10], 0);
    fill(y, pad, THREE, 7);
  }
  pylons(y);
  F.changed(y);
  return { y, charger, pad, box };
}

describe("the beat", () => {
  test("a charged cell with 3 bars on a belt, under a tunnel, in a crate, in a charger's way out and in a pad has 2 after the next tick that divides by 200, then 1, then is a cell", () => {
    const { y, charger, pad, box } = cellsEverywhere(9);
    until(y, 199);
    expect(everyCell(y)).toEqual([0, 0, 0, 16]);
    expect(y.tunnels.under.includes(THREE)).toBe(true);
    F.step(y);
    expect([y.tick, everyCell(y)]).toEqual([200, [0, 0, 16, 0]]);
    expect([y.holders.out[F.holderOf(y, charger)], holding(y, pad, bars), holding(y, box, bars)]).toEqual([
      TWO,
      [0, 7, 0],
      [0, 5, 0],
    ]);
    until(y, 399);
    expect(everyCell(y)).toEqual([0, 0, 16, 0]);
    until(y, 400);
    expect(everyCell(y)).toEqual([0, 16, 0, 0]);
    until(y, 600);
    expect(everyCell(y)).toEqual([16, 0, 0, 0]);
    // Each holder's count of different things it holds is kept right: one thing, a cell.
    expect([y.holders.kinds[F.holderOf(y, box)], y.holders.count[F.holderOf(y, box)]]).toEqual([1, 5]);
    // A crate of plain cells and cells with 1 bar holds two things before a beat and one after it.
    const both = crate(y, [2, 4], 0, CELL, 2, true);
    fill(y, both, ONE, 3);
    const r = F.holderOf(y, both);
    expect([y.holders.kinds[r], y.holders.count[r]]).toEqual([2, 5]);
    until(y, 800);
    expect([y.holders.kinds[r], y.holders.count[r], holding(y, both, [CELL, ONE])]).toEqual([1, 5, [5, 0]]);
    expect(y.holders.out[F.holderOf(y, charger)]).toBe(CELL);
  });

  test("a yard that does not know the charger is never passed over: its charged cells keep their bars", () => {
    const { y } = cellsEverywhere(8);
    expect(y.open.done[F.goal("charging")]).toBe(0);
    until(y, 1000);
    expect(everyCell(y)).toEqual([0, 0, 0, 8]);
    expect(F.beats(y)).toBe(false);
  });

  test("the seconds to the next beat come from the tick alone", () => {
    expect([0, 1, 193, 199, 200, 401].map(F.toBeat)).toEqual([200, 199, 7, 1, 200, 199]);
    expect([F.secondsTo(200), F.secondsTo(61), F.secondsTo(7)]).toEqual(["20 seconds", "7 seconds", "1 second"]);
  });
});

/** A charger facing east on (4, 4) into a shut crate on (6, 4): its tile and the crate's. */
function chargerIntoBin(y: F.Yard, grade = 1): { c: number; out: number } {
  const c = put(y, "charger", [4, 4], 0, grade);
  const out = crate(y, [6, 4], 0, CELL, 0, true);
  pylons(y);
  return { c, out };
}

describe("the charger", () => {
  test("charges a cell to 3 bars: a cell first, then one with 1 bar, then one with 2; it holds 4 in all, and charges nothing more while its cell cannot leave", () => {
    const y = bareYard(20, 12, [16, 6]);
    const c = put(y, "charger", [4, 4], 0);
    pylons(y);
    const r = F.holderOf(y, c);
    fill(y, c, TWO, 1);
    fill(y, c, ONE, 1);
    fill(y, c, CELL, 1);
    expect([F.wants(y, c, CELL), F.wants(y, c, THREE), y.holders.count[r]]).toEqual([true, false, 3]);
    until(y, 10);
    // Its first charge, at grade I, is 10 ticks: the cell went.
    expect([y.holders.out[r], holding(y, c, [CELL, ONE, TWO])]).toEqual([THREE, [0, 1, 1]]);
    // A crate of cells behind it fills it to 4 in all, and no more: 2 go in, and the crate holds 1 more ready to.
    const behind = crate(y, [3, 4], 0, CELL, 10);
    until(y, 100);
    // Nothing is ahead of it: it holds its charged cell and charges nothing more.
    expect([y.holders.out[r], holding(y, c, [CELL, ONE, TWO]), holding(y, behind, [CELL])]).toEqual([
      THREE,
      [2, 1, 1],
      [7],
    ]);
    expect(F.status(y, F.at(y, 4, 4))?.line).toBe(
      "Nowhere to send its charged cells with 3 bars: nothing is on the tile it points at.",
    );
    // A full belt ahead of its way out: it waits.
    const belt = put(y, "belt", [6, 4], 0);
    y.item[belt] = CELL;
    y.prog[belt] = 8;
    expect(F.status(y, F.at(y, 4, 4))).toMatchObject({
      state: "waiting",
      trouble: false,
      line: "Waiting: no room ahead for its charged cells.",
    });
  });

  test("gives 60, 90 and 120 charged cells a minute at its three grades, into what stands ahead", () => {
    const made = [1, 2, 3].map((grade) => {
      const y = bareYard(20, 12, [16, 6]);
      const { c, out } = chargerIntoBin(y, grade);
      const r = F.holderOf(y, c);
      for (let t = 0; t < 1200; t++) {
        while ((y.holders.count[r] ?? 0) < 4) F.put(y.holders, r, CELL);
        F.step(y);
        if (t === 599) for (const n of [CELL, ...bars]) F.take(y.holders, F.holderOf(y, out), n, 1e6);
      }
      return F.held(y.holders, F.holderOf(y, out), CELL) + chargedIn(y, out);
    });
    expect(made).toEqual([60, 90, 120]);
  });

  test("its words: charging, waiting for cells, and with no power", () => {
    const y = bareYard(20, 12, [16, 6]);
    const { c } = chargerIntoBin(y);
    expect(F.status(y, F.at(y, 4, 4))?.line).toBe("Waiting for cells.");
    fill(y, c, CELL, 2);
    F.step(y);
    expect(F.status(y, F.at(y, 4, 4))?.line).toBe("Charging cells.");
    const dark = bareYard(40, 12, [36, 6]);
    put(dark, "charger", [4, 4], 0);
    expect(F.status(dark, F.at(dark, 4, 4))?.line).toBe("No power here. Place a pylon near it.");
  });
});

const TESTROCKET = F.item("testrocket");
const ROCKET = F.item("rocket");

/** A pad facing east on its own tile `at` (covering two tiles round it), in a bare yard with tier 8 known: its tile. */
function padAt(y: F.Yard, at: At): number {
  return put(y, "launchpad", at, 0);
}
/** Sets the pad on a tile to a rocket, by what it counts as, as its card does: naming the rocket it was set to. */
function setRocket(y: F.Yard, pad: number, item: F.ItemName): ReturnType<typeof give> {
  const was = F.ITEMS[y.set[pad] ?? F.NONE];
  return give(y, { do: "recipe", x: pad % y.land.w, y: Math.floor(pad / y.land.w), item, was });
}

/**
 * A pad set to the rocket and holding its hull sections and fuel, its front into a cart stop, with
 * `doors` belts of grade III each 25 tiles long (5 seconds) into its north and south sides, each fed
 * a charged cell with 3 bars as fast as it carries: 300 a minute a door.
 */
function doors(n: number): { y: F.Yard; pad: number; starts: number[] } {
  const y = bareYard(64, 72, [56, 66]);
  const pad = padAt(y, [30, 35]);
  expect("refused" in setRocket(y, pad, "rocket")).toBe(false);
  fill(y, pad, HULL, 900);
  fill(y, pad, FUEL, 3600);
  put(y, "stop", [33, 35], 0);
  const starts: number[] = [];
  for (const [x, from, dir] of [
    [28, 8, 1],
    [32, 8, 1],
    [28, 62, 3],
    [32, 62, 3],
  ] as const) {
    if (starts.length === n) break;
    run(y, [x, from], dir, 25);
    starts.push(F.at(y, x, from));
  }
  pylons(y);
  return { y, pad, starts };
}

describe("the launch pad", () => {
  test("takes no charged cell until it holds its hull sections and fuel, and no plain cell ever", () => {
    const y = bareYard(32, 30, [27, 25]);
    const pad = padAt(y, [14, 14]);
    // A door of charged cells from the north, one of plain cells from the south.
    run(y, [14, 6], 1, 6);
    run(y, [14, 22], 3, 6);
    pylons(y);
    const north = F.at(y, 14, 6);
    const south = F.at(y, 14, 22);
    expect([y.set[pad], F.wants(y, pad, CELL), F.wants(y, pad, THREE), F.wants(y, pad, HULL)]).toEqual([
      TESTROCKET,
      false,
      true,
      true,
    ]);
    const plainOnSouth = (): boolean => y.item[F.at(y, 14, 17)] === CELL;
    for (let t = 0; t < 120; t++) {
      drop(y, north);
      if (y.item[south] === F.NONE) y.item[south] = CELL;
      F.step(y);
    }
    expect([chargedIn(y, pad), holding(y, pad, [CELL]), plainOnSouth()]).toEqual([0, [0], true]);
    expect(F.status(y, F.at(y, 14, 17))).toMatchObject({
      trouble: true,
      line: "Cells have nowhere to go: the launch pad takes only charged cells.",
    });
    expect(F.status(y, F.at(y, 14, 11))).toMatchObject({ state: "waiting", trouble: false });
    // Its hull sections and fuel, from a crate against its back: once it holds them, it takes charged cells.
    crate(y, [11, 14], 0, HULL, 60);
    fill(y, F.at(y, 11, 14), FUEL, 240);
    let ready = -1;
    for (let t = 0; t < 600 && chargedIn(y, pad) === 0; t++) {
      if (ready < 0 && F.padAt(y, pad)?.ready) ready = y.tick;
      drop(y, north);
      F.step(y);
    }
    expect([ready > 0, chargedIn(y, pad) > 0, holding(y, pad, [HULL, FUEL]), plainOnSouth()]).toEqual([
      true,
      true,
      [60, 240],
      true,
    ]);
  });

  test("with 1,200 charged cells a minute arriving 5 seconds old it launches within 80 seconds of being ready", () => {
    const { y, pad, starts } = doors(4);
    expect(F.padAt(y, pad)?.ready).toBe(true);
    let most = 0;
    while (y.launches.ever[0] === 0 && y.tick < 2000) {
      for (const i of starts) drop(y, i);
      F.step(y);
      most = Math.max(most, chargedIn(y, pad));
    }
    console.log(`1,200 a minute, 5 seconds old: launched at tick ${y.tick}, holding ${most} charged cells at most`);
    expect([y.launches.ever[0], y.depot[ROCKET], y.tick <= 800, most >= 999]).toEqual([1, 1, true, true]);
    // It held its rocket's parts and cells exactly, and they went with the rocket.
    expect([holding(y, pad, [HULL, FUEL]), chargedIn(y, pad)]).toEqual([[0, 0], 0]);
  }, 30_000);

  test("with 600 a minute it never launches, and its charged cells never pass 550", () => {
    const { y, pad, starts } = doors(2);
    let most = 0;
    for (let t = 0; t < 6000; t++) {
      for (const i of starts) drop(y, i);
      F.step(y);
      most = Math.max(most, chargedIn(y, pad));
    }
    console.log(`600 a minute, 5 seconds old: ${most} charged cells at most over 10 minutes`);
    expect([y.launches.ever[0], y.depot[ROCKET] ?? 0, most <= 550, most >= 500]).toEqual([0, 0, true, true]);
    // What lost its last bar in it left by its front, into the cart stop.
    expect([(y.depot[CELL] ?? 0) > 1000, F.padAt(y, pad)?.clogged]).toEqual([true, false]);
  }, 30_000);

  test("a launch counts as 1 of its rocket reaching the depot: a rocket pays 300 Coins and counts as any launch, a test rocket 24 and counts as none", () => {
    for (const [name, coins, ever] of [
      ["testrocket", 24, [0, 0, 0, 0, 0]],
      ["rocket", 300, [1, 0, 0, 0, 0]],
    ] as const) {
      const y = bareYard(32, 30, [27, 25]);
      const pad = padAt(y, [14, 14]);
      pylons(y);
      if (name === "rocket") setRocket(y, pad, name);
      const rocket = F.rocketSet(y.set[pad] ?? F.NONE);
      for (const p of rocket?.parts ?? []) fill(y, pad, p.item, p.need);
      fill(y, pad, THREE, rocket?.cells ?? 0);
      const till = y.till;
      F.step(y);
      expect([name, (y.till - till) / F.MILLI, [...y.launches.ever], y.depot[F.item(name)]]).toEqual<unknown[]>([
        name,
        coins,
        ever,
        1,
      ]);
    }
  });

  test("a rocket is chosen on its card, naming the rocket it showed; changing it takes nothing out, and a launch uses only its rocket's needs", () => {
    const y = bareYard(32, 30, [27, 25]);
    const pad = padAt(y, [14, 14]);
    const at = { x: 14, y: 14 };
    expect(give(y, { do: "recipe", ...at, item: "rocket" })).toMatchObject({ refused: "cannot_set_recipe" });
    expect(give(y, { do: "recipe", ...at, item: "rocket", was: "rocket" })).toMatchObject({
      why: "It has changed since: it is set to the test rocket now.",
    });
    expect(give(y, { do: "recipe", ...at, item: "plank", was: "testrocket" })).toMatchObject({
      why: "A launch pad launches a test rocket or a rocket.",
    });
    // A heavy rocket comes with endless research, after the first launch: not with the pad.
    expect(give(y, { do: "recipe", ...at, item: "heavyrocket", was: "testrocket" })).toMatchObject({
      refused: "cannot_set_recipe",
    });
    must(y, { do: "recipe", ...at, item: "rocket", was: "testrocket" });
    fill(y, pad, HULL, 900);
    fill(y, pad, FUEL, 3600);
    fill(y, pad, THREE, 400);
    fill(y, pad, ONE, 200);
    fill(y, pad, CELL, 30);
    const kept = [HULL, FUEL, CELL, ONE, TWO, THREE];
    must(y, { do: "recipe", ...at, item: "testrocket", was: "rocket" });
    // Set to the test rocket, it holds all it held for the rocket; kept and read back, the same.
    expect([holding(y, pad, kept), y.set[pad]]).toEqual([[900, 3600, 30, 200, 0, 400], TESTROCKET]);
    const back = F.decode(F.encode(y), y.land);
    expect([back?.set[pad], back && F.check(back)]).toEqual([TESTROCKET, F.check(y)]);
    // With power it launches a test rocket from that: 60 hull sections, 240 rocket fuel, and the 100 charged cells with the fewest bars.
    pylons(y);
    F.step(y);
    expect([y.depot[TESTROCKET], holding(y, pad, kept)]).toEqual([1, [840, 3360, 30, 100, 0, 400]]);
    // Set back to the rocket, it keeps the rest; given what it is short of, it launches the rocket with all of it.
    must(y, { do: "recipe", ...at, item: "rocket", was: "testrocket" });
    expect([holding(y, pad, kept), F.padAt(y, pad)?.ready]).toEqual([[840, 3360, 30, 100, 0, 400], false]);
    fill(y, pad, HULL, 60);
    fill(y, pad, FUEL, 240);
    fill(y, pad, TWO, 500);
    F.step(y);
    expect([y.depot[ROCKET], [...y.launches.ever], holding(y, pad, kept)]).toEqual([
      1,
      [1, 0, 0, 0, 0],
      [0, 0, 30, 0, 0, 0],
    ]);
  });

  test("its words: waiting for its parts, ready with its charged cells and those about to go flat, clogged, and with no power", () => {
    const y = bareYard(32, 30, [27, 25]);
    const pad = padAt(y, [14, 14]);
    pylons(y);
    const line = (): string | undefined => F.status(y, pad)?.line;
    expect(line()).toBe("Waiting for 60 hull sections and 240 rocket fuel.");
    fill(y, pad, HULL, 60);
    fill(y, pad, FUEL, 200);
    expect(line()).toBe("Waiting for 40 rocket fuel.");
    fill(y, pad, FUEL, 40);
    expect([F.status(y, pad)?.state, line()]).toEqual(["working", "Ready. Holds 0 of 100 charged cells."]);
    fill(y, pad, THREE, 28);
    fill(y, pad, ONE, 12);
    until(y, 130);
    expect(line()).toBe("Ready. Holds 40 of 100 charged cells. 12 lose their last bar in 7 seconds.");
    fill(y, pad, CELL, 1000);
    expect(F.status(y, pad)).toMatchObject({
      state: "blocked",
      trouble: true,
      line: "Clogged: holds 1,000 cells with no charge. They leave by its front, 300 /min at most.",
    });
    const dark = bareYard(60, 30, [55, 25]);
    const far = padAt(dark, [10, 10]);
    expect(F.status(dark, far)?.line).toBe("No power here. Place a pylon near it.");
  });

  test("a test rocket, 100 charged cells at once: 2 chargers at grade I against its back do it, and 1 does not", () => {
    const fired = [1, 2].map((chargers) => {
      const y = bareYard(32, 30, [27, 25]);
      const pad = padAt(y, [14, 14]);
      for (const z of [12, 14].slice(0, chargers)) {
        put(y, "charger", [10, z], 0);
        crate(y, [9, z], 0, CELL, 2000);
      }
      crate(y, [11, 16], 0, HULL, 60);
      fill(y, F.at(y, 11, 16), FUEL, 240);
      pylons(y);
      let most = 0;
      while (y.launches.ever.every((v) => v === 0) && (y.depot[TESTROCKET] ?? 0) === 0 && y.tick < 6000) {
        F.step(y);
        most = Math.max(most, chargedIn(y, pad));
      }
      return [chargers, (y.depot[TESTROCKET] ?? 0) > 0, most <= 100];
    });
    expect(fired).toEqual([
      [1, false, true],
      [2, true, true],
    ]);
  }, 30_000);
});
