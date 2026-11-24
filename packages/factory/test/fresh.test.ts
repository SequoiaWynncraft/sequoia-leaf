/**
 * A yard kept between ticks, as Leaf keeps one in memory between jobs, gives tick for tick the yard
 * one kept nowhere gives: read back from its kept form before each of its first `READ_EACH` ticks
 * and every minute after, with its waiting tiles (`Wire.waiting`), which are all the tick keeps that
 * a yard read back lacks, forgotten before every tick between. The two are held to each other's
 * check (`check.ts`: every part of every piece, and everything else a yard read back keeps) after
 * every tick, and as kept after every minute: for an hour, every staged yard, the first design's
 * save (the others are staged yards kept) and the delivering yard; for ten minutes the largest
 * staged yard and the generated yard; the junctions yard, with its owner's commands at the start of
 * each hour, for eight; and a yard in which a goal finished in a tick lets a full crate hold more.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import {
  cratesOpening,
  delivering,
  generated,
  JUNCTION_HOURS,
  junctions,
  must,
  saved,
  staged,
  STAGES,
} from "./yards.ts";

const MINUTE = 600;
const HOUR = 60 * MINUTE;
/** How many ticks a yard kept nowhere is read back before, one by one, at first. */
const READ_EACH = 200;

/** A copy of a yard as Leaf reads one from the store. */
const readBack = (y: F.Yard): F.Yard => {
  const back = F.decode(F.encode(y), y.land);
  if (!back) throw new Error("the yard does not read back");
  return back;
};

/**
 * Runs a kept yard and one kept nowhere on side by side for `ticks`, its owner's commands given to
 * both at the start of each hour; gives the first tick at which they differ, or -1.
 */
function differs(kept: F.Yard, ticks: number, hourly: readonly (readonly Record<string, unknown>[])[] = []): number {
  let afresh = readBack(kept);
  for (let t = 1; t <= ticks; t++) {
    if ((t - 1) % HOUR === 0)
      for (const c of hourly[(t - 1) / HOUR] ?? []) {
        must(kept, c);
        must(afresh, c);
      }
    if (t <= READ_EACH || t % MINUTE === 1) afresh = readBack(afresh);
    else afresh.wire?.waiting.fill(0);
    F.step(kept);
    F.step(afresh);
    if (F.check(kept) !== F.check(afresh)) return t;
    if (t % MINUTE === 0 && F.encode(kept) !== F.encode(afresh)) return t;
  }
  return -1;
}

describe("a yard kept between ticks gives every tick the yard read afresh gives", () => {
  const yards: [string, () => F.Yard, number][] = [
    ...STAGES.map((name): [string, () => F.Yard, number] => [
      `staged ${name}`,
      () => staged(name),
      name === "large" ? 10 * MINUTE : HOUR,
    ]),
    ["save v3-tier2", () => saved("v3-tier2"), HOUR],
    ["delivering", () => delivering(), HOUR],
    ["generated", () => readBack(generated().y), 10 * MINUTE],
    ["bigger crates opening in a tick", () => cratesOpening().y, MINUTE],
  ];
  for (const [name, make, ticks] of yards)
    test(
      name,
      () => {
        expect(differs(make(), ticks)).toBe(-1);
      },
      60_000,
    );

  test("the junctions yard, its owner's commands at the start of each hour, for eight hours", () => {
    expect(differs(junctions(), 8 * HOUR, JUNCTION_HOURS)).toBe(-1);
  }, 60_000);
});
