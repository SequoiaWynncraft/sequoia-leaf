import { describe, expect, test } from "bun:test";

import {
  build,
  buyPlan,
  buyPlot,
  costOf,
  lineOf,
  paint,
  planRefusal,
  planState,
  plotRefusal,
  plotState,
  refusal,
  remove,
  tipOut,
  tunnelExit,
  turn,
} from "./build.ts";
import { CRATE, KIND, KINDS, REACH, STARTERS, TICKS } from "./content/machines.ts";
import { PLANS } from "./content/plans.ts";
import { PLOTS } from "./content/plots.ts";
import { create } from "./create.ts";
import { bare, belts, lit, on, put, run, steps } from "./fixtures.ts";
import { DX, DY } from "./grid.ts";
import { priceOf, stand } from "./pieces.ts";
import { repower } from "./power.ts";
import { route } from "./route.ts";
import { power } from "./step.ts";
import { at, collect, plotAt, put as hold, type World } from "./world.ts";

const price = (id: string): number => [...PLOTS, ...PLANS].find((p) => p.id === id)?.price ?? -1;

/** How much deadfall one gatherer sends the depot in ten minutes, with some plans bought. */
function gathered(plans: readonly ("rakes" | "barrows")[]): number {
  const w = create({ story: 20 });
  for (const id of plans) buyPlan(w, id, Infinity);
  put(w, "gatherer", 20, 15, 0);
  belts(w, 21, 15, 22, 15);
  belts(w, 23, 15, 23, 16);
  steps(w, 6000);
  return w.depot.deadfall ?? 0;
}
/** How many tiles a thing is carried in the time a plain belt carries it six, with some plans bought. */
function carried(plans: readonly ("waxed" | "rollers")[]): number {
  const w = create({ story: 20 });
  for (const id of plans) buyPlan(w, id, Infinity);
  belts(w, 16, 14, 31, 14);
  on(w, 16, 14).item = "ore";
  steps(w, TICKS.belt * 6);
  return Array.from({ length: 16 }, (_, k) => k).find((k) => on(w, 16 + k, 14).item) ?? -1;
}
/** How many planks one mill turns out in twenty minutes, with some plans bought. */
function milled(plans: readonly ("tooling" | "jigs")[]): number {
  const w = create({ story: 20 });
  for (const id of plans) buyPlan(w, id, Infinity);
  // Three gatherers on one mill, so the mill is what holds the line back at every tier.
  put(w, "mill", 19, 15, 2);
  put(w, "gatherer", 19, 14, 1);
  put(w, "gatherer", 20, 15, 2);
  put(w, "gatherer", 19, 16, 3);
  run(w, [18, 15], [23, 17]);
  steps(w, 12000);
  return w.depot.plank ?? 0;
}

