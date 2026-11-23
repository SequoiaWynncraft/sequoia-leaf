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
  const belt = F.BELT;
  const leg: F.Piece = { kind: belt, x: 3, y: 4, dir: 1, span: 0 };
  const acts: F.Act[] = [
    { do: "build", kind: F.MILL, x: 20, y: 15, dir: 2, grade: 1 },
    { do: "build", kind: F.GATHERER, x: 1, y: 2, dir: 3, grade: 2 },
    { do: "lay", legs: [leg, { kind: F.TUNNEL, x: 4, y: 4, dir: 0, span: 2, grade: 2 }] },
    { do: "lay", legs: [leg], turn: { x: 3, y: 3, dir: 1 } },
    {
      do: "stand",
      pieces: [
        { kind: F.BENCH, x: 1, y: 1, dir: 0, span: 0, recipe: F.item("tool"), grade: 3 },
        { kind: F.CRATE, x: 2, y: 1, dir: 1, span: 0, open: false },
        { kind: F.SPLITTER, x: 3, y: 1, dir: 2, span: 0, tint: 4, shut: 5 },
        { kind: F.SORTER, x: 4, y: 1, dir: 3, span: 0, recipe: F.item("plank") },
      ],
    },
    { do: "placeBlueprint", slot: 1, turns: 3, x: 9, y: 8 },
    { do: "move", tiles: [1, 2, 300], turns: 2, x: 5, y: 6 },
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
    { do: "buyPlot", plot: F.plot("meadow") },
    { do: "take", node: F.goal("crates") },
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

  test("names every thing, kind, plot and goal, and holds no number for one", () => {
    const wired = acts.map((a) => JSON.stringify(F.writeAct(a)));
    expect(wired[0]).toBe('{"do":"build","kind":"mill","x":20,"y":15,"dir":2}');
    expect(wired.find((w) => w.includes("buyPlot"))).toBe('{"do":"buyPlot","plot":"meadow"}');
    expect(wired.find((w) => w.includes("take"))).toBe('{"do":"take","node":"crates"}');
    expect(wired.find((w) => w.includes('"bench"'))).toContain('"recipe":"tool"');
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
