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
      // Only the stages with a Study know any research.
      if (name !== "study" && name !== "gate") for (const g of y.done) expect(F.isNode(g)).toBe(true);
      const back = F.decode(F.encode(y), y.land);
      expect(back && [F.check(back), F.encode(back)]).toEqual([F.check(y), F.encode(y)]);
    });

  test("mid has every node of tiers 0 and 1 done, and tier 2 open; large every node of tiers 0 to 2", () => {
    const mid = staged("mid");
    expect([ids(mid), mid.open.tier]).toEqual([below(2), 2]);
    const large = staged("large");
    expect([ids(large), large.open.tier]).toEqual([below(3), 3]);
  });

  test("hall has tier 3 just opened: the Study may be built, none stands and nothing is studied", () => {
    const y = staged("hall");
    expect([ids(y), y.open.tier]).toEqual([below(3), 3]);
    expect(F.locked(y.open, { build: F.STUDY })).toBeNull();
    expect([y.kind.includes(F.STUDY), y.line]).toEqual([false, []]);
  });

  test("study has a Study at work on folios its own line makes, research it has made known, and a full line", () => {
    const y = staged("study");
    const study = y.kind.indexOf(F.STUDY);
    expect(F.litOf(y)[study]).toBe(1);
    expect(F.power(y).pace).toBe(1);
    // Known: every node below tier 3, and research, each piece of it studied in full.
    const known = y.done.filter((g) => !F.isNode(g));
    expect(known.length).toBeGreaterThan(0);
    expect(
      y.done
        .filter(F.isNode)
        .map((g) => F.GOALS[g]?.id ?? "")
        .toSorted(),
    ).toEqual(below(3));
    expect(y.line.length).toBe(F.LINE);
    // The one being studied has been given folios, and the Study is at work on the next.
    const first = y.line[0];
    const given = first === undefined ? 0 : F.FOLIOS.reduce((n, f) => n + (y.got[first]?.[f] ?? 0), 0);
    expect(given).toBeGreaterThan(0);
    for (let k = 0; k < 100; k++) F.step(y);
    expect(F.status(y, study)?.state).toBe("working");
    // Some research still needs another first: the screen has one to show dim.
    expect(F.ALL_GOALS.some((g) => !F.isNode(g) && y.open.done[g] !== 1 && !F.ready(y.open, g))).toBe(true);
  });

  test("gate has tier 4 just opened, by research its Study made known: its commission in hand, its land for sale, and a splitter putting no way first", () => {
    const y = staged("gate");
    expect([y.open.tier, F.GOALS[y.hand === -1 ? 0 : y.hand]?.id]).toEqual([4, "kits"]);
    expect(ids(y).filter((id) => F.NODES.some((n) => n.id === id))).toEqual(below(4));
    expect((["hollow", "seam", "pond"] as const).map((p) => F.plotState(y, F.plot(p)).state)).toEqual([
      "for sale",
      "for sale",
      "for sale",
    ]);
    const split = F.at(y, 26, 13);
    expect([y.kind[split], y.first[split], F.locked(y.open, { first: true })]).toEqual([
      F.SPLITTER,
      0,
      "Putting a way first is not unlocked yet",
    ]);
    // Both its open ways lead somewhere, and both have had something.
    expect([F.takes(y, F.at(y, 25, 13), split), F.takes(y, F.at(y, 26, 14), split)]).toEqual([true, true]);
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
