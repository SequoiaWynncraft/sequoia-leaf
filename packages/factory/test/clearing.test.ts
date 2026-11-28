/**
 * Clearing a plot (`clearing.ts`): every plot past the first ring is cleared with goods delivered to
 * the depot before it is bought. The table (each plot's goods, sized in line-hours by its ring); one
 * clearing at a time, taken on, filled by deliveries after the node in hand and before the side
 * orders, handed over or stopped; and how it is kept and checked.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { KNOWN_AT_10 } from "../src/known10.ts";
import { beforeReach } from "./goals.ts";
import { bought, clearedFor, give, must } from "./yards.ts";

/** The grade III line-hours of goods: each, at what one grade III machine of its maker makes of it a minute. */
function hoursOf(want: Float64Array): number {
  return F.ALL_ITEMS.reduce((sum, n) => {
    const count = want[n] ?? 0;
    if (count === 0) return sum;
    const { kind, recipe } = F.makerOf(n);
    return sum + count / F.makes(kind, 3, recipe) / 60;
  }, 0);
}

/** What is open once each tier is done, the first ring's first. */
const OPENS = [1, 2, 3, 4, 5].map((t) => F.create({ seed: 1, tier: t + 1 }).open);
/** The tier a good is first made in: the first whose end lets a yard make it. */
const tierOf = (n: F.Item): number => OPENS.findIndex((o) => F.locked(o, { make: n }) === null) + 1;
/** The line-hours each ring's clearings are sized to. */
const HOURS: Readonly<Record<number, number>> = { 2: 0.5, 3: 1.5 };

const WORKINGS = F.plot("workings");
const want = (p: F.Plot): Float64Array => {
  const w = F.CLEARING[p];
  if (!w) throw new Error("no clearing");
  return w;
};
const goods = (p: F.Plot): F.Item[] => F.ALL_ITEMS.filter((k) => (want(p)[k] ?? 0) > 0);
/** The clearing a page shows: its plot and its number, as Stop and Hand over carry them. */
function shown(y: F.Yard): { plot: string; begun: number } {
  const c = y.clearing;
  if (!c) throw new Error("no clearing");
  return { plot: F.plotName(c.plot), begun: c.begun };
}

/** What The Old Workings' clearing asks for, as a save keeps it. */
const OLD = { lantern: 600, pipe: 900 };
/** A kept clearing of The Old Workings, as a save holds it. */
const workings = (filled: Record<string, number>, begun = 1, asks: Record<string, number> = OLD) => ({
  clearing: { plot: "workings", begun, want: asks, filled },
});

/** A yard past tier 4's commission that owns today's nine plots, with the second ring for sale round them, and nothing in hand. */
function meadow(): F.Yard {
  const y = beforeReach(F.create({ seed: 3, tier: 5 }));
  for (let more = true; more;) {
    const p = F.LAND.plots.find((q) => q.ring === 1 && F.plotState(y, q.plot).state === "for sale");
    more = p !== undefined;
    if (p) bought(y, F.plotName(p.plot));
  }
  y.hand = -1;
  y.history = [];
  return y;
}

describe("the clearings table", () => {
  test("every plot past the first ring has a clearing of 2 or 3 goods, in its ring's line-hours within 10%; the first ring's plots none", () => {
    for (const p of F.LAND.plots) {
      const name = F.plotName(p.plot);
      if (p.ring <= 1) {
        expect([name, F.CLEARING[p.plot]]).toEqual([name, null]);
        continue;
      }
      const hours = hoursOf(want(p.plot));
      const target = HOURS[p.ring] ?? 0;
      expect([name, goods(p.plot).length >= 2 && goods(p.plot).length <= 3]).toEqual([name, true]);
      expect([name, Math.abs(hours / target - 1) <= 0.1 ? target : hours]).toEqual([name, target]);
    }
  });

  test("the second ring asks for goods of tiers 3 and 4, the third of tier 4; the depot takes each, and the first ring makes them all", () => {
    const first = F.LAND.plots.filter((p) => p.ring <= 1).map((p) => p.plot);
    const makes = new Set(F.makeableOn(F.LAND, OPENS[4] ?? F.create({ tier: 6 }).open, first));
    const depot = F.create({ seed: 1, tier: 5 });
    const at = F.at(depot, depot.land.depot[0], depot.land.depot[1]);
    for (const p of F.LAND.plots.filter((q) => q.ring >= 2)) {
      const name = F.plotName(p.plot);
      const tiers = p.ring === 2 ? [3, 4] : [4];
      for (const k of goods(p.plot)) {
        const good = F.itemName(k);
        expect([name, good, tiers.includes(tierOf(k))]).toEqual([name, good, true]);
        expect([name, good, F.wants(depot, at, k), makes.has(k)]).toEqual([name, good, true, true]);
      }
    }
  });

  test("its words: whole numbers, each good by its name for many", () => {
    expect(F.goodsText(want(WORKINGS))).toBe("600 lanterns and 900 pipes");
    expect(F.goodsText(want(F.plot("acre")))).toBe("300 raid kits, 150 beacons and 150 orreries");
  });
});

