import { describe, expect, test } from "bun:test";

import type { CoinChange, Ctx, Done, Refused } from "@sequoia-leaf/core";

import { refusal } from "./build.ts";
import { forward, TICK_MS } from "./clock.ts";
import { ITEMS } from "./content/items.ts";
import { STAND_MOST } from "./content/machines.ts";
import { PLANS } from "./content/plans.ts";
import { PLOTS } from "./content/plots.ts";
import { STORY } from "./content/story.ts";
import { create } from "./create.ts";
import { steps, workingYard } from "./fixtures.ts";
import {
  clockOf,
  EXACT_MOST,
  LEAD,
  play,
  readCommand,
  REFUSED,
  stepTo,
  WORKS,
  type WorksAct,
  type WorksCommand,
  type WorksNote,
} from "./game.ts";
import { deliver, storyOrder } from "./orders.ts";
import { route } from "./route.ts";
import { save } from "./save.ts";
import { WORKS_STATS } from "./stats.ts";
import { at, put as add, type Standing, type World } from "./world.ts";
import large from "./yards/large.json";
import mid from "./yards/mid.json";
import short from "./yards/short.json";
import small from "./yards/small.json";

const T0 = 1_800_000_000_000;
const SECOND = 1000;
const HOUR = 3600 * SECOND;
const ctx = (now: number, seed = 7): Ctx => ({ now, player: { id: "p", guest: false }, seed, room: 0, awards: [] });
const YARDS = { small, short, mid, large } as const;

/** A yard as Leaf would keep it, standing at `T0`. */
function kept(w: World): World {
  w.at = T0;
  return w;
}
function decoded(text: string): World {
  const w = WORKS.decode(text);
  if (!w) throw new Error("the yard does not read");
  return w;
}
/** A command done, or the test fails. */
function did(w: World, c: WorksCommand): Done<World, WorksNote> {
  const answer = play(w, c);
  if ("refused" in answer) throw new Error(`${c.do} was refused: ${answer.why}`);
  return answer;
}
const refused = (answer: Done<World, WorksNote> | Refused): string | null =>
  "refused" in answer ? answer.refused : null;
/** The first `n` tiles a belt could stand on, in tile order. */
function clear(w: World, n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < w.cells.length && out.length < n; i++) {
    const x = i % w.land.w;
    const y = Math.floor(i / w.land.w);
    if (!w.cells[i] && refusal(w, "belt", x, y, Infinity) === null) out.push({ x, y });
  }
  return out;
}
/** Sends the depot everything an order still wants, and what the story order wants of it first. */
function fill(w: World, order: Standing): void {
  for (const item of ITEMS) {
    const n = (order.want[item] ?? 0) - (order.filled[item] ?? 0);
    if (n > 0) deliver(w, item, n + Math.max(0, (storyOrder(w)?.want[item] ?? 0) - (w.filled[item] ?? 0)));
  }
}

describe("a new yard", () => {
  test("is seeded from Leaf's dice, at tick 0, standing for the moment it was made", () => {
    const w = WORKS.create(ctx(T0, 41));
    expect(w.seed).toBe(41);
    expect(w.tick).toBe(0);
    expect(w.at).toBe(T0);
    expect(clockOf(w, T0 + 2550)).toBe(25);
    expect(WORKS.decode(WORKS.encode(w))).toEqual(w);
  });
});