describe("building", () => {
  test("building says what it cost, taking away says what comes back, and the depot stays", () => {
    const w = bare({ "2,2": "ore" });
    expect(build(w, "gatherer", 2, 2, 0, 50)).toEqual({ ok: true, cost: KIND.gatherer.cost });
    expect(remove(w, 2, 2)).toEqual({ ok: true, refund: KIND.gatherer.cost });
    expect(remove(w, 2, 2)).toEqual({ ok: false, why: "There is nothing here" });
    expect(remove(w, 12, 6)).toEqual({ ok: false, why: "The depot cannot be removed" });
    for (const kind of KINDS) {
      if (kind === "depot" || kind === "gatherer" || kind === "wheel") continue;
      expect([kind, build(w, kind, 4, 2, 0, 1000)]).toEqual([kind, { ok: true, cost: KIND[kind].cost }]);
      expect([kind, remove(w, 4, 2)]).toEqual([kind, { ok: true, refund: KIND[kind].cost }]);
      expect(w.cells.filter((b) => b).length).toBe(9);
    }
  });
  test("refusals say why in plain words", () => {
    const w = bare({ "2,2": "ore" }, { water: ["6,2"], trunks: ["7,2"] });
    expect(refusal(w, "belt", -1, 2, 99)).toBe("That is off the map");
    expect(refusal(w, "belt", 6, 2, 99)).toBe("Nothing can be built on the stream");
    expect(refusal(w, "belt", 7, 2, 99)).toBe("Nothing can be built on a tree");
    expect(refusal(w, "belt", 12, 6, 99)).toBe("The depot stands here");
    expect(refusal(w, "depot", 3, 3, 99)).toBe("There is only one depot");
    expect(refusal(w, "gatherer", 3, 3, 99)).toBe("A gatherer must be placed on a deposit");
    expect(refusal(w, "gatherer", 2, 2, 9)).toBe("Not enough Coins");
    expect(refusal(w, "gatherer", 2, 2, 10)).toBeNull();
    put(w, "pylon", 4, 4);
    expect(refusal(w, "mill", 4, 4, 99)).toBe("Something is here already");
    expect(build(w, "mill", 4, 4, 0, 99)).toEqual({ ok: false, why: "Something is here already" });
  });
  test("what the story has not opened cannot be built, and says so by name", () => {
    const w = create();
    expect(refusal(w, "bench", 20, 20, 999)).toBe("The bench is not unlocked yet");
    expect(refusal(w, "wheel", 20, 20, 999)).toBe("The waterwheel is not unlocked yet");
    expect(refusal(w, "mill", 20, 20, 999)).toBeNull();
    expect(refusal(create({ story: 2 }), "bench", 20, 20, 999)).toBeNull();
  });
  test("a thing laid over another of its kind only turns it, and costs nothing", () => {
    const w = bare();
    put(w, "belt", 2, 2, 0);
    put(w, "mill", 3, 2, 0);
    expect(build(w, "belt", 2, 2, 1, 0)).toEqual({ ok: true, cost: 0 });
    expect(on(w, 2, 2).dir).toBe(1);
    expect(build(w, "mill", 3, 2, 3, 0)).toEqual({ ok: true, cost: 0 });
    expect(on(w, 3, 2).dir).toBe(3);
    expect(turn(w, 3, 2, 2)).toBe(true);
    expect(on(w, 3, 2).dir).toBe(2);
    expect(turn(w, 12, 6, 2)).toBe(false);
    put(w, "tunnel", 2, 4, 0);
    expect(turn(w, 2, 4, 1)).toBe(false);
    expect(build(w, "tunnel", 2, 4, 1, 99).ok).toBe(false);
  });
  test("a splitter or a joiner set down on a belt takes its place for the difference, and what the belt carried rides on", () => {
    const w = bare();
    const more = KIND.splitter.cost - KIND.belt.cost;
    put(w, "belt", 2, 2, 0);
    Object.assign(on(w, 2, 2), { item: "ore", prog: 0.5 });
    expect(refusal(w, "splitter", 2, 2, more - 1)).toBe("Not enough Coins");
    expect(build(w, "splitter", 2, 2, 0, more)).toEqual({ ok: true, cost: more });
    expect(on(w, 2, 2)).toMatchObject({ kind: "splitter", item: "ore", prog: 0.5 });
    expect(build(w, "joiner", 2, 2, 1, 0)).toEqual({ ok: true, cost: KIND.joiner.cost - KIND.splitter.cost });
    expect(on(w, 2, 2)).toMatchObject({ kind: "joiner", dir: 1, item: "ore" });
    // A belt is not set down on these, and nothing is set down on a machine.
    expect(refusal(w, "belt", 2, 2, 99)).toBe("Something is here already");
    put(w, "mill", 4, 2);
    expect(refusal(w, "splitter", 4, 2, 99)).toBe("Something is here already");
    expect(on(w, 4, 2).kind).toBe("mill");
  });
  test("a piece set in another's place sends that one back as if it were taken away", () => {
    const w = bare();
    // A splitter to hand, on a belt that was paid for: the belt's Coins come back.
    put(w, "belt", 2, 2, 0);
    w.spare.splitter = 1;
    expect(build(w, "splitter", 2, 2, 0, 0)).toEqual({ ok: true, cost: -KIND.belt.cost });
    expect(on(w, 2, 2).free).toBe(true);
    // A joiner paid for, on a belt that was to hand: the belt goes back to hand.
    w.spare.belt = 1;
    put(w, "belt", 5, 2, 0);
    expect(w.spare.belt).toBe(0);
    expect(build(w, "joiner", 5, 2, 0, KIND.joiner.cost)).toEqual({ ok: true, cost: KIND.joiner.cost });
    expect(w.spare.belt).toBe(1);
  });
});