describe("clearing a plot", () => {
  test("is taken on from a plot for sale that touches the yard's land, one at a time, and says plainly why not", () => {
    const y = meadow();
    const refused = (c: Record<string, unknown>): string | null => {
      const did = give(y, c);
      return "refused" in did ? did.why : null;
    };
    expect(F.clearingState(y, WORKINGS)).toBe("to clear");
    expect(refused({ do: "clearPlot", plot: "meadow" })).toBe("You already own that plot");
    // A plot of the first ring for sale is bought with Coins alone.
    expect(F.clearRefusal(F.create({ seed: 3, tier: 5 }), F.plot("bank"))).toBe("The Clay Bank needs no clearing");
    expect(refused({ do: "clearPlot", plot: "crater" })).toBe("The Crater does not touch the yard's land yet");
    expect(refused({ do: "buyPlot", plot: "workings", price: 100_000 })).toBe("The Old Workings must be cleared first");
    expect(refused({ do: "handClearing", plot: "workings", begun: 1 })).toBe("You are clearing no plot");
    expect(refused({ do: "stopClearing", plot: "workings", begun: 1 })).toBe("You are clearing no plot");
    expect(refused({ do: "clearPlot", plot: "workings" })).toBeNull();
    expect([F.clearingState(y, WORKINGS), y.clearing?.plot]).toEqual(["clearing", WORKINGS]);
    expect(refused({ do: "clearPlot", plot: "workings" })).toBe("You are clearing The Old Workings already");
    expect(refused({ do: "clearPlot", plot: "flats" })).toBe("You are clearing The Old Workings already");
    expect(refused({ do: "handClearing", ...shown(y) })).toBe(
      "The Old Workings still wants 600 lanterns and 900 pipes",
    );
  });

  test("is given what the depot takes in after the node in hand and before the side orders, and no more than it wants", () => {
    const y = meadow();
    const pipe = F.item("pipe");
    const node = F.ALL_GOALS.find((g) => F.isNode(g) && (F.GOALS[g]?.want[pipe] ?? 0) > 0);
    if (node === undefined) throw new Error("no project wants pipes");
    must(y, { do: "clearPlot", plot: "workings" });
    const order: F.Standing = {
      id: y.serial++,
      title: "Pipes for the guild",
      from: "The guild",
      line: "",
      want: F.countsOf({ pipe: 5000 }),
      pay: 100,
      filled: F.counts(),
      starts: 0,
    };
    y.board = [order];
    F.hold(y, node);
    const got = y.got[node] ?? F.counts();
    const hand = F.GOALS[node]?.want[pipe] ?? 0;
    // A project in hand that wants pipes takes them all.
    F.deliver(y, pipe, 100);
    expect([got[pipe], y.clearing?.filled[pipe], order.filled[pipe]]).toEqual([100, 0, 0]);
    // Once it has all it wants of them, the clearing takes 900, all it wants; the order the rest.
    got[pipe] = hand;
    F.deliver(y, pipe, 1000);
    expect([got[pipe], y.clearing?.filled[pipe], order.filled[pipe]]).toEqual([hand, 900, 100]);
  });

  test("handed over once it has all it wants clears the plot for good; then it is bought at its price then", () => {
    const y = meadow();
    must(y, { do: "clearPlot", plot: "workings" });
    F.deliver(y, F.item("lantern"), 600);
    expect(y.news.some((n) => n.kind === "clearing")).toBe(false);
    F.deliver(y, F.item("pipe"), 900);
    expect(y.news.filter((n) => n.kind === "clearing")).toEqual([
      { kind: "clearing", plot: "workings", title: "The Old Workings", pay: 0 },
    ]);
    const till = y.till;
    const did = give(y, { do: "handClearing", ...shown(y) });
    // It pays nothing, and logs nothing: the goods were the price.
    expect("refused" in did ? did : [did.coins, did.log, y.till]).toEqual([[], [], till]);
    expect([F.clearingState(y, WORKINGS), y.clearing, y.cleared]).toEqual(["cleared", null, [WORKINGS]]);
    expect(give(y, { do: "clearPlot", plot: "workings" })).toMatchObject({
      why: "The Old Workings is cleared already",
    });
    y.till = 200_000 * F.MILLI;
    expect(give(y, { do: "buyPlot", plot: "workings", price: 100_000 })).not.toHaveProperty("refused");
    expect([y.plots.includes(WORKINGS), F.clearingState(y, WORKINGS)]).toEqual([true, "cleared"]);
  });

  test("stopped, gives nothing back: what was delivered is gone, and taken on again it starts from nothing", () => {
    const y = meadow();
    must(y, { do: "clearPlot", plot: "workings" });
    F.deliver(y, F.item("lantern"), 400);
    const [till, depot] = [y.till, Float64Array.from(y.depot)];
    const did = give(y, { do: "stopClearing", ...shown(y) });
    expect("refused" in did ? did : did.coins).toEqual([]);
    expect([y.clearing, y.till, Array.from(y.depot)]).toEqual([null, till, Array.from(depot)]);
    must(y, { do: "clearPlot", plot: "flats" });
    must(y, { do: "stopClearing", ...shown(y) });
    must(y, { do: "clearPlot", plot: "workings" });
    expect(y.clearing?.filled[F.item("lantern")]).toBe(0);
  });

  test("a late Stop or Hand over, for a clearing stopped since, is refused and loses nothing: two pages of one yard", () => {
    const y = meadow();
    must(y, { do: "clearPlot", plot: "workings" });
    // Both pages show The Old Workings being cleared; one stops it and clears The Flats.
    const seen = shown(y);
    must(y, { do: "stopClearing", ...seen });
    must(y, { do: "clearPlot", plot: "flats" });
    F.deliver(y, F.item("beacon"), 100);
    const filled = Array.from(y.clearing?.filled ?? []);
    // The other page's Stop, and its Hand over, are for the clearing it saw, not the one being done.
    for (const late of ["stopClearing", "handClearing"]) {
      expect(give(y, { do: late, ...seen })).toMatchObject({ why: "That clearing has changed since" });
    }
    expect([y.clearing?.plot, Array.from(y.clearing?.filled ?? [])]).toEqual([F.plot("flats"), filled]);
    expect(filled[F.item("beacon")]).toBe(100);
  });

  test("stopped and taken on again on the same plot, it is another clearing: a command for the first is refused", () => {
    const y = meadow();
    must(y, { do: "clearPlot", plot: "workings" });
    const first = shown(y);
    must(y, { do: "stopClearing", ...first });
    must(y, { do: "clearPlot", plot: "workings" });
    F.deliver(y, F.item("pipe"), 300);
    expect([shown(y), first]).toEqual([
      { plot: "workings", begun: 2 },
      { plot: "workings", begun: 1 },
    ]);
    expect(give(y, { do: "stopClearing", ...first })).toMatchObject({ why: "That clearing has changed since" });
    expect(y.clearing?.filled[F.item("pipe")]).toBe(300);
    must(y, { do: "stopClearing", ...shown(y) });
    expect(y.clearing).toBeNull();
  });

  test("asks for what the table asked for when it began: the table changed since, it and a copy read back still ask for that", () => {
    const y = meadow();
    const pipe = F.item("pipe");
    must(y, { do: "clearPlot", plot: "workings" });
    const table = want(WORKINGS);
    const was = Float64Array.from(table);
    try {
      // A newer Leaf asks more of The Old Workings: the clearing begun before still wants 900 pipes.
      table[pipe] = 1200;
      F.deliver(y, F.item("lantern"), 600);
      F.deliver(y, pipe, 1000);
      const back = F.decode(F.encode(y));
      expect([
        y.clearing?.filled[pipe],
        F.clearingReady(y),
        back?.clearing?.filled[pipe],
        back && F.clearingReady(back),
      ]).toEqual([900, true, 900, true]);
      // One begun after the change asks for the table's new count.
      must(y, { do: "stopClearing", ...shown(y) });
      must(y, { do: "clearPlot", plot: "workings" });
      expect(y.clearing?.want[pipe]).toBe(1200);
    } finally {
      table.set(was);
    }
  });

  test("Undo never gives its goods back: a piece built before it is undone, and the clearing keeps all it was given", () => {
    const y = meadow();
    y.till = 1000 * F.MILLI;
    const [x, z] = [y.land.depot[0] - 4, y.land.depot[1] - 3];
    must(y, { do: "build", kind: "belt", x, y: z, dir: 0, id: "c-1" });
    must(y, { do: "clearPlot", plot: "workings", id: "c-2" });
    F.deliver(y, F.item("pipe"), 300);
    expect(y.history.at(-1)?.id).toBe("c-1");
    must(y, { do: "undo", entry: "c-1", id: "c-3" });
    expect([y.kind[F.at(y, x, z)], y.clearing?.filled[F.item("pipe")]]).toEqual([F.NONE, 300]);
  });
});

