/**
 * A card is kept by everything it prints. Its print is what it shows of the yard and the purse, as
 * plain values; the card that is up is drawn again when that differs, and the module that draws a
 * card from its print reaches no yard. So a value that changes alone (a machine's rate as power runs
 * short, the Coins a plot still needs) changes what the card is kept by.
 */
import { describe, expect, test } from "bun:test";

import {
  ALL_GOALS,
  ALL_ITEMS,
  ALL_KINDS,
  at,
  BELT,
  BENCH,
  build,
  create,
  DEPOT,
  GATHERER,
  goal,
  isGraded,
  item,
  litOf,
  MILL,
  play,
  plot,
  power,
  refusal,
  setFirst,
  setRecipe,
  setSort,
  setWay,
  SORTER,
  SPLITTER,
  START,
  STOP,
  STUDY,
  study,
  SWAP_EVERY,
  TOOLS,
  unlocked,
  unlockedBy,
  upgradePrice,
  type Yard,
} from "@sequoia-leaf/factory";
import { fromLeaf } from "@sequoia-leaf/kit/purse.ts";

import { draws, S } from "../state.ts";
import { cardKey, itemRef, machineRef, nodeRef, orderRef, plotRef, tileRef } from "./card.ts";
import { printOf } from "./prints.ts";
import { giftRef, tierRef, toolRef, unlockRef } from "./refs.ts";

/** How many words Leaf has said on the purse in these tests: each newer than the last. */
let words = 0;
/** Leaf says the member's Coins are now `coins`. */
const coinsAre = (coins: number): boolean => fromLeaf({ coins, leaf: 0, version: ++words });

/** A bench told to make tools, waiting for its planks and ingots, and `others` more benches drawing power near the depot. */
function benches(others: number): Yard {
  const y = create({ seed: 5, tier: 2 });
  build(y, BENCH, 20, 15, 0, Infinity);
  setRecipe(y, 20, 15, item("tool"));
  for (let k = 0; k < others; k++) build(y, BENCH, 18 + (k % 6) * 2, 21 + Math.floor(k / 6) * 2, 0, Infinity);
  return y;
}

