/**
 * A kept yard reads back what the tick can make: no holder may come to hold more of a thing than a
 * kept one reads back (`Hooks.most`), or the yard read back is another yard. Tier 8's first review
 * found a launch pad past it: clogged, with no way out, the beat turned its last charged cells plain
 * and took it past 1,000 plain cells, which it read back as 1,000. Here: that pad, kept on each side
 * of a beat; a pad at the most it can come to (999 plain cells and 1,000 charged cells with 1 bar,
 * which one beat makes 1,999 plain cells); and every kind that holds things, filled at random by its own
 * room, run, passed over by the beat and (a pad) set to another rocket between, kept and read back
 * each time.
 */
import { expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareYard, CELL, crate, fill, FUEL, holding, HULL, ONE, PAD, put, pylons, rocketPad, until } from "./launch.ts";
import { rng } from "./random.ts";
import { give, must } from "./yards.ts";

/** Whether a yard kept and read back is the same yard, by the check. */
function same(y: F.Yard): boolean {
  const back = F.decode(F.encode(y), y.land);
  return back !== null && F.check(back) === F.check(y);
}

/** A copy of a yard, kept and read back; and the first tick of the next `ticks` at which it and the yard part, or -1. */
function apart(y: F.Yard, ticks: number): number {
  const copy = F.decode(F.encode(y), y.land);
  if (!copy) return y.tick;
  if (F.check(copy) !== F.check(y)) return y.tick;
  for (let k = 0; k < ticks; k++) {
    F.step(y);
    F.step(copy);
    if (F.check(y) !== F.check(copy)) return y.tick;
  }
  return -1;
}

test("a test pad fed by one charger at grade II with no way out clogs past 1,000 plain cells, and reads back as it was across the beats after", () => {
  const y = bareYard(32, 30, [27, 25]);
  const pad = put(y, "launchpad", [14, 14], 0);
  fill(y, pad, HULL, 60);
  fill(y, pad, FUEL, 240);
  // The charger against its back, fed from a crate of cells behind it kept full: 90 a minute never holds the test rocket's 100 at once.
  put(y, "charger", [10, 14], 0, 2);
  const c = crate(y, [9, 14], 0, CELL, 0);
  pylons(y);
  const plain = (): number => holding(y, pad, [CELL])[0] ?? 0;
  const run = (): void => {
    fill(y, c, CELL, y.open.crate - 1 - (y.holders.count[F.holderOf(y, c)] ?? 0));
    F.step(y);
  };
  while (plain() <= F.CLOGGED && y.tick < 20_000) run();
  // A beat took it past: here 1,019 plain cells at tick 7,200.
  const past = y.tick;
  expect([
    past % F.CHARGED.beat,
    plain() > F.CLOGGED,
    y.depot[F.item("testrocket")] ?? 0,
    F.padAt(y, pad)?.clogged,
  ]).toEqual([0, true, 0, true]);
  // Kept and read back on every tick through the next two beats, then run on beside its copy.
  while (y.tick < past + 2 * F.CHARGED.beat + 2) {
    expect([y.tick, same(y)]).toEqual([y.tick, true]);
    run();
  }
  expect(apart(y, 3 * F.CHARGED.beat)).toBe(-1);
}, 30_000);

test("a pad with no power, 999 plain cells and 1,000 charged cells with 1 bar reads back as it was, before and after the beat that makes them 1,999 plain cells", () => {
  const y = bareYard(32, 30, [27, 25]);
  const pad = rocketPad(y);
  fill(y, pad, CELL, 999);
  fill(y, pad, ONE, 1000);
  until(y, F.CHARGED.beat - 1);
  expect([same(y), F.PAD_HOLDS[CELL]]).toEqual([true, F.CLOGGED - 1 + 1000]);
  expect(apart(y, 2)).toBe(-1);
  expect([holding(y, pad, [CELL, ONE]), same(y)]).toEqual([[1999, 0], true]);
});

/** Every kind that holds things and takes something in, on its own tile in a bare yard knowing tier 8, with power (a gatherer, which takes nothing, stands only on a deposit). */
function holders(): { name: string; y: F.Yard; i: number; takes: F.Item[] }[] {
  return F.ALL_KINDS.filter((k) => F.HOLDS[k] === 1).flatMap((k) => {
    const y = bareYard(32, 30, [27, 25]);
    if ("refused" in give(y, { do: "build", kind: F.kindName(k), x: 14, y: 14, dir: 0 })) return [];
    const i = F.at(y, 14, 14);
    pylons(y);
    const takes = F.ALL_ITEMS.filter((n) => F.RULES[k]?.wants(F.KIT, y, i, n));
    return takes.length > 0 ? [{ name: F.kindName(k), y, i, takes }] : [];
  });
}

/** Hands a holder up to `count` of a thing, one at a time, while its own room takes it. */
function handIn(y: F.Yard, i: number, n: F.Item, count: number): void {
  const rules = F.RULES[y.kind[i] ?? F.NONE];
  const wire = y.wire ?? F.rewire(y);
  for (let c = 0; c < count; c++) {
    if (!rules?.room(F.KIT, y, i, n, 0, wire)) return;
    F.put(y.holders, F.holderOf(y, i), n);
  }
}

test("every kind that holds things, filled at random by its own room, run, passed over by the beat and set again between, reads back as it was each time", () => {
  const r = rng(11);
  const all = holders();
  const seen = all.map(({ name, y, i, takes }) => {
    const at = { x: i % y.land.w, y: Math.floor(i / y.land.w) };
    let parted = 0;
    for (let round = 0; round < 300; round++) {
      const n = takes[Math.floor(r() * takes.length)];
      if (n !== undefined) handIn(y, i, n, Math.floor(r() * 400));
      const roll = r();
      if (roll < 0.2) F.beat(y, y.wire ?? F.rewire(y));
      else if (roll < 0.3) for (let t = Math.floor(r() * 30); t > 0; t--) F.step(y);
      else if (roll < 0.4 && y.kind[i] === PAD) {
        const was = F.ITEMS[y.set[i] ?? F.NONE];
        must(y, { do: "recipe", ...at, item: was === "rocket" ? "testrocket" : "rocket", was });
      }
      if (!same(y)) parted++;
    }
    return `${name}: ${parted}`;
  });
  expect(all.map((h) => h.name)).toEqual(
    expect.arrayContaining(["crate", "workshop", "study", "charger", "launchpad"]),
  );
  expect(seen).toEqual(all.map((h) => `${h.name}: 0`));
}, 60_000);
