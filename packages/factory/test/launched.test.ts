/**
 * Tier 8's launches made by the real rules (`launchyard.ts`): a staged yard fires Pipwick's test
 * rocket from a pad with 2 chargers at grade I, then launches the guild's rocket from a pad with banks
 * of chargers III at its four doors, and finishes "Something to point up" and "The first launch".
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { chargedIn } from "./launch.ts";
import { launchYard, MAIN } from "./launchyard.ts";

const TESTFIRING = F.goal("testfiring");
const LAUNCH = F.goal("launch");

describe("tier 8's launches, by the real rules", () => {
  test("a staged yard fires its test rocket, then launches its rocket, and finishes the test firing and the commission", () => {
    const y = launchYard();
    expect(F.GOALS[y.hand]?.id).toBe("testfiring");
    for (let k = 0; k < 300; k++) F.step(y);
    expect([F.power(y).speed, F.power(y).demand]).toEqual([100, 1960]);
    const pad = F.at(y, MAIN[0], MAIN[1]);
    let fired = -1;
    let most = 0;
    while (!y.done.includes(LAUNCH) && y.tick < 30_000) {
      F.step(y);
      if (fired < 0 && y.done.includes(TESTFIRING)) fired = y.tick;
      most = Math.max(most, chargedIn(y, pad));
    }
    console.log(
      `test rocket at tick ${fired}; the rocket at tick ${y.tick}, its pad holding ${most} charged cells at most`,
    );
    expect([fired > 0, y.done.includes(LAUNCH), y.tick < 6000]).toEqual([true, true, true]);
    // The test firing came first; each launch reached the depot once; the rocket counts as any launch.
    expect([
      y.done.indexOf(TESTFIRING) < y.done.indexOf(LAUNCH),
      y.depot[F.item("testrocket")],
      y.depot[F.item("rocket")],
    ]).toEqual([true, 1, 1]);
    expect([...y.launches.ever]).toEqual([1, 0, 0, 0, 0]);
    expect(y.news.some((n) => n.kind === "done" && n.goal === "launch")).toBe(true);
    expect(F.NODES[LAUNCH]?.gift?.id).toBe("sky-beacon");
  }, 120_000);
});