describe("a card", () => {
  test("of a machine is kept by what it makes a minute: power run short changes it, though nothing else on the card does", () => {
    const ref = tileRef(at(S.world, 20, 15));
    const enough = benches(0);
    const short = benches(8);
    expect([power(enough).pace, power(short).pace < 1]).toEqual([1, true]);
    S.world = enough;
    const before = printOf(ref);
    const key = cardKey(ref);
    // The same count of changes: only power, which the card does not name, differs.
    S.world = short;
    const after = printOf(ref);
    expect(before).toMatchObject({ line: "Waiting for planks and ingots to make tools.", perMinute: "30 /min" });
    expect(after).toMatchObject({ line: "Waiting for planks and ingots to make tools.", perMinute: "21 /min" });
    expect(cardKey(ref)).not.toBe(key);
  });

  test("of a splitter prints each way shut and the way it puts first, and changes when another is put first", () => {
    S.world = create({ seed: 5, tier: 5 });
    build(S.world, SPLITTER, 20, 15, 0, Infinity);
    setWay(S.world, 20, 15, 2, false);
    const ref = tileRef(at(S.world, 20, 15));
    expect(printOf(ref)).toMatchObject({ ways: { shut: [false, false, true], first: -1 } });
    const key = cardKey(ref);
    expect(setFirst(S.world, 20, 15, 1)).toBeNull();
    expect(printOf(ref)).toMatchObject({ ways: { first: 1 } });
    expect(cardKey(ref)).not.toBe(key);
  });

  test("of the depot is whole: the page draws the depot, though nobody builds one, so its card is not a later kind's", () => {
    S.world = create({ seed: 5, tier: 1 });
    expect(draws(DEPOT)).toBe(true);
    expect(printOf(machineRef(DEPOT))).toMatchObject({ card: "machine", later: false, gives: S.world.open.depot });
    const [x, z] = S.world.land.depot;
    expect(printOf(tileRef(at(S.world, x, z)))).toMatchObject({ machine: { later: false } });
  });

  test("of a plot is kept by exactly how many Coins it still needs", () => {
    S.world = create({ seed: 5, tier: 3 });
    const ref = plotRef(plot("meadow"));
    coinsAre(280);
    const key = cardKey(ref);
    expect(printOf(ref)).toMatchObject({ state: "for sale", price: 300, short: 20 });
    coinsAre(270);
    expect(printOf(ref)).toMatchObject({ short: 30 });
    expect(cardKey(ref)).not.toBe(key);
    coinsAre(0);
  });

  test("of a side order stays that order's when the one above it is swapped, and is gone once it is swapped", () => {
    const y = create({ seed: 3, tier: 4 });
    S.world = y;
    const [above, pinned] = y.board;
    if (!above || !pinned) throw new Error("no board");
    const ref = orderRef(pinned.id);
    expect(printOf(ref)).toMatchObject({ card: "order", title: pinned.title });
    const swapped = play(y, { do: "swap", order: above.id, tick: y.tick });
    if ("refused" in swapped) throw new Error(swapped.why);
    // The pinned order is now first on the board; its card still shows it.
    expect(y.board[0]?.id).toBe(pinned.id);
    expect(printOf(ref)).toMatchObject({ card: "order", title: pinned.title });
    y.tick += SWAP_EVERY;
    const gone = play(y, { do: "swap", order: pinned.id, tick: y.tick });
    if ("refused" in gone) throw new Error(gone.why);
    expect(printOf(ref)).toBeNull();
  });

  test("of a mill where power does not reach draws its recipe at 0 a minute, short of power, as its line says", () => {
    const y = create({ seed: 5, tier: 2 });
    const lit = litOf(y);
    const dark = y.kind.findIndex(
      (_, i) => lit[i] === 0 && refusal(y, MILL, i % y.land.w, Math.floor(i / y.land.w), Infinity) === null,
    );
    const [x, z] = [dark % y.land.w, Math.floor(dark / y.land.w)];
    build(y, MILL, x, z, 0, Infinity);
    setRecipe(y, x, z, item("plank"));
    S.world = y;
    expect(printOf(tileRef(dark))).toMatchObject({
      line: "No power here. Place a pylon near it.",
      perMinute: "0 /min",
      flow: { out: item("plank"), perMinute: 0, slow: true },
    });
  });

  test("of a gatherer where power does not reach says it gathers 0 a minute", () => {
    const y = create({ seed: 5, tier: 2 });
    const lit = litOf(y);
    const dark = y.kind.findIndex(
      (_, i) => lit[i] === 0 && refusal(y, GATHERER, i % y.land.w, Math.floor(i / y.land.w), Infinity) === null,
    );
    build(y, GATHERER, dark % y.land.w, Math.floor(dark / y.land.w), 0, Infinity);
    S.world = y;
    expect(printOf(tileRef(dark))).toMatchObject({ perMinute: "0 /min" });
  });

  test("prints plain values only, read back as they are: every card of a yard with a piece of each kind it can stand", () => {
    const y = create({ seed: 5, tier: 4 });
    ALL_KINDS.forEach((k, n) => build(y, k, 17 + (n % 7) * 2, 13 + Math.floor(n / 7) * 2, 0, Infinity));
    S.world = y;
    const refs = [
      // Every tile: what stands on it, the stream, a redwood, or nothing.
      ...Array.from({ length: y.kind.length }, (_, i) => tileRef(i)),
      ...ALL_ITEMS.map(itemRef),
      ...ALL_KINDS.map(machineRef),
      ...y.land.plots.map((p) => plotRef(p.plot)),
      ...ALL_GOALS.map(nodeRef),
      orderRef("story"),
      ...y.board.map((o) => orderRef(o.id)),
      // A kind at each grade above the first, and everything a new yard has or a goal unlocks or leaves.
      ...ALL_KINDS.filter(isGraded).flatMap((k) => [machineRef(k, 2), machineRef(k, 3)]),
      ...[...unlocked(START), ...ALL_GOALS.flatMap((g) => unlockedBy(g))].map(unlockRef),
      ...TOOLS.map(toolRef),
      ...[0, 1, 2, 3, 4].map(tierRef),
      ...ALL_GOALS.map(giftRef),
    ];
    let printed = 0;
    for (const ref of refs) {
      const p = printOf(ref);
      if (p === null) continue;
      printed++;
      expect(JSON.parse(JSON.stringify(p))).toEqual(p);
    }
    expect(printed).toBeGreaterThan(100);
  });

  test("is drawn by modules that reach no yard: none imports anything of the page's that holds one", async () => {
    // What draws a card (`cards.ts`, the land's in `land.ts`, a sorter's parts in `sorter.ts` and a splitter's in `splitter.ts`), the lists of a goal on it (`goal.ts`) and the names cards go by (`refs.ts`).
    const drawing: Record<string, string[]> = {
      "./cards.ts": [
        "../art/machines.ts",
        "../sound.ts",
        "./flow.ts",
        "./goal.ts",
        "./land.ts",
        "./parts.ts",
        "./refs.ts",
        "./sorter.ts",
        "./splitter.ts",
      ],
      "./flow.ts": ["./parts.ts", "./refs.ts"],
      "./goal.ts": ["./parts.ts", "./refs.ts"],
      "./land.ts": ["./refs.ts"],
      "./refs.ts": [],
      "./sorter.ts": ["./refs.ts"],
      "./splitter.ts": ["../art/belts.ts", "../art/machines.ts", "./parts.ts"],
    };
    const texts = await Promise.all(
      Object.keys(drawing).map((file) => Bun.file(new URL(file, import.meta.url).pathname).text()),
    );
    Object.entries(drawing).forEach(([file, may], k) => {
      const text = texts[k] ?? "";
      const from = [...text.matchAll(/^import(?! type)[^;]*? from "([^"]+)";/gms)].map((m) => m[1] ?? "");
      expect([file, from.filter((f) => f.startsWith(".")).toSorted((a, b) => a.localeCompare(b))]).toEqual([file, may]);
      expect(text).not.toMatch(/\bS\.|coins\(/);
    });
  });
});

/** A yard of a tier with a belt near the depot, and a bench told to make hampers where the yard may make them, and tools before. */
function counted(tier: number): Yard {
  const y = create({ seed: 5, tier });
  build(y, BENCH, 20, 15, 0, Infinity);
  setRecipe(y, 20, 15, item(tier >= 2 ? "hamper" : "tool"));
  build(y, BELT, 22, 15, 0, Infinity);
  return y;
}

describe("the cards of tiers 2 and 3", () => {
  test("draw a machine's recipe, and count it a minute only from the first recipe that takes more than 1 of a part", () => {
    S.world = counted(1);
    // Tools from a plank and an ingot, one of each: the parts and what it holds, and no numbers a minute.
    expect(printOf(tileRef(at(S.world, 20, 15)))).toMatchObject({
      numbers: [],
      perMinute: "30 /min",
      flow: {
        out: item("tool"),
        perMinute: 30,
        slow: false,
        waiting: true,
        parts: [
          { item: item("plank"), need: 1, have: 0, perMinute: null, by: null },
          { item: item("ingot"), need: 1, have: 0, perMinute: null, by: null },
        ],
      },
    });
    expect(printOf(tileRef(at(S.world, 22, 15)))).toMatchObject({ numbers: [], flow: null, machine: { numbers: [] } });
    for (const k of ALL_KINDS) expect(printOf(machineRef(k))).toMatchObject({ numbers: [], graded: false, grade: 1 });
    S.world = counted(2);
    // What it makes, and what it needs of each part with how many mills that is: from the rules' planner.
    expect(printOf(tileRef(at(S.world, 20, 15)))).toMatchObject({
      numbers: [],
      flow: {
        out: item("hamper"),
        perMinute: 30,
        parts: [
          { item: item("plank"), need: 2, perMinute: 60, by: { kind: MILL, count: 1.2, top: null } },
          { item: item("pot"), need: 1, perMinute: 30, by: { kind: MILL, count: 0.6, top: null } },
        ],
      },
    });
    // What a belt carries a minute is its pace, on the card (`paceOf`), not a sentence too.
    expect(printOf(machineRef(BELT))).toMatchObject({ numbers: [] });
    // Once the yard may build mills higher, each part says how many that is at the highest grade too;
    // and a piece of the second grade counts its own.
    const y = counted(4);
    build(y, BENCH, 20, 17, 0, Infinity, { grade: 2 });
    setRecipe(y, 20, 17, item("hamper"));
    build(y, BELT, 22, 17, 0, Infinity, { grade: 2 });
    build(y, STUDY, 24, 15, 0, Infinity);
    S.world = y;
    expect(printOf(tileRef(at(y, 20, 15)))).toMatchObject({
      flow: {
        perMinute: 30,
        parts: [
          { perMinute: 60, by: { kind: MILL, count: 1.2, top: { grade: 2, count: 0.8 } } },
          { perMinute: 30, by: { kind: MILL, count: 0.6, top: { grade: 2, count: 0.4 } } },
        ],
      },
    });
    expect(printOf(tileRef(at(y, 20, 17)))).toMatchObject({
      flow: {
        perMinute: 45,
        parts: [
          { perMinute: 90, by: { count: 1.8, top: { count: 1.2 } } },
          { perMinute: 45, by: { count: 0.9, top: { count: 0.6 } } },
        ],
      },
    });
    // A belt's and a Study's numbers a minute are their paces, on the card; a sentence only while power is short.
    expect(printOf(tileRef(at(y, 22, 17)))).toMatchObject({ numbers: [] });
    expect(printOf(tileRef(at(y, 24, 15)))).toMatchObject({ numbers: [], flow: null });
  });

  test("name a kind by its grade once the yard may build it higher, and offer to raise a piece for what the rules ask", () => {
    // Tier 2 has no second grade yet: a belt is a belt, with nothing to raise it to.
    S.world = counted(2);
    const belt = tileRef(at(S.world, 22, 15));
    expect(printOf(belt)).toMatchObject({ raise: null, machine: { grade: 1, graded: false } });
    expect(printOf(machineRef(BELT, 2))).toMatchObject({ grade: 2, graded: true, open: false, price: 3, spare: 0 });
    S.world = counted(3);
    // The same price a marked area would be raised for; and the Coins to hand say whether they cover it.
    const cost = upgradePrice(S.world, [at(S.world, 22, 15)]);
    coinsAre(cost - 1);
    const short = cardKey(belt);
    expect(printOf(belt)).toMatchObject({ raise: { to: 2, cost, enough: false }, machine: { grade: 1, graded: true } });
    coinsAre(cost);
    expect(printOf(belt)).toMatchObject({ raise: { to: 2, cost, enough: true } });
    expect(cardKey(belt)).not.toBe(short);
    expect(printOf(machineRef(BELT, 2))).toMatchObject({ grade: 2, open: true, numbers: [] });
    // A bench has one grade until research gives it another: plain "Bench", and nothing to raise.
    expect(printOf(tileRef(at(S.world, 20, 15)))).toMatchObject({ raise: null, machine: { graded: false } });
    coinsAre(0);
  });

  test("of a sorter, a cart stop and a Study print what each is told and how it stands", () => {
    const y = create({ seed: 5, tier: 4 });
    build(y, SORTER, 20, 15, 0, Infinity);
    build(y, STOP, 22, 15, 0, Infinity);
    build(y, STUDY, 24, 15, 0, Infinity);
    S.world = y;
    const sorter = tileRef(at(y, 20, 15));
    const unset = cardKey(sorter);
    expect(printOf(sorter)).toMatchObject({ set: null });
    // It may be told any thing the yard can make: planks among them.
    expect(printOf(sorter)).toMatchObject({ sorts: expect.arrayContaining([item("plank"), item("tool")]) });
    setSort(y, 20, 15, item("plank"));
    expect(printOf(sorter)).toMatchObject({ set: item("plank") });
    expect(cardKey(sorter)).not.toBe(unset);
    // One cart stop may stand, and one does.
    expect(printOf(tileRef(at(y, 22, 15)))).toMatchObject({ machine: { stops: [1, y.open.stops] } });
    expect(printOf(machineRef(STOP))).toMatchObject({ stops: [1, y.open.stops] });
    expect(printOf(tileRef(at(y, 24, 15)))).toMatchObject({ studying: null, research: true });
  });

  test("of a goal print how each thing it waits on stands, and what may be done with research now", () => {
    const y = create({ seed: 5, tier: 3 });
    build(y, STUDY, 20, 15, 0, Infinity);
    S.world = y;
    const [workshop, tooling] = [goal("workshop"), goal("tooling")];
    // Second-tier machines waits on the workshop: it may not be studied, and says how the workshop stands.
    expect(printOf(nodeRef(tooling))).toMatchObject({
      study: null,
      needs: [{ goal: workshop, stands: "not begun" }],
      studied: [0, 0],
    });
    expect(printOf(nodeRef(workshop))).toMatchObject({ study: "in", may: false, needs: [] });
    const before = cardKey(nodeRef(tooling));
    study(y, workshop);
    expect(printOf(nodeRef(workshop))).toMatchObject({ study: "out" });
    expect(printOf(nodeRef(tooling))).toMatchObject({
      needs: [{ goal: workshop, stands: "being studied" }],
      studied: [0, 225],
    });
    expect(printOf(tileRef(at(y, 20, 15)))).toMatchObject({ studying: workshop, research: true });
    // With research's screen the one open, no card offers it: its button would shut the screen.
    S.panel = "research";
    expect([printOf(nodeRef(workshop)), printOf(tileRef(at(y, 20, 15)))]).toMatchObject([
      { research: false },
      { research: false },
    ]);
    S.panel = null;
    // A folio studied changes what the card of the one that waits is kept by.
    const got = y.got[workshop];
    if (!got) throw new Error("nothing is being studied");
    got[item("timber")] = 30;
    expect(printOf(nodeRef(tooling))).toMatchObject({ studied: [30, 225] });
    expect(cardKey(nodeRef(tooling))).not.toBe(before);
    // The commission waits on all the tier's research: each is a thing with how it stands.
    const needs = printOf(nodeRef(goal("lanterns")));
    expect(needs).toMatchObject({ may: false, study: null });
    const stands = needs !== null && "needs" in needs ? needs.needs : [];
    expect(stands.length).toBe(10);
    expect(stands.filter((n) => [goal("oilpress"), workshop, goal("brassfolio")].includes(n.goal))).toEqual([
      { goal: goal("oilpress"), stands: "not begun" },
      { goal: workshop, stands: "being studied" },
      { goal: goal("brassfolio"), stands: "not begun" },
    ]);
  });

  test("of a number, a tool, a tier and what a goal leaves are the rules' own: a number says what it was before", () => {
    S.world = create({ seed: 5, tier: 3 });
    expect(printOf("perk:crate.128")).toMatchObject({
      unlock: { is: "number", of: "crate", to: 128, was: 32, says: "A crate holds 128 items, up from 32." },
    });
    expect(printOf("perk:blueprints.3.400")).toMatchObject({ unlock: { is: "blueprints", count: 3, pieces: 400 } });
    expect(printOf("perk:board")).toMatchObject({ unlock: { is: "board" } });
    expect([printOf("perk:nonsense.3"), printOf("perk:crate"), printOf("tool:axe")]).toEqual([null, null, null]);
    expect(printOf(toolRef("paint"))).toEqual({ card: "tool", tool: "paint" });
    // A tier is spoken of by its name only once it is open.
    expect([printOf(tierRef(3)), printOf(tierRef(4))]).toEqual([
      { card: "tier", tier: 3, open: true },
      { card: "tier", tier: 4, open: false },
    ]);
    expect(printOf(giftRef(goal("hall")))).toEqual({ card: "gift", goal: goal("hall") });
    expect(printOf(giftRef(goal("workshop")))).toBeNull();
  });
});