describe("advance", () => {
  test("does nothing within three seconds of Leaf's clock", () => {
    const w = kept(workingYard());
    const text = save(w);
    WORKS.advance(w, ctx(T0 + LEAD * TICK_MS + 99));
    expect(save(w)).toBe(text);
  });
  test("runs every tick up to 3,000 behind, to three seconds short of the clock", () => {
    const w = kept(workingYard());
    const twin = workingYard();
    WORKS.advance(w, ctx(T0 + (EXACT_MOST + LEAD) * TICK_MS + 50));
    steps(twin, EXACT_MOST);
    expect(w.at).toBe(T0 + EXACT_MOST * TICK_MS);
    expect(save({ ...w, at: 0 })).toBe(save(twin));
    expect(w.away).toBeNull();
  });
  test("further behind, moves the yard on quickly, says what it did, and lets go of the rest of the clock", () => {
    const w = kept(workingYard());
    const twin = workingYard();
    WORKS.advance(w, ctx(T0 + HOUR));
    const quick = forward(twin, 36_000 - LEAD);
    expect(w.tick).toBe(twin.tick);
    expect(clockOf(w, T0 + HOUR) - LEAD).toBe(w.tick);
    expect(w.away).toEqual({ seconds: quick.seconds, coins: quick.coins });
    expect(quick.coins).toBeGreaterThan(0);
    // Another time away before the letter is put away adds to it.
    WORKS.advance(w, ctx(T0 + 2 * HOUR));
    expect(w.away?.seconds).toBe(quick.seconds + 3600);
    // Eight hours at most, however long the absence, and none of it owed later.
    const week = kept(workingYard());
    WORKS.advance(week, ctx(T0 + 7 * 24 * HOUR));
    expect(week.away?.seconds).toBe(8 * 3600);
    expect(clockOf(week, T0 + 7 * 24 * HOUR) - LEAD).toBe(week.tick);
  });
});

