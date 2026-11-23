/**
 * The wire from the page's side. What the page writes for an act, Leaf reads back as the same act,
 * for every kind of act (and, in `play.test.ts`, for every act the random player makes); and what
 * Leaf really sends (a view, a command's notes, the answer to a batch, made by `FACTORY` itself)
 * the page reads back as the yard, the news and the orders they were made from.
 */
import { describe, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";

import * as F from "../src/index.ts";
import { delivering, must } from "./yards.ts";

const ctx = (now: number): Ctx => ({ now, player: { id: "p", guest: false }, seed: 9, room: 1e9, awards: [] });
const at0 = 1_800_000_000_000;
/** An act read back as Leaf reads it: through JSON, with its tick. */
const readBack = (a: F.Act, tick = 7): F.Command | null =>
  F.readCommand(JSON.parse(JSON.stringify({ ...F.writeAct(a), tick })));

describe("what the page writes for an act", () => {
  const leg: F.Leg = { tunnel: false, x: 3, y: 4, dir: 1, grade: 1 };
  const acts: F.Act[] = [
    { do: "build", kind: F.MILL, x: 20, y: 15, dir: 2, grade: 1 },
    { do: "build", kind: F.GATHERER, x: 1, y: 2, dir: 3, grade: 2 },
    { do: "lay", legs: [leg, { tunnel: true, x: 4, y: 4, dir: 0, span: 2, grade: 2 }] },
    { do: "lay", legs: [leg], turn: { x: 3, y: 3, dir: 1 } },
    {
      do: "stand",
      pieces: [
        { kind: F.BENCH, x: 1, y: 1, dir: 0, span: 0, recipe: F.item("tool"), grade: 3 },
        { kind: F.CRATE, x: 2, y: 1, dir: 1, span: 0, open: false },
        { kind: F.SPLITTER, x: 3, y: 1, dir: 2, span: 0, tint: 4, shut: 5, first: 1 },
        { kind: F.SORTER, x: 4, y: 1, dir: 3, span: 0, recipe: F.item("plank") },
      ],
    },
    { do: "placeBlueprint", slot: 1, turns: 3, x: 9, y: 8 },
    { do: "move", tiles: [1, 2, 300], turns: 2, x: 5, y: 6 },
    { do: "copy", tiles: [1, 2, 300], turns: 1, x: 5, y: 6 },
    { do: "remove", x: 0, y: 35 },
    { do: "clear", tiles: [10, 11] },
    { do: "upgrade", tiles: [12] },
    { do: "saveBlueprint", slot: 0, tiles: [13, 14] },
    { do: "deleteBlueprint", slot: 2 },
    { do: "turn", dir: 3, x: 47, y: 0 },
    { do: "paint", tint: 6, x: 2, y: 2 },
    { do: "paint", tint: 0, x: 2, y: 2 },
    { do: "recipe", item: F.item("gear"), x: 4, y: 5 },
    { do: "recipe", item: null, x: 4, y: 5 },
    { do: "sort", item: F.item("pot"), x: 4, y: 5 },
    { do: "tipOut", item: null, x: 4, y: 5 },
    { do: "tipOut", item: F.DEADFALL, x: 4, y: 5 },
    { do: "crate", open: false, x: 6, y: 7 },
    { do: "way", way: 2, open: true, x: 6, y: 7 },
    { do: "first", way: 1, x: 6, y: 7 },
    { do: "first", way: null, x: 6, y: 7 },
    { do: "buyPlot", plot: F.plot("meadow") },
    { do: "take", node: F.goal("crates") },
    { do: "queue", node: F.goal("signs") },
    { do: "unqueue", node: F.goal("culvert") },
    { do: "study", research: F.goal("oilpress") },
    { do: "unstudy", research: F.goal("workshop") },
    { do: "swap", order: 12 },
    { do: "handOver", order: 3 },
    { do: "collect" },
  ];

  test("reads back off the wire as the same act, for every kind of act", () => {
    const kinds = new Set<string>(acts.map((a) => a.do));
    expect([...Object.keys(F.REFUSED), "collect"].filter((k) => !kinds.has(k))).toEqual([]);
    for (const a of acts) expect(readBack(a)).toEqual({ ...a, tick: 7 });
  });

  test("for a run of belt is a leg's kind, where, which way, how far under and its grade, and nothing else", () => {
    const wired = F.writeAct({ do: "lay", legs: [leg, { tunnel: true, x: 4, y: 4, dir: 0, span: 2, grade: 2 }] });
    expect(wired).toEqual({
      do: "lay",
      legs: [
        { kind: "belt", x: 3, y: 4, dir: 1, span: 0 },
        { kind: "tunnel", x: 4, y: 4, dir: 0, span: 2, grade: 2 },
      ],
    });
    // A belt that says it passes under is no leg, nor is any other kind.
    for (const bad of [
      { kind: "belt", span: 1 },
      { kind: "mill", span: 0 },
    ])
      expect(F.readLeg({ x: 1, y: 1, dir: 0, ...bad })).toBeNull();
  });

  test("for a run of belt holds a span only on a tunnel's leg: as the router finds the legs, and as they are read", () => {
    const y = F.create({ seed: 2, tier: 2 });
    // A wall of belts down the yard's own plot (rows 12 to 23), so the router goes under it by tunnel and on by belt.
    for (let z = 12; z < 24; z++) F.build(y, F.BELT, 22, z, 1, Infinity);
    const legs = F.route(y, [20, 13], [26, 13]) ?? [];
    expect(legs.some((l) => l.tunnel) && legs.some((l) => !l.tunnel)).toBe(true);
    for (const l of legs) expect("span" in l).toBe(l.tunnel);
    expect(F.readLeg({ kind: "belt", x: 1, y: 1, dir: 0, span: 0 })).toEqual({
      tunnel: false,
      x: 1,
      y: 1,
      dir: 0,
      grade: 1,
    });
    expect(F.readLeg({ kind: "tunnel", x: 1, y: 1, dir: 0, span: 2 })).toEqual({
      tunnel: true,
      x: 1,
      y: 1,
      dir: 0,
      grade: 1,
      span: 2,
    });
  });

  test("for a run of belt that ends on clear ground points its last belt on the way it came, or, beside the depot, into it", () => {
    const y = F.create({ seed: 2, tier: 2 });
    const [mx, my] = y.land.depot;
    // Up a column clear of the depot: the last belt goes on up.
    expect(F.route(y, [mx - 4, my + 3], [mx - 4, my - 1])?.at(-1)).toMatchObject({ x: mx - 4, y: my - 1, dir: 3 });
    // Along the row over the depot, to the tile over its middle: the last belt turns down into it.
    expect(F.route(y, [mx - 4, my - 2], [mx, my - 2])?.at(-1)).toMatchObject({ x: mx, y: my - 2, dir: 1 });
  });

  test("for a run of belt does the same to the page's copy as to Leaf's yard, whatever its legs carry beside what a leg is", () => {
    const page = F.create({ seed: 2, tier: 2 });
    const leaf = F.decode(F.encode(page));
    if (!leaf) throw new Error("the yard does not read back");
    const legs = F.route(page, [20, 15], page.land.depot) ?? [];
    // A colour, a recipe and a shut way on every leg, as a page holding pieces might pass them.
    const a: F.Act = {
      do: "lay",
      legs: legs.map((l) => Object.assign({}, l, { tint: 3, recipe: F.item("plank"), shut: 2 })),
    };
    expect("refused" in F.play(page, { ...a, tick: page.tick })).toBe(false);
    const read = readBack(a, leaf.tick);
    expect(read && "refused" in F.play(leaf, read)).toBe(false);
    expect([F.check(page), F.encode(page)]).toEqual([F.check(leaf), F.encode(leaf)]);
    expect(page.tint[F.at(page, 20, 15)]).toBe(0);
  });

  test("names every thing, kind, plot and goal, and holds no number for one", () => {
    const wired = acts.map((a) => JSON.stringify(F.writeAct(a)));
    expect(wired[0]).toBe('{"do":"build","kind":"mill","x":20,"y":15,"dir":2}');
    expect(wired.find((w) => w.includes("buyPlot"))).toBe('{"do":"buyPlot","plot":"meadow"}');
    expect(wired.find((w) => w.includes("take"))).toBe('{"do":"take","node":"crates"}');
    expect(wired.find((w) => w.includes('"bench"'))).toContain('"recipe":"tool"');
  });
});

/** A yard of tier 3 with two crates on the yard's own plot, both kept as a blueprint. */
function priced(): { y: F.Yard; crates: number[] } {
  const y = F.create({ seed: 2, tier: 3 });
  must(y, { do: "build", kind: "crate", x: 18, y: 13, dir: 0 });
  must(y, { do: "build", kind: "crate", x: 19, y: 13, dir: 0 });
  const crates = [F.at(y, 18, 13), F.at(y, 19, 13)];
  must(y, { do: "saveBlueprint", slot: 0, tiles: crates });
  return { y, crates };
}
/** An act played as the page plays it: at the yard's tick, with the purse. */
const play = (y: F.Yard, a: F.Act, purse: number): ReturnType<typeof F.play> =>
  F.play(y, { ...a, tick: y.tick }, purse);

describe("a command played with the purse, as the page plays it", () => {
  test("refuses whatever costs more than the purse and the till's whole Coins, with the rules' own sentence, and changes nothing", () => {
    const { y, crates } = priced();
    const crate = F.priceAt(y, F.kind("crate"), 20, 15);
    expect(crate).toBeGreaterThan(0);
    // Past the twelve belts to hand, a run's belts cost.
    const legs: F.Leg[] = Array.from({ length: 14 }, (_, k) => ({ tunnel: false, x: 17 + k, y: 21, dir: 0, grade: 1 }));
    const cases: [F.Act, string][] = [
      [{ do: "build", kind: F.kind("crate"), x: 20, y: 15, dir: 0, grade: 1 }, "Not enough Coins"],
      [{ do: "lay", legs }, `Not enough Coins: ${F.priceOf(y, legs.map(F.legPiece))} short`],
      [{ do: "copy", tiles: crates, turns: 0, x: 18, y: 15 }, `Not enough Coins: ${2 * crate} short`],
      [{ do: "placeBlueprint", slot: 0, turns: 0, x: 18, y: 16 }, `Not enough Coins: ${2 * crate} short`],
      [
        {
          do: "stand",
          pieces: [
            { kind: F.kind("crate"), x: 20, y: 16, dir: 0, span: 0 },
            { kind: F.kind("crate"), x: 21, y: 16, dir: 0, span: 0 },
          ],
        },
        `Not enough Coins: ${2 * crate} short`,
      ],
      [{ do: "buyPlot", plot: F.plot("meadow") }, "Not enough Coins"],
    ];
    const kept = F.encode(y);
    for (const [a, why] of cases) {
      expect(play(y, a, 0)).toMatchObject({ why });
      expect(F.encode(y)).toBe(kept);
      // Leaf plays it with no purse: its ledger is what refuses.
      const leaf = priced().y;
      expect("refused" in F.play(leaf, { ...a, tick: leaf.tick })).toBe(false);
    }
  });

  test("counts the till's whole Coins, which a command that costs pays in first", () => {
    const { y } = priced();
    const crate = F.priceAt(y, F.kind("crate"), 20, 15);
    const build: F.Act = { do: "build", kind: F.kind("crate"), x: 20, y: 15, dir: 0, grade: 1 };
    y.till = 1.5 * F.MILLI;
    expect(play(y, build, crate - 2)).toMatchObject({ why: "Not enough Coins" });
    const did = play(y, build, crate - 1);
    if ("refused" in did) throw new Error(did.why);
    expect(did.coins?.map((c) => c.amount)).toEqual([1, -crate]);
  });
});

describe("what Leaf sends the page, read back", () => {
  test("the view is the yard as Leaf keeps it, without its seed, at Leaf's tick", () => {
    const y = delivering();
    y.at = at0;
    const sent: unknown = JSON.parse(JSON.stringify(F.FACTORY.view(y, ctx(at0 + 5000))));
    const view = F.readView(sent);
    expect(view?.clock).toBe(y.tick + 50);
    const copy = F.decode(view?.yard);
    expect(copy?.seed).toBeNull();
    expect(copy && F.check(copy)).toBe(F.check(y));
    expect(F.readView({ yard: 3, clock: 1 })).toBeNull();
  });

  test("a command's notes are the yard's news: a node finished, an order filled and one handed over", () => {
    const y = F.create({ seed: 4 });
    y.at = at0;
    F.deliver(y, F.item("plank"), 12);
    const did = F.FACTORY.apply(y, { do: "collect", tick: y.tick }, ctx(at0 + 5000));
    if ("refused" in did) throw new Error(did.refused);
    const notes = F.readNotes(JSON.parse(JSON.stringify(did.notes)));
    expect(notes).toEqual([{ kind: "done", goal: "planks", title: "Planks for the Treasury", pay: 80 }]);

    const board = delivering(5);
    board.at = at0;
    const first = board.board[0];
    if (!first) throw new Error("no board");
    for (const n of F.ALL_ITEMS) if ((first.want[n] ?? 0) > 0) F.deliver(board, n, first.want[n] ?? 0);
    const handed = F.FACTORY.apply(board, { do: "handOver", order: first.id, tick: board.tick }, ctx(at0));
    if ("refused" in handed) throw new Error(handed.refused);
    expect(F.readNotes(JSON.parse(JSON.stringify(handed.notes)))).toEqual([
      { kind: "filled", id: first.id, title: first.title, pay: first.pay },
      { kind: "standing", id: first.id, title: first.title, pay: first.pay },
    ]);
    expect(F.readNotes([{ kind: "done", goal: "nap", title: "", pay: 1 }])).toBeNull();
  });

  test("the answer to a batch is Leaf's clock, the yard's tick and check, and the orders hung in the last minute, as the yard holds them", () => {
    const y = delivering(3);
    y.at = at0;
    must(y, { do: "swap", order: y.board[0]?.id ?? -1 });
    const sent: unknown = JSON.parse(JSON.stringify(F.FACTORY.answer?.(y, ctx(at0 + 2000))));
    const heard = F.readAnswer(sent);
    const rules = F.answer(y);
    expect(heard).toEqual({ clock: y.tick + 20, tick: rules.tick, check: rules.check, hung: [...rules.hung] });
    expect(heard?.hung.length).toBeGreaterThan(0);
    expect(F.readAnswer({ clock: 1, tick: 1, check: 1, hung: [{ id: 1 }] })).toBeNull();
  });
});