/** The colours along a row, from one tile to another, as digits. */
const row = (w: World, x0: number, x1: number, y: number): string =>
  Array.from({ length: x1 - x0 + 1 }, (_, k) => on(w, x0 + k, y).tint).join("");

describe("colour", () => {
  test("a line is coloured both ways, as far as a splitter, a joiner, a machine and the depot", () => {
    const w = bare();
    belts(w, 1, 2, 3, 2);
    put(w, "splitter", 4, 2);
    belts(w, 5, 2, 7, 2);
    put(w, "joiner", 8, 2);
    belts(w, 9, 2, 11, 2);
    put(w, "mill", 12, 2);
    belts(w, 13, 2, 15, 2);
    expect(paint(w, 6, 2, 3)).toBe(true);
    expect(row(w, 1, 15, 2)).toBe("000033300000000");
    // A splitter and a joiner are each coloured by themselves.
    paint(w, 4, 2, 1);
    paint(w, 8, 2, 2);
    paint(w, 10, 2, 4);
    paint(w, 14, 2, 5);
    expect(row(w, 1, 15, 2)).toBe("000133324440555");
    // Round a bend and into the depot, from the middle of the line.
    belts(w, 4, 9, 4, 7);
    put(w, "belt", 4, 6, 0);
    belts(w, 5, 6, 10, 6);
    paint(w, 4, 8, 6);
    expect(lineOf(w, at(w, 4, 8))).toHaveLength(10);
    expect(`${on(w, 4, 9).tint}${on(w, 4, 7).tint}${row(w, 4, 11, 6)}`).toBe("6666666660");
    // A belt that joins the side of a line is a line of its own.
    put(w, "belt", 7, 7, 3);
    paint(w, 7, 7, 2);
    expect(row(w, 4, 10, 6)).toBe("6666666");
    paint(w, 7, 6, 1);
    expect(on(w, 7, 7).tint).toBe(2);
    // "None" takes the colour off the same way.
    paint(w, 10, 6, 0);
    expect(row(w, 4, 10, 6)).toBe("0000000");
    expect(on(w, 4, 9).tint).toBe(0);
  });
  test("a line goes through a tunnel, and round a loop it ends", () => {
    const w = bare();
    put(w, "belt", 1, 2);
    put(w, "tunnel", 2, 2, 0, 2);
    belts(w, 6, 2, 7, 2);
    put(w, "belt", 3, 2, 1);
    paint(w, 7, 2, 4);
    expect([1, 2, 3, 5, 6, 7].map((x) => on(w, x, 2).tint)).toEqual([4, 4, 0, 4, 4, 4]);
    put(w, "belt", 1, 8, 0);
    put(w, "belt", 2, 8, 1);
    put(w, "belt", 2, 9, 2);
    put(w, "belt", 1, 9, 3);
    expect(paint(w, 2, 9, 6)).toBe(true);
    expect(lineOf(w, at(w, 1, 8)).toSorted((a, b) => a - b)).toEqual([
      at(w, 1, 8),
      at(w, 2, 8),
      at(w, 1, 9),
      at(w, 2, 9),
    ]);
    expect(row(w, 1, 2, 8) + row(w, 1, 2, 9)).toBe("6666");
  });
  test("nothing is coloured on bare ground, on a machine, on the depot or off the map", () => {
    const w = bare();
    put(w, "mill", 3, 3);
    expect([paint(w, 1, 1, 2), paint(w, 3, 3, 2), paint(w, 12, 6, 2), paint(w, -1, 0, 2)]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(on(w, 3, 3).tint).toBe(0);
  });
  test("a belt built, and a run laid, take the colour of the line they join", () => {
    const w = bare();
    belts(w, 2, 2, 4, 2);
    paint(w, 2, 2, 2);
    // From the end of the line, and into its start.
    put(w, "belt", 5, 2);
    put(w, "belt", 1, 2);
    expect(row(w, 1, 5, 2)).toBe("22222");
    // Beside it, into its side, and far from it: none.
    put(w, "belt", 3, 3);
    put(w, "belt", 3, 1, 1);
    put(w, "belt", 20, 10);
    expect([on(w, 3, 3).tint, on(w, 3, 1).tint, on(w, 20, 10).tint]).toEqual([0, 0, 0]);
    // A tunnel dug from the end of the line, both mouths.
    put(w, "tunnel", 6, 2, 0, 1);
    expect([on(w, 6, 2).tint, on(w, 8, 2).tint]).toEqual([2, 2]);
    // A run between two lines takes the colour of the one that feeds it.
    belts(w, 1, 9, 3, 9);
    paint(w, 1, 9, 5);
    belts(w, 8, 9, 10, 9);
    paint(w, 8, 9, 6);
    expect(stand(w, route(w, [4, 9], [7, 9]) ?? [], Infinity, true).ok).toBe(true);
    expect(row(w, 1, 10, 9)).toBe("5555555666");
    // A run into the start of a line, with nothing coloured feeding it, takes that line's.
    belts(w, 18, 3, 20, 3);
    paint(w, 18, 3, 4);
    expect(stand(w, route(w, [15, 3], [17, 3]) ?? [], Infinity, true).ok).toBe(true);
    expect(row(w, 15, 20, 3)).toBe("444444");
    // A run from a belt turned to meet it takes that belt's colour.
    put(w, "belt", 16, 9, 0);
    paint(w, 16, 9, 3);
    const down = [10, 11].map((y) => ({ kind: "belt", x: 16, y, dir: 1, span: 0 }) as const);
    expect(stand(w, down, Infinity, true, { x: 16, y: 9, dir: 1 }).ok).toBe(true);
    expect([on(w, 16, 10).tint, on(w, 16, 11).tint]).toEqual([3, 3]);
  });
  test("a splitter or a joiner set down on a coloured belt keeps its colour", () => {
    const w = bare();
    belts(w, 2, 2, 4, 2);
    paint(w, 2, 2, 5);
    put(w, "splitter", 3, 2);
    expect(on(w, 3, 2)).toMatchObject({ kind: "splitter", tint: 5 });
    put(w, "joiner", 3, 2);
    expect(on(w, 3, 2)).toMatchObject({ kind: "joiner", tint: 5 });
  });
});

describe("Coins", () => {
  test("the yard keeps no purse: it is told the balance, and says what it took", () => {
    const w = create();
    expect(Object.keys(w)).not.toContain("coins");
    // A new yard has no Coins of its own to hand over.
    expect(collect(w)).toBe(0);
    let purse = 25;
    const did = build(w, "pylon", 20, 15, 0, purse);
    if (did.ok) purse -= did.cost;
    expect(purse).toBe(25 - KIND.pylon.cost);
    expect(build(w, "pylon", 21, 15, 0, 3)).toEqual({ ok: false, why: "Not enough Coins" });
    expect(w.cells[at(w, 21, 15)]).toBeNull();
  });
  test("a new yard has a gatherer, a mill and a dozen belts to hand, which cost nothing to stand", () => {
    const w = create();
    expect(w.spare).toEqual(STARTERS);
    expect([costOf(w, "gatherer"), costOf(w, "mill"), costOf(w, "belt")]).toEqual([0, 0, 0]);
    expect(costOf(w, "pylon")).toBe(KIND.pylon.cost);
    // The first line goes up from an empty purse.
    expect(build(w, "gatherer", 20, 15, 0, 0)).toEqual({ ok: true, cost: 0 });
    expect(build(w, "mill", 21, 15, 0, 0)).toEqual({ ok: true, cost: 0 });
    const legs = route(w, [22, 15], [23, 17]);
    if (!legs) throw new Error("no way");
    expect(priceOf(w, legs)).toBe(0);
    expect(stand(w, legs, 0)).toEqual({ ok: true, cost: 0 });
    steps(w, 400);
    expect(w.depot.plank ?? 0).toBeGreaterThan(12);
    expect(w.story).toBe(1);
    // The second of each is paid for.
    expect(costOf(w, "gatherer")).toBe(KIND.gatherer.cost);
    expect(build(w, "gatherer", 19, 16, 0, 0)).toEqual({ ok: false, why: "Not enough Coins" });
    expect(build(w, "gatherer", 19, 16, 0, 10)).toEqual({ ok: true, cost: KIND.gatherer.cost });
  });
  test("a piece that was to hand gives nothing back, and can be stood again for nothing", () => {
    const w = create();
    build(w, "gatherer", 20, 15, 0, 0);
    build(w, "gatherer", 19, 16, 0, 10);
    expect(on(w, 20, 15).free).toBe(true);
    expect(on(w, 19, 16).free).toBe(false);
    expect(remove(w, 19, 16)).toEqual({ ok: true, refund: KIND.gatherer.cost });
    expect(remove(w, 20, 15)).toEqual({ ok: true, refund: 0 });
    expect(w.spare.gatherer).toBe(1);
    expect(build(w, "gatherer", 19, 15, 0, 0)).toEqual({ ok: true, cost: 0 });
    // Moving the whole first line about never costs a Coin, however often it is done.
    for (let k = 0; k < 20; k++) {
      expect(build(w, "belt", 22 + (k % 3), 20, 0, 0)).toEqual({ ok: true, cost: 0 });
      expect(remove(w, 22 + (k % 3), 20)).toEqual({ ok: true, refund: 0 });
    }
    // Belts beyond the dozen are paid for, and a run says what it will come to.
    const legs = route(w, [17, 21], [31, 21]);
    if (!legs) throw new Error("no way");
    expect(legs.length).toBe(15);
    expect(priceOf(w, legs)).toBe(3 * KIND.belt.cost);
    expect(stand(w, legs, 2)).toEqual({ ok: false, why: "Not enough Coins: 1 short" });
    expect(stand(w, legs, 3)).toEqual({ ok: true, cost: 3 });
    expect(w.spare.belt).toBe(0);
  });
  test("a tunnel may not pass under the depot, and the router goes round", () => {
    const w = bare();
    // The depot stands on (11..13, 5..7).
    expect(refusal(w, "tunnel", 10, 6, 99, 0)).toBe("A tunnel cannot go under the depot");
    expect(tunnelExit(w, 10, 6, 0)).toBeNull();
    expect(tunnelExit(w, 9, 6, 0, 3)).toBeNull();
    expect(build(w, "tunnel", 12, 3, 1, 99)).toEqual({ ok: false, why: "A tunnel cannot go under the depot" });
    // Beside the depot is another matter, and so is stopping short of it.
    expect(refusal(w, "tunnel", 10, 4, 99, 0)).toBeNull();
    expect(tunnelExit(w, 8, 6, 0)).toEqual({ x: 10, y: 6, span: 1 });
    put(w, "pylon", 10, 6);
    expect(refusal(w, "tunnel", 8, 6, 99, 0)).toBe("A tunnel cannot go under the depot");
    // A run from one side of the depot to clear ground on the other goes round it, not under.
    const walled = bare();
    for (let x = 0; x < 24; x++) if (x < 11 || x > 13) put(walled, "pylon", x, 2);
    const legs = route(walled, [12, 1], [12, 9]);
    for (const leg of legs ?? [])
      if (leg.kind === "tunnel")
        for (let s = 1; s <= leg.span; s++)
          expect(walled.cells[at(walled, leg.x + DX[leg.dir] * s, leg.y + DY[leg.dir] * s)]?.kind).not.toBe("depot");
    if (legs) expect(stand(walled, legs, 999).ok).toBe(true);
  });
  test("tipping a machine out empties what it holds, and frees one that filled up with the wrong part", () => {
    const w = lit(bare());
    const bench = put(w, "bench", 8, 5, 0);
    put(w, "belt", 7, 5, 0);
    for (let k = 0; k < 4; k++) hold(bench, "plank");
    // The belt in is waiting with a fifth plank, and the ingot behind it cannot get through.
    Object.assign(on(w, 7, 5), { item: "plank", prog: 1 });
    steps(w, 10);
    expect(on(w, 7, 5).item).toBe("plank");
    expect(tipOut(w, 8, 5, "ingot")).toBe(0);
    expect(tipOut(w, 8, 5, "plank")).toBe(4);
    expect(bench.count).toBe(0);
    steps(w, 2);
    expect(on(w, 7, 5).item).toBeNull();
    expect(bench.buf.plank).toBe(1);
    expect(tipOut(w, 8, 5)).toBe(1);
    expect(tipOut(w, 1, 1)).toBe(0);
  });
  test("what the yard earns gathers in the till, in whole Coins when it is handed over", () => {
    const w = bare({ "9,6": "ore" });
    put(w, "gatherer", 9, 6);
    put(w, "belt", 10, 6);
    // Ore is worth a tenth of a Coin to an order, and the depot pays a hundredth of that.
    while ((w.depot.ore ?? 0) < 600) steps(w, 1);
    expect(w.till).toBeCloseTo(0.6, 6);
    expect(collect(w)).toBe(0);
    while ((w.depot.ore ?? 0) < 1200) steps(w, 1);
    expect(collect(w)).toBe(1);
    expect(w.till).toBeCloseTo(0.2, 6);
    expect(w.sold).toBeCloseTo(1.2, 6);
  });
});

describe("plots", () => {
  test("nothing is built on land the yard does not own, and the plot says whose turn it is", () => {
    const w = create({ story: 6 });
    expect(plotAt(w, 10, 20)).toEqual({ id: "bank", owned: false });
    expect(refusal(w, "belt", 10, 20, 999)).toBe("The Clay Bank is not the yard's yet");
    expect(buyPlot(w, "bank", price("bank"))).toEqual({ ok: true, cost: price("bank") });
    expect(plotAt(w, 10, 20)).toEqual({ id: "bank", owned: true });
    expect(refusal(w, "belt", 10, 20, 999)).toBeNull();
    expect(refusal(w, "gatherer", 10, 20, 999)).toBeNull();
    expect(plotAt(w, 99, 0)).toBeNull();
  });
  test("a plot is for sale once the story opens it, if it touches the yard's land and the Coins are there", () => {
    const early = create({ story: 4 });
    expect(plotState(early, "yard")).toEqual({ state: "owned", why: null });
    expect(plotRefusal(early, "yard", 0)).toBe("You already own that plot");
    expect(plotRefusal(early, "meadow", 99999)).toBe("Long Meadow is not for sale yet");
    const w = create({ story: STORY_DONE });
    expect(plotState(w, "meadow").state).toBe("for sale");
    expect(plotRefusal(w, "meadow", price("meadow") - 1)).toBe("Not enough Coins");
    // A corner plot touches the yard only through a plot beside it.
    expect(plotRefusal(w, "seam", 99999)).toBe("The Far Seam does not touch the yard's land yet");
    expect(buyPlot(w, "seam", 99999)).toEqual({ ok: false, why: "The Far Seam does not touch the yard's land yet" });
    expect(buyPlot(w, "stream", 99999).ok).toBe(true);
    expect(buyPlot(w, "seam", 99999)).toEqual({ ok: true, cost: price("seam") });
    expect(buyPlot(w, "seam", 99999)).toEqual({ ok: false, why: "You already own that plot" });
    expect(w.plots).toEqual(["yard", "stream", "seam"]);
  });
  const STORY_DONE = 20;
});

describe("plans", () => {
  test("a plan is for sale once the story opens it and the plan before it is owned", () => {
    const w = create({ story: 3 });
    expect(planRefusal(w, "rakes", 99999)).toBe("Sharper rakes unlocks when you fill order 4: Gears and frames");
    const later = create({ story: 20 });
    expect(planState(later, "rakes").state).toBe("for sale");
    expect(planRefusal(later, "rakes", price("rakes") - 1)).toBe("Not enough Coins");
    expect(planRefusal(later, "barrows", 99999)).toBe("Wheelbarrows needs Sharper rakes first");
    expect(buyPlan(later, "rakes", price("rakes"))).toEqual({ ok: true, cost: price("rakes") });
    expect(buyPlan(later, "rakes", 99999)).toEqual({ ok: false, why: "You already have that plan" });
    expect(buyPlan(later, "barrows", 99999)).toEqual({ ok: true, cost: price("barrows") });
  });
  test("sharper rakes and wheelbarrows quicken the gatherers", () => {
    const plain = gathered([]);
    expect(Math.abs(plain - 6000 / TICKS.gather)).toBeLessThanOrEqual(3);
    expect(gathered(["rakes"]) / plain).toBeCloseTo(1.5, 2);
    expect(gathered(["rakes", "barrows"]) / plain).toBeCloseTo(2, 2);
  });
  test("waxed belts and roller belts carry things quicker", () => {
    expect(carried([])).toBe(6);
    expect(carried(["waxed"])).toBe(9);
    expect(carried(["waxed", "rollers"])).toBe(12);
  });
  test("the second and third machine tiers quicken mills, benches and workshops", () => {
    const plain = milled([]);
    expect(Math.abs(plain - 1000)).toBeLessThanOrEqual(5);
    expect(milled(["tooling"]) / plain).toBeCloseTo(1.5, 2);
    expect(milled(["tooling", "jigs"]) / plain).toBeCloseTo(2, 2);
  });
  test("taller pylons reach further, and join pylons further off", () => {
    const w = create({ story: 20 });
    put(w, "pylon", 30, 14);
    const reached = (): Uint8Array => w.power ?? repower(w);
    const before = reached().reduce((n, p) => n + p, 0);
    expect(reached()[at(w, 30, 14 - 6)]).toBe(0);
    buyPlan(w, "tallpylons", Infinity);
    expect(reached().reduce((n, p) => n + p, 0)).toBeGreaterThan(before);
    expect(reached()[at(w, 30, 14 - 6)]).toBe(1);
    expect(REACH.pylon * w.rates.reach).toBeGreaterThan(6);
  });
  test("bigger crates hold more, and a bigger flywheel gives more power", () => {
    const w = create({ story: 20 });
    expect(w.rates.crate).toBe(CRATE);
    expect(power(w).supply).toBe(20);
    buyPlan(w, "bigcrates", Infinity);
    buyPlan(w, "flywheel", Infinity);
    expect(w.rates.crate).toBe(4 * CRATE);
    expect(power(w).supply).toBe(40);
  });
  test("the boiler, the workshop and the tunnel are opened by their plans", () => {
    const w = lit(create({ story: 20 }));
    for (const kind of ["boiler", "workshop", "tunnel"] as const) {
      expect(refusal(w, kind, 20, 20, 9999)).toBe(`The ${kind} is not unlocked yet`);
      buyPlan(w, kind, Infinity);
      expect(refusal(w, kind, 20, 20, 9999)).toBeNull();
    }
  });
  test("a fourth hook hangs a fourth standing order", () => {
    const w = create({ story: 20 });
    expect(w.board.length).toBe(3);
    buyPlan(w, "fourth", Infinity);
    expect(w.board.length).toBe(4);
  });
});