describe("a command", () => {
  const [spot = { x: 0, y: 0 }] = clear(workingYard(), 1);
  const belt = (tick: number): WorksCommand => ({ do: "build", kind: "belt", dir: 0, ...spot, tick });

  test("is done at its tick: one in the yard's past now, one past three seconds ahead at three seconds", () => {
    const past = kept(workingYard());
    WORKS.advance(past, ctx(T0 + 8 * SECOND));
    WORKS.apply(past, belt(10), ctx(T0 + 8 * SECOND));
    expect(past.tick).toBe(50);
    const ahead = kept(workingYard());
    WORKS.apply(ahead, belt(500), ctx(T0 + 5 * SECOND));
    expect(ahead.tick).toBe(50 + LEAD);
    expect(ahead.at).toBe(T0 + (50 + LEAD) * TICK_MS);
    // At a tick within reach it is done exactly there, as the page did it.
    const there = kept(workingYard());
    WORKS.apply(there, belt(64), ctx(T0 + 5 * SECOND));
    const page = workingYard();
    steps(page, 64);
    did(page, belt(64));
    expect(save({ ...there, at: 0 })).toBe(save(page));
  });
  test("refused leaves the yard as running on to its tick alone would", () => {
    const w = kept(workingYard());
    const twin = kept(workingYard());
    expect(refused(WORKS.apply(w, { do: "remove", x: 0, y: 0, tick: 40 }, ctx(T0 + 5 * SECOND)))).toBe(
      "nothing_to_take_away",
    );
    stepTo(twin, 40);
    expect(save(w)).toBe(save(twin));
    // A run is all or none, with the turn of its first belt.
    const i = w.cells.findIndex((b) => b?.kind === "belt");
    const turn = { x: i % w.land.w, y: Math.floor(i / w.land.w), dir: w.cells[i]?.dir === 0 ? 1 : 0 } as const;
    const off = { kind: "belt", x: 0, y: 0, dir: 0, span: 0 } as const;
    expect(refused(play(w, { do: "lay", legs: [off], turn, tick: 40 }))).toBe("cannot_lay");
    expect(save(w)).toBe(save(twin));
    expect(refused(play(w, { do: "handOver", order: 999, tick: 40 }))).toBe("not_filled");
    expect(save(w)).toBe(save(twin));
    // Bare ground, and a machine, have no colour to take.
    const mill = w.cells.findIndex((b) => b?.kind === "mill");
    for (const j of [0, mill])
      expect(refused(play(w, { do: "paint", x: j % w.land.w, y: Math.floor(j / w.land.w), tint: 2, tick: 40 }))).toBe(
        "nothing_to_paint",
      );
    expect(save(w)).toBe(save(twin));
  });
  test("every command does what it says", () => {
    const w = create({ seed: 3, story: 6 });
    const [a, b, c] = clear(w, 3);
    if (!a || !b || !c) throw new Error("no room");
    const go = (act: WorksAct): Done<World, WorksNote> => did(w, { ...act, tick: w.tick });
    const on = (p: { x: number; y: number }) => w.cells[at(w, p.x, p.y)];
    go({ do: "build", kind: "mill", dir: 0, ...a });
    expect(on(a)?.kind).toBe("mill");
    go({ do: "build", kind: "mill", dir: 2, ...a });
    expect(on(a)?.dir).toBe(2);
    go({ do: "turn", dir: 1, ...a });
    expect(on(a)?.dir).toBe(1);
    go({ do: "recipe", item: "plank", ...a });
    expect(on(a)?.recipe).toBe("plank");
    const mill = on(a);
    if (mill) add(mill, "deadfall");
    go({ do: "tipOut", item: null, ...a });
    expect(on(a)?.count).toBe(0);
    // A splitter to hand set down on a belt that was paid for: the belt's Coins come back.
    w.spare.belt = 0;
    w.spare.splitter = 1;
    go({ do: "build", kind: "belt", dir: 0, ...b });
    expect(go({ do: "build", kind: "splitter", dir: 0, ...b }).coins?.map((paid) => paid.amount)).toEqual([1]);
    expect(on(b)?.kind).toBe("splitter");
    go({ do: "way", way: 2, open: false, ...b });
    expect(on(b)?.shut).toBe(4);
    go({ do: "way", way: 2, open: true, ...b });
    expect(on(b)?.shut).toBe(0);
    go({ do: "remove", ...b });
    go({ do: "build", kind: "crate", dir: 0, ...b });
    go({ do: "crate", open: false, ...b });
    expect(on(b)?.open).toBe(false);
    // A way is a splitter's: on a crate, or on nothing, it is refused.
    for (const p of [b, c])
      expect(refused(play(w, { do: "way", way: 0, open: false, ...p, tick: w.tick }))).toBe("not_a_splitter");
    go({ do: "remove", ...b });
    expect(on(b)).toBeNull();
    const legs = route(w, [c.x, c.y], [c.x, c.y + 2]) ?? [];
    go({ do: "lay", legs });
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.every((l) => on(l)?.kind === "belt")).toBe(true);
    // Colouring is free, and pays no till in.
    w.till = 5;
    expect(go({ do: "paint", tint: 4, ...c }).coins).toEqual([]);
    expect(legs.every((l) => on(l)?.tint === 4)).toBe(true);
    expect(w.till).toBe(5);
    // A set of pieces stood, moved as one, kept as a blueprint, and taken away.
    const tile = (p: { x: number; y: number }): number => at(w, p.x, p.y);
    go({ do: "stand", pieces: [{ kind: "mill", ...b, dir: 1, span: 0, recipe: "plank" }] });
    expect(on(b)).toMatchObject({ kind: "mill", dir: 1, recipe: "plank" });
    go({ do: "move", tiles: [tile(b)], turns: 1, ...b });
    expect(on(b)?.dir).toBe(2);
    go({ do: "saveBlueprint", slot: 2, tiles: [tile(a), tile(b)] });
    expect(w.blueprints[2]).toHaveLength(2);
    go({ do: "deleteBlueprint", slot: 2 });
    expect(w.blueprints[2]).toBeNull();
    expect(go({ do: "clear", tiles: [tile(a), tile(b)] }).coins?.map((paid) => paid.amount)).toEqual([20]);
    expect([on(a), on(b)]).toEqual([null, null]);
    for (const act of [
      { do: "stand", pieces: [{ kind: "depot", ...b, dir: 0, span: 0 }] },
      { do: "move", tiles: [tile(a)], turns: 0, ...b },
      { do: "clear", tiles: [tile(a)] },
      { do: "saveBlueprint", slot: 0, tiles: [tile(a)] },
      { do: "deleteBlueprint", slot: 0 },
    ] as const)
      expect(refused(play(w, { ...act, tick: w.tick }))).toBe(REFUSED[act.do]);
    go({ do: "buyPlot", plot: "meadow" });
    expect(w.plots).toContain("meadow");
    go({ do: "buyPlan", plan: "rakes" });
    expect(w.plans).toContain("rakes");
    const [first, second] = w.board;
    if (!first || !second) throw new Error("no board");
    go({ do: "swap", order: first.id });
    expect(w.board.map((o) => o.id)).not.toContain(first.id);
    fill(w, second);
    expect(go({ do: "handOver", order: second.id }).log).toEqual([
      { kind: "works_order", data: { order: second.id, title: second.title, pay: second.pay } },
    ]);
    expect(w.board).toHaveLength(3);
    w.away = { seconds: 600, coins: 5 };
    go({ do: "collect" });
    expect(w.away).toBeNull();
    expect(w.till).toBeLessThan(1);
  });
  test("is read off the wire with every field checked", () => {
    const ok: WorksAct[] = [
      { do: "build", kind: "belt", dir: 3, x: 1, y: 2 },
      { do: "lay", legs: [{ kind: "tunnel", x: 1, y: 2, dir: 0, span: 2 }], turn: { x: 0, y: 2, dir: 0 } },
      { do: "lay", legs: [] },
      { do: "stand", pieces: [{ kind: "crate", x: 1, y: 2, dir: 0, span: 0, open: false }] },
      { do: "move", tiles: [5, 1727], turns: 3, x: 1, y: 2 },
      { do: "clear", tiles: [] },
      { do: "saveBlueprint", slot: 2, tiles: [7] },
      { do: "deleteBlueprint", slot: 0 },
      { do: "remove", x: 4, y: 5 },
      { do: "turn", x: 4, y: 5, dir: 2 },
      { do: "paint", x: 4, y: 5, tint: 6 },
      { do: "paint", x: 4, y: 5, tint: 0 },
      { do: "recipe", x: 4, y: 5, item: null },
      { do: "tipOut", x: 4, y: 5, item: "plank" },
      { do: "crate", x: 4, y: 5, open: true },
      { do: "way", x: 4, y: 5, way: 2, open: false },
      { do: "buyPlot", plot: "meadow" },
      { do: "buyPlan", plan: "rakes" },
      { do: "swap", order: 3 },
      { do: "handOver", order: 0 },
      { do: "collect" },
    ];
    for (const c of ok) expect(readCommand({ ...c, tick: 9, id: "x-1" })).toEqual({ ...c, tick: 9 });
    const bad: unknown[] = [
      { do: "collect" },
      { do: "collect", tick: -1 },
      { do: "collect", tick: 1.5 },
      { do: "build", kind: "castle", dir: 0, x: 1, y: 1, tick: 0 },
      { do: "build", kind: "belt", dir: 4, x: 1, y: 1, tick: 0 },
      { do: "build", kind: "belt", dir: 0, x: -1, y: 1, tick: 0 },
      { do: "lay", legs: [{ kind: "belt", x: 1, y: 1, dir: 0, span: 9 }], tick: 0 },
      { do: "lay", legs: "all", tick: 0 },
      { do: "lay", legs: [], turn: { x: 1 }, tick: 0 },
      { do: "paint", x: 1, y: 1, tint: 7, tick: 0 },
      { do: "paint", x: 1, y: 1, tick: 0 },
      {
        do: "stand",
        pieces: Array.from({ length: STAND_MOST + 1 }, () => ({ kind: "belt", x: 1, y: 1, dir: 0, span: 0 })),
        tick: 0,
      },
      { do: "stand", pieces: [{ kind: "depot", x: 1, y: 1, dir: 0, span: 0 }], tick: 0 },
      { do: "stand", pieces: [{ kind: "belt", x: 256, y: 1, dir: 0, span: 0 }], tick: 0 },
      { do: "move", tiles: [1728], turns: 0, x: 1, y: 1, tick: 0 },
      { do: "move", tiles: [1], turns: 4, x: 1, y: 1, tick: 0 },
      { do: "move", tiles: [1.5], turns: 0, x: 1, y: 1, tick: 0 },
      { do: "clear", tiles: Array.from({ length: 1729 }, () => 0), tick: 0 },
      { do: "clear", tick: 0 },
      { do: "saveBlueprint", slot: 3, tiles: [1], tick: 0 },
      { do: "deleteBlueprint", slot: -1, tick: 0 },
      { do: "recipe", x: 1, y: 1, item: "gold", tick: 0 },
      { do: "crate", x: 1, y: 1, open: "yes", tick: 0 },
      { do: "way", x: 1, y: 1, way: 3, open: false, tick: 0 },
      { do: "way", x: 1, y: 1, way: 0, tick: 0 },
      { do: "buyPlot", plot: "moon", tick: 0 },
      { do: "buyPlan", plan: "shift", tick: 0 },
      { do: "swap", order: "first", tick: 0 },
      { do: "boost", tick: 0 },
      null,
    ];
    for (const c of bad) expect(readCommand(c)).toBeNull();
  });
});

