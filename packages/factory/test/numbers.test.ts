/**
 * Whole numbers: nothing a yard keeps is a fraction; a yard short of power works on exactly as many
 * ticks as its power covers, with nothing lost over time; Coins are whole thousandths.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { delivering, generated } from "./yards.ts";

/** Every number a yard or a record reaches, in its parts and in its arrays of numbers (the rest hold whole numbers only), with its path. */
function numbers(v: unknown, path: string, out: [string, number][]): [string, number][] {
  if (typeof v === "number") out.push([path, v]);
  else if (v instanceof Float64Array) v.forEach((x, k) => out.push([`${path}.${k}`, x]));
  else if (Array.isArray(v)) v.forEach((x, k) => numbers(x, `${path}.${k}`, out));
  else if (typeof v === "object" && v !== null && !ArrayBuffer.isView(v))
    for (const [k, x] of Object.entries(v)) numbers(x, `${path}.${k}`, out);
  return out;
}

/** A land of 11 by 11 tiles of deadfall around the depot, every tile but its corners in the depot's reach. */
const land = (): F.Land => {
  const deposits: [number, number, "deadfall"][] = [];
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) deposits.push([x, y, "deadfall"]);
  return bareLand(11, 11, deposits, [5, 5]);
};

/**
 * A yard at tier 2 drawing `gatherers` power from the depot's 20: one gatherer hands straight into the depot
 * and always has work; the rest gather one thing each, with nowhere to put it, and go on drawing.
 */
function short(gatherers: number): { y: F.Yard; r: number } {
  const y = F.create({ land: land(), tier: 2 });
  const spots: [number, number][] = [];
  for (let z = 0; z < 11; z++)
    for (let x = 0; x < 11; x++) {
      const dx = x - 5;
      const dz = z - 5;
      if (Math.abs(dx) > 1 || Math.abs(dz) > 1)
        if (dx * dx + dz * dz <= 43 && !(x === 5 && z === 3)) spots.push([x, z]);
    }
  expect(F.build(y, F.GATHERER, 5, 3, 1, Infinity).ok).toBe(true);
  for (const [x, z] of spots.slice(0, gatherers - 1)) expect(F.build(y, F.GATHERER, x, z, 0, Infinity).ok).toBe(true);
  return { y, r: y.row[F.at(y, 5, 3)] ?? -1 };
}

/** How many of `n` ticks the gatherer on row `r` worked: its work moves on every tick it works. */
function worked(y: F.Yard, r: number, n: number): number {
  let ticks = 0;
  for (let k = 0; k < n; k++) {
    const before = y.holders.work[r];
    F.step(y);
    if (y.holders.work[r] !== before) ticks++;
  }
  return ticks;
}

describe("whole numbers", () => {
  test("no number in a working yard is a fraction, kept or not: what is open, the pace counter and a pylon's reach among them", () => {
    const shortYard = short(32).y;
    for (let k = 0; k < 777; k++) F.step(shortYard);
    const running = F.decode(F.encode(generated().y), generated().y.land);
    if (!running) throw new Error("no yard");
    for (let k = 0; k < 2000; k++) F.step(running);
    expect(running.open.reach).toBe(135);
    for (const y of [delivering(), running, shortYard]) {
      expect(numbers(JSON.parse(F.encode(y)), "", []).filter(([, v]) => !Number.isInteger(v))).toEqual([]);
      expect(numbers(y, "", []).filter(([, v]) => !Number.isInteger(v))).toEqual([]);
    }
  });

  test("short of power, every machine works on exactly as many ticks as the power covers, and nothing is lost over time", () => {
    // 20 power and 32 drawn: 5 ticks in 8.
    const { y, r } = short(32);
    F.rewire(y);
    // Power is counted in halves.
    expect([y.supply, y.demand]).toEqual([40, 64]);
    expect(worked(y, r, 1000)).toBe(625);
    expect(worked(y, r, 3)).toBe(Math.floor((1003 * 5) / 8) - 625);
    // Read back half way, what was put by is kept: the same ticks are worked as without a break.
    const a = short(32);
    const b = short(32);
    const first = worked(a.y, a.r, 501);
    const back = F.decode(F.encode(a.y), a.y.land);
    if (!back) throw new Error("no yard");
    expect(first + worked(back, back.row[F.at(back, 5, 3)] ?? -1, 499)).toBe(worked(b.y, b.r, 1000));
    // With power enough, every tick.
    const full = short(20);
    expect(worked(full.y, full.r, 100)).toBe(100);
  });

  test("Coins are whole thousandths: the depot pays a hundredth of a thing's worth on arrival, and the till pays in whole Coins", () => {
    const y = delivering();
    const came = F.ALL_ITEMS.reduce((sum, n) => sum + (y.depot[n] ?? 0) * (F.ARRIVAL[n] ?? 0), 0);
    expect(F.ARRIVAL[F.item("plank")]).toBe(3);
    expect(y.till).toBe(came);
    const coins = F.collect(y);
    expect(coins).toBe(Math.floor(came / F.MILLI));
    expect(y.till).toBe(came % F.MILLI);
  });
});
