/**
 * The yards the play server stages for the tours are yards the rules could have made: built by
 * commands, every goal done finished, paid and logged by the rules, and nothing on them that play
 * could not have put there.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { fillHand, give, staged, STAGES } from "./yards.ts";

/** The ids of the nodes of the tiers below `tier`, and of the goals a yard has done, in one order. */
const below = (tier: number): string[] => F.NODES.flatMap((n) => (n.tier < tier ? [n.id] : [])).toSorted();
const ids = (y: F.Yard): string[] => y.done.map((g) => F.GOALS[g]?.id ?? "").toSorted();

/** The Coins, in thousandths, that finishing the goals a yard has done pays. */
const earned = (y: F.Yard): number => y.done.reduce((sum, g) => sum + (F.GOALS[g]?.pay ?? 0) * F.MILLI, 0);

describe("a staged yard", () => {
  for (const name of STAGES)
    test(`${name}: every goal it has done was finished and paid by the rules, and it reads back as itself`, () => {
      const y = staged(name);
      expect([y.paid, y.handed]).toEqual([earned(y), 0]);
      for (const g of y.done) expect(F.isNode(g)).toBe(true);
      const back = F.decode(F.encode(y), y.land);
      expect(back && [F.check(back), F.encode(back)]).toEqual([F.check(y), F.encode(y)]);
    });

  test("mid has every node of tiers 0 and 1 done, and tier 2 open; large every node of tiers 0 to 2", () => {
    const mid = staged("mid");
    expect([ids(mid), mid.open.tier]).toEqual([below(2), 2]);
    const large = staged("large");
    expect([ids(large), large.open.tier]).toEqual([below(3), 3]);
  });

  test("fed, the node in hand is finished at the depot as in play: paid, the next in hand, and logged with the next command", () => {
    const y = staged("short");
    const gears = F.goal("gears");
    expect(y.hand).toBe(gears);
    const sold = y.sold;
    fillHand(y);
    expect(y.done.at(-1)).toBe(gears);
    expect([y.paid, y.sold > sold]).toEqual([earned(y), true]);
    const did = give(y, { do: "collect" });
    expect("refused" in did ? [] : did.log?.map((l) => l.data)).toContainEqual(
      expect.objectContaining({ node: "gears" }),
    );
  });
});
