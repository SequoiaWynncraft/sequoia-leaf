/**
 * Tier 6's commission made by the real rules (`roadbed.ts`): a staged yard whose still feeds three
 * benches, two crackers and a powerhouse finishes "A road that stays where it is put"; the same yard
 * with no crackers and no powerhouse has nowhere for the pitch and creosote its benches do not take,
 * and stops for good.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { roadbedYard } from "./roadbed.ts";

const ROADBED = F.goal("roadbed");
/** What the commission has been given of each thing it wants. */
const given = (y: F.Yard): number[] =>
  (["tarmac", "sleeper", "varnish"] as const).map((n) => y.got[ROADBED]?.[F.item(n)] ?? 0);
/** Every line the pieces of a yard say. */
function lines(y: F.Yard): Set<string> {
  const said = new Set<string>();
  for (let i = 0; i < y.kind.length; i++) {
    const line = F.status(y, i)?.line;
    if (line) said.add(line);
  }
  return said;
}

describe("the commission of tier 6, by the real rules", () => {
  test("a staged yard, its surplus pitch and creosote cracked, makes 2,000 tarmac, 4,000 sleepers and 6,000 varnish", () => {
    const y = roadbedYard(true);
    expect(F.GOALS[y.hand]?.id).toBe("roadbed");
    let ticks = 0;
    while (!y.done.includes(ROADBED) && ticks < 240_000) {
      F.step(y);
      ticks++;
    }
    expect(y.done.includes(ROADBED)).toBe(true);
    // About three and a half hours of the yard's time, its one plot at the most smog for most of it.
    expect(ticks).toBeLessThan(140_000);
    expect(y.news.some((n) => n.kind === "done" && n.goal === "roadbed")).toBe(true);
  });

  test("the same yard with no crackers and no powerhouse fills its pitch line once the gravel is gone, and stops short for good", () => {
    const y = roadbedYard(false);
    for (let k = 0; k < 120_000; k++) F.step(y);
    const stopped = given(y);
    for (let k = 0; k < 120_000; k++) F.step(y);
    expect(y.done.includes(ROADBED)).toBe(false);
    expect(given(y)).toEqual(stopped);
    const [tarmac = 0, sleepers = 0, varnish = 0] = stopped;
    expect([tarmac, sleepers < 4000, varnish < 1000]).toEqual([2000, true, true]);
    const said = lines(y);
    expect(said.has("Nowhere to send its pitch: nothing is on the tile it points at.")).toBe(true);
    // Every way its pitch line goes ends at a piece in trouble, a bench starved of gravel or a belt
    // pointing at nothing: the still has stopped for good, and says so.
    expect(said.has("Stopped: its pitch cannot leave by its left way out. It makes nothing else until it does.")).toBe(
      true,
    );
  });
});
