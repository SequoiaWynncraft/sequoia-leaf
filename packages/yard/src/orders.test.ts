import { describe, expect, test } from "bun:test";

import { buyPlan, buyPlot } from "./build.ts";
import { ASKS } from "./content/asks.ts";
import { ITEM, type Item, ITEMS } from "./content/items.ts";
import { workOf } from "./content/recipes.ts";
import { STORY } from "./content/story.ts";
import { create } from "./create.ts";
import { put, steps } from "./fixtures.ts";
import {
  askable,
  claim,
  deliver,
  DEPOT_SHARE,
  fresh,
  isFilled,
  makeable,
  reask,
  storyOrder,
  swap,
  SWAP_EVERY,
  swapRefusal,
  townGifts,
} from "./orders.ts";
import { load, save } from "./save.ts";
import { collect, drain, type World } from "./world.ts";

const asked = (w: World): Item[][] => w.board.map((o) => ITEMS.filter((k) => (o.want[k] ?? 0) > 0));

describe("the story", () => {
  test("filling an order pays, opens what it promised and brings the next", () => {
    const w = create();
    collect(w);
    // A belt into the depot, with planks set on it one at a time.
    const belt = put(w, "belt", 22, 18, 0);
    for (let k = 0; k < 12; k++) {
      Object.assign(belt, { item: "plank", prog: 1 });
      steps(w, 1);
    }
    expect(w.story).toBe(1);
    expect(w.till).toBeCloseTo(12 * ITEM.plank.worth * DEPOT_SHARE + (STORY[0]?.pay ?? 0), 6);
    expect(drain(w)).toEqual([{ kind: "story", index: 0, title: "Planks for the Treasury", pay: 80 }]);
    expect(w.open.kinds.has("bench")).toBe(false);
    for (const item of ["ingot", "brick"] as const)
      for (let k = 0; k < 12; k++) {
        Object.assign(belt, { item, prog: 1 });
        steps(w, 1);
      }
    expect(w.story).toBe(2);
    expect(w.open.kinds.has("bench")).toBe(true);
    expect(storyOrder(w)?.title).toBe("Tools for the raid parties");
    expect(w.given).toEqual({ plank: 12, ingot: 12, brick: 12 });
  });
  test("what an order does not want is only sold, and more than it wants goes no further", () => {
    const w = create();
    deliver(w, "ore", 5);
    deliver(w, "plank", 11);
    expect(w.filled).toEqual({ plank: 11 });
    expect(w.story).toBe(0);
    // Three more planks: one finishes the order, and the next order has no use for the other two.
    deliver(w, "plank", 3);
    expect(w.story).toBe(1);
    expect(w.filled).toEqual({});
    expect(w.depot).toEqual({ ore: 5, plank: 14 });
    expect(w.given).toEqual({ plank: 12 });
  });
  test("orders open machines, plots, plans and the board as they go, and the last leaves the story done", () => {
    const w = create();
    expect(w.open.board).toBe(false);
    expect(w.board).toEqual([]);
    STORY.forEach((order, n) => {
      expect(w.story).toBe(n);
      for (const item of ITEMS) deliver(w, item, order.want[item] ?? 0);
      for (const k of order.opens.kinds ?? []) expect(w.open.kinds.has(k)).toBe(true);
      for (const p of order.opens.plots ?? []) expect(w.open.plots.has(p)).toBe(true);
      for (const p of order.opens.plans ?? []) expect(w.open.plans.has(p)).toBe(true);
    });
    expect(w.story).toBe(STORY.length);
    expect(storyOrder(w)).toBeNull();
    expect(w.paid).toBe(STORY.reduce((sum, o) => sum + o.pay, 0));
    deliver(w, "crab", 3);
    expect(w.story).toBe(STORY.length);
  });
  test("what finished orders have left in the town is there to be read", () => {
    const w = create({ story: 11 });
    expect(townGifts(w).map((g) => g.id)).toEqual(["banner-pole", "tree-lanterns"]);
    expect(townGifts(w)[1]).toEqual({
      id: "tree-lanterns",
      title: "Lanterns for the great tree",
      line: "Lanterns from the Works hang in the great tree.",
    });
    expect(townGifts(create())).toEqual([]);
  });
});