describe("Coins", () => {
  test("a price pays the till in and is then taken; taking away gives it back; each change is keyed once", () => {
    const w = create({ seed: 3, story: 6 });
    const [a, b] = clear(w, 2);
    if (!a || !b) throw new Error("no room");
    const all: CoinChange[] = [];
    const coins = (act: WorksAct): readonly CoinChange[] => {
      const changes = did(w, { ...act, tick: w.tick }).coins ?? [];
      all.push(...changes);
      return changes;
    };
    w.till = 12.5;
    // The starter mill costs nothing: only the till is paid in.
    expect(coins({ do: "build", kind: "mill", dir: 0, ...a })).toEqual([
      { amount: 12, reason: "Earned in the Works", key: "bank:0", free: true },
    ]);
    expect(w.till).toBe(0.5);
    w.till = 3.25;
    expect(coins({ do: "build", kind: "pylon", dir: 0, ...b })).toEqual([
      { amount: 3, reason: "Earned in the Works", key: "bank:1", free: true },
      { amount: -6, reason: "Built in the Works", key: "bank:2" },
    ]);
    expect(coins({ do: "remove", ...b })).toEqual([
      { amount: 6, reason: "Taken away in the Works", key: "bank:3", free: true },
    ]);
    // The starter piece goes back to hand, and gives nothing back; an empty till pays nothing.
    expect(coins({ do: "remove", ...a })).toEqual([]);
    expect(coins({ do: "collect" })).toEqual([]);
    const rakes = PLANS.find((p) => p.id === "rakes")?.price ?? 0;
    expect(coins({ do: "buyPlan", plan: "rakes" }).map((c) => c.amount)).toEqual([-rakes]);
    // An order's pay goes into the till, and comes in with it.
    const [order] = w.board;
    if (!order) throw new Error("no board");
    fill(w, order);
    expect(coins({ do: "handOver", order: order.id })).toEqual([]);
    const till = Math.floor(w.till);
    expect(till).toBeGreaterThanOrEqual(order.pay);
    expect(coins({ do: "collect" }).map((c) => c.amount)).toEqual([till]);
    // The numbering is kept with the yard, so a yard read back never makes a key again.
    const back = decoded(WORKS.encode(w));
    back.till = 4;
    all.push(...(did(back, { do: "collect", tick: back.tick }).coins ?? []));
    const keys = all.map((c) => c.key);
    expect(keys).toHaveLength(7);
    expect(new Set(keys).size).toBe(keys.length);
    expect(all.every((c) => c.amount > 0 === (c.free === true))).toBe(true);
  });
  test("story orders finished on the way are logged once, with what was bought", () => {
    const w = create({ seed: 3, story: 4 });
    w.told = 4;
    for (const item of ITEMS) deliver(w, item, STORY[4]?.want[item] ?? 0);
    const price = PLOTS.find((p) => p.id === "meadow")?.price ?? 0;
    expect(did(w, { do: "buyPlot", plot: "meadow", tick: 0 }).log).toEqual([
      { kind: "works_plot", data: { plot: "meadow", price } },
      { kind: "works_story", data: { order: 5, title: STORY[4]?.title ?? "", pay: STORY[4]?.pay ?? 0 } },
    ]);
    expect(did(w, { do: "collect", tick: 0 }).log).toEqual([]);
  });
});

