import { describe, expect, test } from "bun:test";

import { choose, finishedIn, GOOD_WITH, LEGACY_ERA, pieces, type RunView, spotOf, startRun } from "@sequoia-leaf/raid";
import { CAT } from "@sequoia-leaf/raid/testkit.ts";

import { type Gesture, type HandEvent, handStep, type Held, IDLE, marksOf, tapOf } from "./gesture.ts";
import { reachOf, reachOfOffer } from "./logic.ts";
import { type Aim, dropOf } from "./making.ts";

/** A run in its first room, its starter on the board and an item on the rack. */
function planning(): RunView {
  const run = startRun(5, { era: LEGACY_ERA });
  choose(run, 0);
  run.items = ["thorn"];
  return run;
}
const after = (g: Gesture, ...events: HandEvent[]): Gesture => events.reduce(handStep, g);
const pawn = (id: number): Held => ({ what: "pawn", id });
const move = (pointer: number, x: number, y: number): HandEvent => ({
  e: "move",
  pointer,
  x,
  y,
  over: { on: "board", at: 3 },
  aim: null,
  shop: false,
});

describe("the hand", () => {
  test("a thing is carried by the pointer that pressed it, and moves with that pointer alone", () => {
    const carried = after(IDLE, { e: "carry", pointer: 1, held: pawn(1), x: 10, y: 20 });
    expect(carried).toMatchObject({ at: "dragging", pointer: 1, x: 10, y: 20 });
    expect(after(carried, move(1, 40, 50))).toMatchObject({
      at: "dragging",
      x: 40,
      y: 50,
      over: { on: "board", at: 3 },
    });
    expect(after(carried, move(2, 40, 50))).toBe(carried);
  });

  test("a second finger lifted, or called off, leaves the first one's figure in the hand (B7)", () => {
    const carried = after(IDLE, { e: "carry", pointer: 1, held: pawn(1), x: 10, y: 20 });
    expect(after(carried, { e: "lift", pointer: 2 })).toBe(carried);
    expect(after(carried, { e: "lift", pointer: 1 })).toEqual(IDLE);
    expect(after(carried, { e: "lift", pointer: null })).toEqual(IDLE);
  });

  test("one thing is carried at a time: a second pointer carrying off what it pressed carries nothing", () => {
    const carried = after(IDLE, { e: "carry", pointer: 1, held: pawn(1), x: 10, y: 20 });
    expect(after(carried, { e: "carry", pointer: 2, held: pawn(2), x: 0, y: 0 })).toBe(carried);
  });

  test("a thing tapped waits to be told where it goes, and is put down", () => {
    const picked = after(IDLE, { e: "pick", held: pawn(1) });
    expect(picked).toEqual({ at: "picked", held: pawn(1) });
    expect(after(picked, { e: "lift", pointer: 1 })).toBe(picked);
    expect(after(picked, { e: "clear" })).toEqual(IDLE);
  });
});