describe("the board", () => {
  test("goes up with three orders once the story is under way", () => {
    const w = create({ story: 3 });
    expect(w.board).toEqual([]);
    for (const item of ITEMS) deliver(w, item, STORY[3]?.want[item] ?? 0);
    expect(w.story).toBe(4);
    expect(w.board.length).toBe(3);
    expect(w.board.map((o) => o.id)).toEqual([0, 1, 2]);
  });
  test("asks for one or two things the yard can make and has met, in numbers and for a payout sized to the work", () => {
    for (const story of [4, 8, 12, 16, 20])
      for (let seed = 1; seed <= 40; seed++) {
        const w = create({ seed, story });
        if (story >= 12) for (const id of ["bank", "stream", "grove"] as const) buyPlot(w, id, Infinity);
        if (story >= 12) buyPlan(w, "workshop", Infinity);
        const can = askable(w);
        const budget = 6000 + 600 * story;
        for (let k = 0; k < 6; k++) {
          const o = fresh(w, seed);
          const items = ITEMS.filter((item) => (o.want[item] ?? 0) > 0);
          expect(items.length === 1 || items.length === 2).toBe(true);
          for (const item of items) expect(can).toContain(item);
          const worth = items.reduce((sum, item) => sum + (o.want[item] ?? 0) * ITEM[item].worth, 0);
          // What its goods are worth, give or take a tenth, a little more for two things, to the nearest five.
          expect(o.pay).toBeGreaterThanOrEqual(worth * 0.9 - 3);
          expect(o.pay).toBeLessThanOrEqual(worth * 1.1 * 1.15 + 3);
          // The work in it is near the yard's budget for an order at this point in the story.
          const work = items.reduce((sum, item) => sum + (o.want[item] ?? 0) * workOf(item), 0);
          const fewer = items.some((item) => ITEM[item].step === 4 || ITEM[item].step === 0);
          expect(work / budget).toBeGreaterThan(fewer ? 0.2 : 0.7);
          expect(work / budget).toBeLessThan(1.5);
          expect(o.title.length * o.from.length * o.line.length).toBeGreaterThan(0);
        }
      }
  });
  test("asks for the goods that take the whole yard by the dozen, not the hundred", () => {
    const w = create({ seed: 9, story: 20 });
    for (const id of ["bank", "stream", "grove"] as const) buyPlot(w, id, Infinity);
    buyPlan(w, "workshop", Infinity);
    let seen = 0;
    for (let k = 0; k < 300; k++) {
      const o = fresh(w, 9);
      for (const item of ["crab", "beacon"] as const) {
        if (o.want[item] === undefined) continue;
        seen++;
        expect(o.want[item]).toBeLessThanOrEqual(24);
      }
    }
    expect(seen).toBeGreaterThan(20);
  });
  test("asks for nothing the story has not yet given a reason to make", () => {
    // Four orders in, the banner pole could be made but nobody has asked for one.
    const w = create({ story: 4 });
    expect(makeable(w)).toContain("pole");
    expect(askable(w)).toEqual([
      "deadfall",
      "stone",
      "ore",
      "plank",
      "brick",
      "ingot",
      "tool",
      "gear",
      "frame",
      "engine",
    ]);
    expect(askable(create({ story: 5 }))).toContain("pole");
    const late = create({ story: 12 });
    for (const id of ["bank", "stream", "grove"] as const) buyPlot(late, id, Infinity);
    buyPlan(late, "workshop", Infinity);
    expect(makeable(late)).toContain("crab");
    expect(askable(late)).not.toContain("crab");
    expect(askable(late)).not.toContain("beacon");
  });
  test("a new yard is only asked for what its first plot and first machines can make", () => {
    const w = create({ story: 4 });
    expect(makeable(w)).toEqual([
      "deadfall",
      "stone",
      "ore",
      "plank",
      "brick",
      "ingot",
      "tool",
      "gear",
      "frame",
      "engine",
      "pole",
    ]);
    const further = create({ story: 12 });
    for (const id of ["bank", "stream", "grove"] as const) buyPlot(further, id, Infinity);
    buyPlan(further, "workshop", Infinity);
    expect(makeable(further)).toEqual([...ITEMS]);
  });
  test("is the same for the same seed, different for another, and the same again after a save", () => {
    const a = create({ seed: 11, story: 6 });
    const b = create({ seed: 11, story: 6 });
    const c = create({ seed: 12, story: 6 });
    expect(a.board).toEqual(b.board);
    expect(a.board).not.toEqual(c.board);
    const back = load(save(a), a.land);
    expect(back?.board).toEqual(a.board);
    // And the orders that follow are the same whether or not the yard was put away in between.
    expect(back ? [fresh(back, 11), fresh(back, 11)] : []).toEqual([fresh(a, 11), fresh(a, 11)]);
  });
  test("rarely asks twice for the same thing at once", () => {
    let doubled = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const first = asked(create({ seed, story: 8 })).map((items) => items[0]);
      if (new Set(first).size < first.length) doubled++;
    }
    expect(doubled).toBeLessThan(30);
  });
  test("each thing goes to one order only: the story's first, then the board's from the top", () => {
    const w = create({ seed: 3, story: 4 });
    // The story wants engines; make the board want them too.
    const order = w.board[0];
    if (!order) throw new Error("no board");
    w.board[0] = { ...order, want: { engine: 5 }, filled: {} };
    w.board[1] = { ...order, id: 99, want: { engine: 5 }, filled: {} };
    const story = STORY[4]?.want.engine ?? 0;
    deliver(w, "engine", story - 5);
    expect(w.filled).toEqual({ engine: story - 5 });
    expect(w.board[0]?.filled).toEqual({});
    // Nine more: five finish the story's order, and the other four go to the first on the board that wants them.
    deliver(w, "engine", 9);
    expect(w.story).toBe(5);
    expect(w.board[0]?.filled).toEqual({ engine: 4 });
    expect(w.board[1]?.filled).toEqual({});
    deliver(w, "engine", 3);
    expect(w.board[0]?.filled).toEqual({ engine: 5 });
    expect(w.board[1]?.filled).toEqual({ engine: 2 });
  });
  test("a filled order waits to be handed over, however long that takes; handing it over pays and hangs a fresh one", () => {
    const w = create({ seed: 5, story: 6 });
    collect(w);
    const order = w.board[1];
    if (!order) throw new Error("no board");
    expect(claim(w, order.id)).toBeNull();
    for (const item of ITEMS) deliver(w, item, order.want[item] ?? 0);
    expect(isFilled(order.want, order.filled)).toBe(true);
    expect(drain(w).some((n) => n.kind === "filled" && n.id === order.id)).toBe(true);
    const before = w.till;
    steps(w, 100_000);
    expect(w.board[1]).toBe(order);
    expect(w.till).toBe(before);
    expect(claim(w, order.id)).toBe(order.pay);
    expect(w.till).toBe(before + order.pay);
    expect(w.done).toBe(1);
    expect(w.board[1]?.id).toBe(3);
    expect(drain(w)).toEqual([{ kind: "standing", id: order.id, title: order.title, pay: order.pay }]);
    expect(claim(w, order.id)).toBeNull();
    // A yard with no seed (the page's copy) leaves the place empty, for Leaf to hang the next.
    const copy = create({ seed: 5, story: 6 });
    const first = copy.board[0];
    copy.seed = null;
    for (const item of ITEMS) deliver(copy, item, first?.want[item] ?? 0);
    expect(claim(copy, first?.id ?? -1)).toBe(first?.pay ?? -1);
    expect(copy.board.map((o) => o.id)).toEqual([1, 2]);
  });
  test("one order may be swapped for a fresh one, free, every ten minutes of the yard's time", () => {
    const w = create({ seed: 5, story: 6 });
    const was = w.board.map((o) => o.id);
    expect(swapRefusal(w, 0)).toBeNull();
    expect(swap(w, 0)).toBe(true);
    expect(w.board.map((o) => o.id)).toEqual([3, was[1] ?? -1, was[2] ?? -1]);
    expect(swapRefusal(w, 1)).toBe("A fresh order can be had in 10 minutes");
    expect(swap(w, 1)).toBe(false);
    steps(w, SWAP_EVERY - 600);
    expect(swapRefusal(w, 1)).toBe("A fresh order can be had in 1 minute");
    steps(w, 600);
    expect(swap(w, 1)).toBe(true);
    expect(swapRefusal(w, 0)).toBe("There is no such order on the board");
    // A filled one is handed over, not swapped away.
    const order = w.board[2];
    for (const item of ITEMS) deliver(w, item, order?.want[item] ?? 0);
    steps(w, SWAP_EVERY);
    expect(swapRefusal(w, order?.id ?? -1)).toBe("That one is filled and waiting to be handed over");
  });
  test("nothing on the board has a clock on it", () => {
    const w = create({ seed: 5, story: 6 });
    const board = structuredClone(w.board);
    steps(w, 300_000);
    expect(w.board).toEqual(board);
    for (const o of w.board)
      expect(Object.keys(o).toSorted()).toEqual(["filled", "from", "id", "line", "pay", "title", "want"]);
  });
});