describe("what the page is shown", () => {
  test("has no seed, and a yard read from it hangs no order: a slot it would fill stays empty", () => {
    const w = kept(create({ seed: 5, story: 6 }));
    const view = WORKS.view(w, ctx(T0 + 4 * SECOND));
    expect(view.clock).toBe(40);
    expect(view.yard).not.toContain("seed");
    const page = decoded(view.yard);
    expect(page.seed).toBeNull();
    did(page, { do: "swap", order: 1, tick: 0 });
    expect(page.board.map((o) => o.id)).toEqual([0, 2]);
    // Leaf, with the seed, hangs the next.
    did(w, { do: "swap", order: 1, tick: 0 });
    expect(w.board.map((o) => o.id)).toEqual([0, 3, 2]);
  });
  test("a yard read back from its text is the yard, and goes on as it would have", () => {
    for (const yard of Object.values(YARDS)) {
      const w = decoded(JSON.stringify(yard));
      steps(w, 500);
      Object.assign(w, { at: T0, bank: 9, told: 2, away: { seconds: 300, coins: 2 } });
      const back = decoded(WORKS.encode(w));
      expect(WORKS.encode(back)).toBe(WORKS.encode(w));
      for (const k of [
        "seed",
        "tick",
        "at",
        "till",
        "bank",
        "told",
        "away",
        "story",
        "board",
        "plots",
        "plans",
      ] as const)
        expect([k, back[k]]).toEqual([k, w[k]]);
      steps(w, 300);
      steps(back, 300);
      expect(WORKS.encode(back)).toBe(WORKS.encode(w));
    }
  });
});