describe("what the table shows of the hand", () => {
  test("nothing, with nothing in the hand", () => {
    const marks = marksOf(IDLE, planning());
    expect([marks.seats, marks.slots, marks.takers, marks.picked, marks.held, marks.ghost]).toEqual([
      [],
      [],
      [],
      -1,
      -1,
      null,
    ]);
  });

  test("a figure tapped or carried lights where it may go; carried, the place under it and where the hand is", () => {
    const run = planning();
    const id = pieces(run)[0]?.id ?? 0;
    const from = spotOf(run, id);
    if (!from) throw new Error("no figure");
    const reach = reachOf(run, from);
    const picked = marksOf({ at: "picked", held: pawn(id) }, run);
    expect([picked.seats, picked.swaps, picked.picked, picked.held]).toEqual([reach.seats, reach.swaps, id, -1]);
    const carried = marksOf(after(IDLE, { e: "carry", pointer: 1, held: pawn(id), x: 5, y: 6 }, move(1, 7, 8)), run);
    expect([carried.held, carried.picked, carried.at, carried.target]).toEqual([
      id,
      -1,
      { x: 7, y: 8 },
      { on: "board", at: 3 },
    ]);
  });

  test("an offer carried off the stall is a figure in the hand, lighting where it may be bought to", () => {
    const run = planning();
    const kind = run.stall.find((k) => k !== null) ?? "worm";
    const marks = marksOf(
      after(IDLE, { e: "carry", pointer: 1, held: { what: "offer", at: 0, kind }, x: 0, y: 0 }),
      run,
    );
    expect([marks.ghost, marks.seats, marks.slots]).toEqual([
      { kind },
      reachOfOffer(run, 0).seats,
      reachOfOffer(run, 0).slots,
    ]);
  });

  test("an item in the hand shows who would take it, and a component what it would make", () => {
    const run = planning();
    const held: Held = { what: "item", at: 0, item: "thorn" };
    const marks = marksOf({ at: "picked", held }, run);
    expect(marks.takers).toEqual(pieces(run).map((p) => p.id));
    expect(marks.forging).toBe("thorn");
    const carried = marksOf(after(IDLE, { e: "carry", pointer: 1, held, x: 0, y: 0 }), run);
    expect(carried.ghost).toEqual({ item: "thorn" });
    expect([marks.item, marksOf(IDLE, run).item]).toEqual([0, -1]);
  });

  test("a component in the hand shows the components it pairs with, and nothing else on the rack", () => {
    const run = planning();
    run.items = ["thorn", "mosscharm", "plume", "wasptail", "bark"];
    const marks = marksOf({ at: "picked", held: { what: "item", at: 2, item: "plume" } }, run);
    expect([marks.pairs, marks.pair]).toEqual([[0, 4], -1]);
    expect(marksOf({ at: "picked", held: { what: "item", at: 1, item: "mosscharm" } }, run).pairs).toEqual([]);
  });

  test("what a carried item is over is its aim: a drop on a component, or a drop elsewhere", () => {
    const run = planning();
    run.items = ["thorn", "plume"];
    const held: Held = { what: "item", at: 0, item: "thorn" };
    const carried = after(IDLE, { e: "carry", pointer: 1, held, x: 0, y: 0 });
    const over = (aim: Aim | null): Gesture =>
      after(carried, { e: "move", pointer: 1, x: 9, y: 9, over: null, aim, shop: false });
    const onRack = marksOf(over({ rack: 1 }), run);
    expect([onRack.pair, onRack.taker, onRack.target]).toEqual([1, -1, null]);
    const id = pieces(run)[0]?.id ?? 0;
    const onFigure = marksOf(over({ piece: id }), run);
    expect([onFigure.pair, onFigure.taker]).toEqual([-1, id]);
    const elsewhere = marksOf(over(null), run);
    expect([elsewhere.pair, elsewhere.taker]).toEqual([-1, -1]);
  });

  test("a tapped item is aimed by its tip: at a component it pairs with, or at a figure; put down, at nothing", () => {
    const run = planning();
    run.items = ["thorn", "plume"];
    const picked: Gesture = { at: "picked", held: { what: "item", at: 0, item: "thorn" } };
    expect(marksOf(picked, run, { aim: { rack: 1 }, item: null }).pair).toBe(1);
    expect(marksOf(picked, run, { aim: { piece: 7 }, item: null }).taker).toBe(7);
    expect(marksOf(picked, run).pair).toBe(-1);
    // The tip of an item that has been put down aims nothing.
    const idle = marksOf(IDLE, run, { aim: { rack: 1 }, item: null });
    expect([idle.pair, idle.taker, idle.pairs]).toEqual([-1, -1, []]);
  });

  test("the taps: an item, then a component it pairs with or a figure, aims it; the same item again puts it down", () => {
    const run = planning();
    run.items = ["thorn", "mosscharm", "plume"];
    const tapped = (g: Gesture, on: Parameters<typeof tapOf>[2]): string => tapOf(g, marksOf(g, run).pairs, on);
    // With nothing in the hand, a tap picks the thing up.
    expect([tapped(IDLE, { rack: 0 }), tapped(IDLE, { piece: 1 })]).toEqual(["pick", "pick"]);
    const thorn: Gesture = { at: "picked", held: { what: "item", at: 0, item: "thorn" } };
    expect(tapped(thorn, { rack: 2 })).toBe("aim");
    expect(tapped(thorn, { piece: 1 })).toBe("aim");
    expect(tapped(thorn, { rack: 0 })).toBe("down");
    // An emblem is no pair: the tap takes it in hand instead. And a figure in the hand is not an item.
    expect(tapped(thorn, { rack: 1 })).toBe("pick");
    expect(tapped({ at: "picked", held: pawn(1) }, { rack: 2 })).toBe("pick");
    // The aim's tip is what the two would make, and its button is the forge, in the place tapped.
    expect(dropOf(run, 0, { rack: 2 })).toMatchObject({ does: "make", command: { do: "forge", item: 2, with: 0 } });
  });

  test("the fielded figures that want an item are marked: for the one in the hand, or else the one pointed at", () => {
    const run = planning();
    const figure = pieces(run)[0];
    if (!figure) throw new Error("no figure");
    const part = finishedIn(CAT, GOOD_WITH[figure.kind][0]).made[0];
    expect(marksOf({ at: "picked", held: { what: "item", at: 0, item: part } }, run).wanters).toEqual([figure.id]);
    expect(marksOf(IDLE, run, { aim: null, item: part }).wanters).toEqual([figure.id]);
    expect(marksOf(IDLE, run).wanters).toEqual([]);
    // A figure in the hand is not an item: what is pointed at meanwhile marks nobody.
    expect(marksOf({ at: "picked", held: pawn(figure.id) }, run, { aim: null, item: part }).wanters).toEqual([]);
  });
});
