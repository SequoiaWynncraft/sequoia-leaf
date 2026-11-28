/**
 * Smog (SPEC-2 section 5.2): what a dirty piece finishes is made on its plot; every 100 ticks each
 * plot is counted against its ground (300 a minute) and each redwood standing on it (120); and the
 * pieces that work on a plot at step 1, 2 or 3 work at 3, 2 or 1 fourths of their pace: as 3, 2 or 1
 * tick in 4 would, on average, exactly, and with the yard short of power the two multiply.
 */
import { describe, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";

import * as F from "../src/index.ts";
import { learn } from "./goals.ts";
import { bareLand } from "./land.ts";
import { bought, must } from "./yards.ts";

const SALVAGE = F.item("salvage");
/** The Old Workings' place in the land's list, and its corner. */
const WORKINGS = F.LAND.plots.findIndex((p) => p.plot === F.plot("workings"));
const corner = F.LAND.plots[WORKINGS] ?? F.LAND.plots[0];
if (!corner) throw new Error("no Old Workings");

/** A yard with all of tier 5 known that owns the Long Meadow and The Old Workings, with pylons down to it from the depot. */
function workings(): F.Yard {
  const y = F.create({ seed: 1, tier: 6 });
  for (const plot of ["meadow", "workings"]) bought(y, plot);
  for (const z of [46, 50, 54, 58, 62, 66]) must(y, { do: "build", kind: "pylon", x: 58, y: z, dir: 0 });
  for (const x of [54, 50]) must(y, { do: "build", kind: "pylon", x, y: 68, dir: 0 });
  return y;
}
/** Breakers at a grade (III unless said) along The Old Workings' bottom rows (clear ground), with power, so many of them: their tiles. */
function breakers(y: F.Yard, n: number, grade = 3): number[] {
  return Array.from({ length: n }, (_, k) => {
    const [x, z] = [(corner?.x ?? 0) + 1 + 3 * k, (corner?.y ?? 0) + 10];
    must(y, { do: "build", kind: "breaker", x, y: z, dir: 0, ...(grade > 1 ? { grade } : {}) });
    const i = F.at(y, x, z);
    if (!F.litAt(y, i)) throw new Error("a breaker with no power");
    return i;
  });
}
/** Runs the yard on a tick, every breaker kept in salvage and what each finishes taken away at once, as a line would. */
function run(y: F.Yard, at: readonly number[], ticks: number): void {
  const h = y.holders;
  for (let t = 0; t < ticks; t++) {
    for (const i of at) {
      const r = F.holderOf(y, i);
      while (F.held(h, r, SALVAGE) < 8) F.put(h, r, SALVAGE);
    }
    F.step(y);
    for (const i of at) h.out[F.holderOf(y, i)] = F.NONE;
  }
}
const level = (y: F.Yard): number => y.smog.level[WORKINGS] ?? 0;
/** What one breaker of a grade on The Old Workings breaks in so many ticks, its smog held at a level, from just after a count. */
function counted(grade: number, smog: number, ticks: number): number {
  const y = workings();
  const at = breakers(y, 1, grade);
  while (y.tick % 100 !== 1) run(y, at, 1);
  y.smog.level[WORKINGS] = smog;
  y.smog.made[WORKINGS] = 0;
  run(y, at, ticks);
  return y.smog.made[WORKINGS] ?? 0;
}

describe("the pieces that work", () => {
  test("work in the plumbing's order, by tile, whatever plot each is on, as before smog: a yard with none runs as it did", () => {
    // The Clay Bank comes before the yard's own plot in the land's list, and its rows run below the
    // yard's top rows: a mill on each, the yard's on a row above the bank's.
    const y = F.create({ seed: 1, tier: 5 });
    bought(y, "bank");
    must(y, { do: "build", kind: "pylon", x: 49, y: 40, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 52, y: 37, dir: 0 });
    must(y, { do: "build", kind: "mill", x: 46, y: 40, dir: 0 });
    const work = Array.from(F.rewire(y).work);
    const on = new Set(work.map((i) => y.land.plots[y.land.plot[i] ?? 0]?.plot));
    expect([on.has(F.plot("yard")), on.has(F.plot("bank"))]).toEqual([true, true]);
    expect(work).toEqual(work.toSorted((a, b) => a - b));
  });
});

describe("smog on a plot", () => {
  test("2 breakers III on The Old Workings, which has 1 redwood, stay at 0: 400 a minute made, 420 cleared", () => {
    const y = workings();
    const at = breakers(y, 2);
    let most = 0;
    for (let c = 0; c < 100; c++) {
      run(y, at, 100);
      most = Math.max(most, level(y));
    }
    expect(most).toBe(0);
  });

  test("3 reach step 1 after 34 counts, give or take 1, and then settle between step 1 and step 2", () => {
    const y = workings();
    const at = breakers(y, 3);
    const levels: number[] = [];
    while (y.tick % 100 !== 0) F.step(y);
    for (let c = 0; c < 400; c++) {
      run(y, at, 100);
      levels.push(level(y));
    }
    const first = levels.findIndex((v) => v >= 1000) + 1;
    expect(Math.abs(first - 34)).toBeLessThanOrEqual(1);
    const after = levels.slice(first + 10);
    expect([Math.min(...after) >= 1000 - 100, Math.max(...after) < 2000 + 100]).toEqual([true, true]);
    // It says what it is doing, and why at a slower pace.
    expect(F.status(y, at[0] ?? 0)?.line).toMatch(/^Breaking salvage, at (75|50)% of its pace: smog on this plot\.$/);
  });

  test("a plot at step 2 works at half its pace, exactly: a breaker on it breaks half as much; at step 1 a grade I one three fourths", () => {
    // Grade III does 4 half-ticks of work a tick, a thing every 12: at step 2, 2 a tick, 16 things in 96 ticks.
    expect(counted(3, 2000, 96)).toBe(16);
    // Grade I does 2 a tick: at step 1, 1.5 a tick, the quarters past a half-tick carried over, 12 things in 96 ticks.
    expect(counted(1, 1000, 96)).toBe(12);
  });

  test("with the yard short of power, smog's share and power's multiply: at step 2 and half the power drawn, a fourth, never nothing", () => {
    const y = workings();
    const at = breakers(y, 1);
    // The depot gives half what is drawn (power in halves), and nothing else gives any: set by hand,
    // for no yard's pieces draw exactly twice its power.
    const { demand } = F.rewire(y);
    Object.assign(y.open, { depot: demand / 4 });
    F.rewire(y);
    expect(F.power(y).pace).toBe(0.5);
    while (y.tick % 100 !== 1) run(y, at, 1);
    y.smog.level[WORKINGS] = 2000;
    y.smog.made[WORKINGS] = 0;
    run(y, at, 96);
    // 48 ticks with power, each at half of grade III's pace: 96 half-ticks, 8 things of 12 each.
    expect(y.smog.made[WORKINGS]).toBe(8);
    expect(F.machineRate(y, at[0] ?? 0).share).toBe(0.25);
  });

  test("a redwood felled stops clearing at the next count, the plumbing as it was: 120 a minute less, for good", () => {
    const y = workings();
    learn(y, F.goal("felling"));
    // 2 breakers III make 400 a minute, and the ground and its redwood clear 420: it stays at 0.
    const two = breakers(y, 2);
    run(y, two, 1000);
    expect([level(y), F.smogLine(y, WORKINGS)]).toEqual([
      0,
      expect.stringContaining("Cleared 420 /min: the ground 300, 1 redwood 120."),
    ]);
    // Felled, with nothing built since (the plumbing is not worked out again), the ground alone
    // clears 300: 100 a minute more is made than cleared, and the card says so.
    const plumbing = y.wire;
    const tree = F.LAND.trees.find((tiles) => F.LAND.plot[tiles[0] ?? 0] === WORKINGS)?.[0] ?? -1;
    must(y, { do: "fell", x: tree % F.LAND.w, y: Math.floor(tree / F.LAND.w), price: F.fellPrice(y) });
    expect(F.smogLine(y, WORKINGS)).toContain("Cleared 300 /min: the ground 300.");
    while (y.tick % 100 !== 1) run(y, two, 1);
    run(y, two, 600);
    expect(y.wire).toBe(plumbing);
    expect(Math.abs(level(y) - 100)).toBeLessThanOrEqual(10);
    // Smog made on The Old Workings stays there: the Long Meadow next to it has none.
    const at = breakers(y, 3);
    run(y, at, 1000);
    const meadow = F.LAND.plots.findIndex((p) => p.plot === F.plot("meadow"));
    expect([level(y) > 0, y.smog.level[meadow]]).toEqual([true, 0]);
  });

  test("is kept by its plot's name and checked; a yard with none keeps and checks as before", () => {
    const y = workings();
    const clean = F.encode(y);
    expect(JSON.parse(clean)).not.toHaveProperty("smog");
    const check = F.check(y);
    y.smog.level[WORKINGS] = 1240;
    y.smog.made[WORKINGS] = 7;
    expect(JSON.parse(F.encode(y)).smog).toEqual({ workings: [1240, 7] });
    expect(F.check(y)).not.toBe(check);
    const back = F.decode(F.encode(y));
    expect([back?.smog.level[WORKINGS], back?.smog.made[WORKINGS], back && F.check(back)]).toEqual([
      1240,
      7,
      F.check(y),
    ]);
    // Never more than the most, whatever a record says.
    const record = { ...JSON.parse(F.encode(y)), smog: { workings: [99999, 3] } };
    expect(F.decode(JSON.stringify(record))?.smog.level[WORKINGS]).toBe(0);
  });
});

const ctx = (now: number): Ctx => ({
  now,
  player: { id: "p", guest: false },
  seed: 9,
  room: 0,
  awards: [],
  postcards: {},
});
const AT0 = 1_800_000_000_000;
const MINUTE_MS = 60_000;

/** A bare yard with all of tier 5 known whose one plot smogs: 3 breakers III, each fed from a full crate of salvage, into a shut crate. */
function smoggy(): F.Yard {
  const y = F.create({ land: bareLand(30, 12, [], [25, 5]), tier: 6, seed: 1 });
  for (const [x, z] of [
    [22, 10],
    [18, 10],
    [14, 10],
    [10, 10],
    [6, 10],
    [9, 4],
  ] as const)
    must(y, { do: "build", kind: "pylon", x, y: z, dir: 0 });
  for (const z of [1, 4, 7]) {
    must(y, { do: "build", kind: "crate", x: 3, y: z, dir: 0 });
    const r = F.holderOf(y, F.at(y, 3, z));
    for (let k = 0; k < y.open.crate; k++) F.put(y.holders, r, SALVAGE);
    must(y, { do: "build", kind: "breaker", x: 4, y: z, dir: 0, grade: 3 });
    must(y, { do: "build", kind: "belt", x: 6, y: z, dir: 0 });
    must(y, { do: "build", kind: "crate", x: 7, y: z, dir: 0 });
    must(y, { do: "crate", x: 7, y: z, open: false });
  }
  y.history = [];
  return y;
}

describe("Leaf's copy and the page's", () => {
  test("the same smoggy yard, tended by Leaf across 24 hours away and run on by the page tick by tick, gives one check all the way", () => {
    const start = smoggy();
    const text = F.encode(start);
    const leaf = F.decode(text, start.land);
    const page = F.decode(text, start.land);
    if (!leaf || !page) throw new Error("does not read back");
    leaf.at = AT0;
    leaf.seen = F.here(leaf);
    page.seen = F.here(page);
    let most = 0;
    const marks = [
      ...Array.from({ length: 12 }, (_, m) => (m + 1) * MINUTE_MS),
      ...Array.from({ length: 24 }, (_, h) => (h + 1) * 60 * MINUTE_MS),
    ];
    for (const after of marks) {
      // Leaf tends it in slices of any size; the page runs it on to Leaf's tick.
      for (let further = true; further;) {
        let left = 7777;
        further = F.FACTORY.tend?.(leaf, ctx(AT0 + after), () => left-- > 0) ?? false;
      }
      F.stepTo(page, leaf.tick);
      expect([after, F.check(page)]).toEqual([after, F.check(leaf)]);
      most = Math.max(most, leaf.smog.level[0] ?? 0);
    }
    // It did smog, and was 24 hours away in all.
    expect(most).toBeGreaterThan(0);
    expect(Math.abs(leaf.tick - leaf.seen.tick - 24 * 60 * F.MINUTE)).toBeLessThan(F.MINUTE);
  });
});