describe("Leaf and the page agree", () => {
  /**
   * The page does each command to its copy at once and sends it; Leaf does it a moment later; its
   * answer reaches the page after the page has done the next. The page takes Leaf's yard and does
   * every command still unanswered again on top: each time, that is the copy it was showing, and
   * once everything is answered the two yards are the same text.
   */
  test.each(Object.entries(YARDS))("on the %s yard", (_, yard) => {
    const start = decoded(JSON.stringify(yard));
    start.at = T0;
    let stored = WORKS.encode(start);
    /** Leaf's clock when its yard's clock reads `tick`. */
    const leafAt = (tick: number): number => T0 + (tick - start.tick) * TICK_MS + 37;
    // The page opens the yard twelve seconds after it was kept.
    const opening = leafAt(start.tick + 120);
    const opened = WORKS.view(WORKS.advance(decoded(stored), ctx(opening)), ctx(opening));
    const page = decoded(opened.yard);
    const [a, c, b] = clear(page, 3);
    const standing = page.cells.findIndex((p) => p?.kind === "belt");
    if (!a || !b || !c || standing < 0) throw new Error("no room");
    const acts: WorksAct[] = [
      { do: "build", kind: "belt", dir: 1, ...a },
      { do: "paint", tint: 2, ...a },
      { do: "paint", tint: 5, x: standing % page.land.w, y: Math.floor(standing / page.land.w) },
      { do: "build", kind: "pylon", dir: 0, ...c },
      { do: "lay", legs: route(page, [b.x, b.y], [b.x + 3, b.y]) ?? [] },
      { do: "turn", x: standing % page.land.w, y: Math.floor(standing / page.land.w), dir: 3 },
      { do: "paint", tint: 0, ...a },
      { do: "remove", ...a },
      { do: "collect" },
      { do: "stand", pieces: [{ kind: "belt", ...a, dir: 0, span: 0 }] },
      // A splitter in the belt's place, with its way ahead shut, opened, and its left way shut.
      { do: "build", kind: "splitter", dir: 0, ...a },
      { do: "way", way: 0, open: false, ...a },
      { do: "way", way: 0, open: true, ...a },
      { do: "way", way: 1, open: false, ...a },
      { do: "saveBlueprint", slot: 1, tiles: [at(page, a.x, a.y), at(page, c.x, c.y)] },
      { do: "move", tiles: [at(page, a.x, a.y)], turns: 1, ...a },
      { do: "clear", tiles: [at(page, a.x, a.y), at(page, c.x, c.y)] },
      { do: "deleteBlueprint", slot: 1 },
    ];
    // The colours are in what Leaf keeps and in what it shows a visitor.
    const coloured = (text: string): number => decoded(text).cells.filter((p) => p?.tint === 5).length;
    /** The splitter's shut ways after each command, as Leaf shows a visitor them. */
    const shut: number[] = [];
    let unanswered: WorksCommand[] = [];
    let inbox: { readonly view: string; readonly after: number } | null = null;
    let tick = opened.clock;
    for (const act of acts) {
      // The page acts every seven ticks, on its copy, and sends it.
      tick += 7;
      stepTo(page, tick);
      const command: WorksCommand = { ...act, tick };
      expect(refused(play(page, command))).toBeNull();
      unanswered.push(command);
      // The answer to the one before arrives, with this one still on its way.
      if (inbox) {
        const { view, after } = inbox;
        const rebuilt = decoded(view);
        unanswered = unanswered.filter((u) => u.tick > after);
        for (const u of unanswered) play(rebuilt, u);
        stepTo(rebuilt, page.tick);
        expect(save(rebuilt)).toBe(save(page));
      }
      // Leaf has it four ticks after it was made.
      const now = leafAt(tick + 4);
      const leaf = WORKS.advance(decoded(stored), ctx(now));
      expect(refused(WORKS.apply(leaf, command, ctx(now)))).toBeNull();
      stored = WORKS.encode(leaf);
      inbox = { view: WORKS.view(leaf, ctx(now)).yard, after: tick };
      shut.push(decoded(WORKS.visit?.(leaf, ctx(now)).yard ?? "").cells[at(page, a.x, a.y)]?.shut ?? 0);
    }
    expect(shut.filter((s, k) => s !== shut[k - 1])).toEqual([0, 1, 0, 2, 0]);
    expect(coloured(stored)).toBeGreaterThan(0);
    expect(coloured(WORKS.visit?.(decoded(stored), ctx(leafAt(tick + 5))).yard ?? "")).toBe(coloured(stored));
    const last = decoded(inbox?.view ?? "");
    stepTo(last, page.tick + 100);
    stepTo(page, page.tick + 100);
    expect(save(last)).toBe(save(page));
  });
});

describe("a yard's numbers on its owner's card", () => {
  test("are the Coins it has earned, the story done of its length, and its place, once it is on the board", () => {
    expect(WORKS_STATS.numbers({ place: 1, score: 38_556, also: { story: 18 } })).toEqual([
      { label: "Coins earned", value: "38,556" },
      { label: "Story", value: `18 of ${STORY.length}` },
      { label: "Top yards", value: "#1" },
    ]);
    expect(WORKS_STATS.numbers({ place: 4, score: 0, also: { story: 0 } }).map((s) => s.label)).toEqual([
      "Coins earned",
      "Story",
    ]);
  });
});

describe("awards", () => {
  test("are a model of each capstone the depot has ever taken in", () => {
    const w = kept(create({ seed: 1 }));
    expect(WORKS.awards?.(w)).toEqual([]);
    w.depot.beacon = 1;
    expect(WORKS.awards?.(w)).toEqual(["model-beacon"]);
    w.depot.crab = 2;
    expect(WORKS.awards?.(w)).toEqual(["model-crab", "model-beacon"]);
  });
});