describe("a clearing kept", () => {
  test("is kept by its plot's name and number and checked, only where there is one: taken on and stopped, the yard keeps the count begun", () => {
    const y = meadow();
    const [text, check] = [F.encode(y), F.check(y)];
    for (const field of ["clearing", "cleared", "begun"]) expect(JSON.parse(text)).not.toHaveProperty(field);
    must(y, { do: "clearPlot", plot: "workings" });
    expect(F.check(y)).not.toBe(check);
    must(y, { do: "stopClearing", ...shown(y) });
    // Stopped, there is no clearing; but one was begun, and the next is numbered after it.
    const stopped = JSON.parse(F.encode(y));
    expect([stopped.clearing, stopped.begun, F.check(y) === check]).toEqual([undefined, 1, false]);
    expect(F.decode(F.encode(y))?.begun).toBe(1);
    must(y, { do: "clearPlot", plot: "workings" });
    F.deliver(y, F.item("pipe"), 300);
    expect(JSON.parse(F.encode(y)).clearing).toEqual({ plot: "workings", begun: 2, want: OLD, filled: { pipe: 300 } });
    const back = F.decode(F.encode(y));
    expect([back?.clearing, back?.begun, back && F.check(back)]).toEqual([y.clearing, 2, F.check(y)]);
    // Its number, and what it asks for, are checked: two copies alike but for one of them do not agree.
    const other = (change: Partial<NonNullable<F.Yard["clearing"]>>): number => {
      const copy = F.decode(F.encode(y));
      if (!copy?.clearing) throw new Error("no clearing read");
      copy.clearing = { ...copy.clearing, ...change };
      return F.check(copy);
    };
    expect(other({ begun: 1 })).not.toBe(F.check(y));
    expect(other({ want: F.countsOf({ lantern: 600, pipe: 901 }) })).not.toBe(F.check(y));
    // And with what was given to it, it changes the check as it changes.
    const given = F.check(y);
    F.deliver(y, F.item("pipe"), 1);
    expect(F.check(y)).not.toBe(given);
    must(y, { do: "stopClearing", ...shown(y) });
    clearedFor(y, "workings");
    expect(JSON.parse(F.encode(y)).cleared).toEqual(["workings"]);
    expect(F.check(y)).not.toBe(check);
    expect(F.decode(F.encode(y))?.cleared).toEqual([WORKINGS]);
  });

  test("read back, asks for what it asked for, is no more than it wants, on a plot it could take on now; a plot no Leaf knows is a newer Leaf's", () => {
    const y = meadow();
    must(y, { do: "clearPlot", plot: "workings" });
    const record = JSON.parse(F.encode(y));
    const read = (more: Record<string, unknown>): F.Yard | null => F.decode(JSON.stringify({ ...record, ...more }));
    expect(read(workings({ pipe: 99_999 }))?.clearing?.filled[F.item("pipe")]).toBe(900);
    // What it asks for is what was kept, not the table's now; and it asks for something, or it is not read.
    const asked = read(workings({ pipe: 99_999 }, 1, { pipe: 1000, gear: 5 }))?.clearing;
    expect([asked && F.goodsText(asked.want), asked?.filled[F.item("pipe")]]).toEqual([
      "5 gears and 1,000 pipes",
      1000,
    ]);
    expect([read(workings({}, 1, {}))?.clearing, read({ clearing: { plot: "workings", begun: 1 } })?.clearing]).toEqual(
      [null, null],
    );
    expect(read({ clearing: { plot: "crater", begun: 1, want: OLD, filled: {} } })?.clearing).toBeNull();
    expect(read({ clearing: { plot: "bank", begun: 1, want: OLD, filled: {} } })?.clearing).toBeNull();
    // Its number is one the yard has begun: none, or past the count, and it is not read.
    expect([read(workings({}, 0))?.clearing, read(workings({}, 2))?.clearing]).toEqual([null, null]);
    expect(read({ ...workings({}, 2), begun: 2 })?.clearing?.begun).toBe(2);
    expect(read({ cleared: ["bank", "workings", "workings", "crater"] })?.cleared).toEqual([
      WORKINGS,
      F.plot("crater"),
    ]);
    for (const clearing of [
      { plot: "moon", begun: 1, want: OLD, filled: {} },
      { plot: "workings", begun: 1, want: { ...OLD, moonstone: 5 }, filled: {} },
    ]) {
      const newer = JSON.stringify({ ...record, clearing });
      expect([F.keptLater(newer), F.decode(newer)]).toEqual([true, null]);
    }
  });

  test("names only plots the Leaf of version 10 did not know, so that a yard holding one is kept as version 11", () => {
    const known = new Set<string>(KNOWN_AT_10.plots);
    expect(F.LAND.plots.filter((p) => F.CLEARING[p.plot] && known.has(F.plotName(p.plot)))).toEqual([]);
  });
});