/** The made-up members the town once had, who never ask the Works for anything now. */
const NOT_ASKERS = ["Quillfeather", "Fernwhistle", "Wrenly", "Kestrelle", "Hobbleknot", "Dunmere", "Tansy Fen"];
/** Who may ask: places in town, the town's own, and the creatures the guild is fond of. */
const PLACES = /^The (Treasury|campfire|crab pond|market stalls|quest board|raid parties|gate|gnomes|guild|cats|fox)$/;
const TOWNSFOLK = new Set(["Cinfy", "Pipwick", "Embertoe", "Tindra"]);
const CREATURES = ["Worm", "Rock", "Greg", "Glorp", "Moth", /^Crab #\d+$/, "The fox"];
const allowed = (from: string): boolean =>
  PLACES.test(from) ||
  TOWNSFOLK.has(from) ||
  CREATURES.some((c) => (typeof c === "string" ? c === from : c.test(from)));

describe("who asks the Works for things", () => {
  test("every order, story or standing, comes from a place, one of the town's own, or a creature", () => {
    const askers = [...STORY.map((o) => o.from), ...Object.values(ASKS).flatMap((l) => l.map((a) => a.from))];
    for (const from of askers) {
      expect(allowed(from)).toBe(true);
      expect(NOT_ASKERS).not.toContain(from);
    }
  });

  test("an order kept from one who no longer asks is asked again for the same things; others come back as they were", () => {
    const old = {
      id: 7,
      title: "Glass for Quillfeather",
      from: "Quillfeather",
      line: "Jars.",
      want: { glass: 40 },
      pay: 90,
      filled: { glass: 3 },
    };
    const again = reask(old);
    expect(allowed(again.from)).toBe(true);
    expect(again.title).toBe(`Glass for ${again.from.replace(/^The /, "the ")}`);
    expect({ ...again, title: "", from: "", line: "" }).toEqual({ ...old, title: "", from: "", line: "" });
    const today = { ...old, title: "Glass for the market stalls", from: "The market stalls" };
    expect(reask(today)).toBe(today);
  });
});
