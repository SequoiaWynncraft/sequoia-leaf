import { describe, expect, test } from "bun:test";

import {
  choose,
  GOOD_WITH,
  halvesOf,
  LEGACY_ERA,
  pieces,
  rackOf,
  type RunView,
  spotOf,
  startRun,
} from "@sequoia-leaf/raid";
import { CAT } from "@sequoia-leaf/raid/testkit.ts";

import { type Gesture, type HandEvent, handStep, type Held, IDLE, marksOf, tapOf } from "./gesture.ts";
import { reachOf, reachOfOffer } from "./logic.ts";
import { type Aim, dropOf } from "./making.ts";

/** A run in its first room, its starter on the board and an item on the rack. */
function planning(): RunView {
  const run = startRun(5, { era: LEGACY_ERA });
  choose(run, 0);
  run.rack = { thorn: 1 };
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
    const held: Held = { what: "item", item: "thorn" };
    const marks = marksOf({ at: "picked", held }, run);
    expect(marks.takers).toEqual(pieces(run).map((p) => p.id));
    expect(marks.forging).toBe("thorn");
    const carried = marksOf(after(IDLE, { e: "carry", pointer: 1, held, x: 0, y: 0 }), run);
    expect(carried.ghost).toEqual({ item: "thorn" });
    expect([marks.item, marksOf(IDLE, run).item]).toEqual(["thorn", null]);
  });

  test("a component in the hand shows the kinds it pairs with, and nothing else on the rack", () => {
    const run = planning();
    run.rack = rackOf(["thorn", "mosscharm", "plume", "wasptail", "bark"]);
    const marks = marksOf({ at: "picked", held: { what: "item", item: "plume" } }, run);
    expect([marks.pairs, marks.pair]).toEqual([["thorn", "bark"], null]);
    expect(marksOf({ at: "picked", held: { what: "item", item: "mosscharm" } }, run).pairs).toEqual([]);
    // Its own kind, only with two of it.
    run.rack = rackOf(["plume", "plume"]);
    expect(marksOf({ at: "picked", held: { what: "item", item: "plume" } }, run).pairs).toEqual(["plume"]);
    run.rack = rackOf(["plume"]);
    expect(marksOf({ at: "picked", held: { what: "item", item: "plume" } }, run).pairs).toEqual([]);
  });

  test("what a carried item is over is its aim: a drop on a component, or a drop elsewhere", () => {
    const run = planning();
    run.rack = rackOf(["thorn", "plume"]);
    const held: Held = { what: "item", item: "thorn" };
    const carried = after(IDLE, { e: "carry", pointer: 1, held, x: 0, y: 0 });
    const over = (aim: Aim | null): Gesture =>
      after(carried, { e: "move", pointer: 1, x: 9, y: 9, over: null, aim, shop: false });
    const onRack = marksOf(over({ rack: "plume" }), run);
    expect([onRack.pair, onRack.taker, onRack.target]).toEqual(["plume", -1, null]);
    const id = pieces(run)[0]?.id ?? 0;
    const onFigure = marksOf(over({ piece: id }), run);
    expect([onFigure.pair, onFigure.taker]).toEqual([null, id]);
    const elsewhere = marksOf(over(null), run);
    expect([elsewhere.pair, elsewhere.taker]).toEqual([null, -1]);
  });

  test("a tapped item is aimed by its tip: at a component it pairs with, or at a figure; put down, at nothing", () => {
    const run = planning();
    run.rack = rackOf(["thorn", "plume"]);
    const picked: Gesture = { at: "picked", held: { what: "item", item: "thorn" } };
    expect(marksOf(picked, run, { aim: { rack: "plume" }, item: null }).pair).toBe("plume");
    expect(marksOf(picked, run, { aim: { piece: 7 }, item: null }).taker).toBe(7);
    expect(marksOf(picked, run).pair).toBe(null);
    // The tip of an item that has been put down aims nothing.
    const idle = marksOf(IDLE, run, { aim: { rack: "plume" }, item: null });
    expect([idle.pair, idle.taker, idle.pairs]).toEqual([null, -1, []]);
  });

  test("the taps: an item, then a component it pairs with or a figure, aims it; the same item again puts it down", () => {
    const run = planning();
    run.rack = rackOf(["thorn", "mosscharm", "plume"]);
    const tapped = (g: Gesture, on: Parameters<typeof tapOf>[2]): string => tapOf(g, marksOf(g, run).pairs, on);
    // With nothing in the hand, a tap picks the thing up.
    expect([tapped(IDLE, { rack: "thorn" }), tapped(IDLE, { piece: 1 })]).toEqual(["pick", "pick"]);
    const thorn: Gesture = { at: "picked", held: { what: "item", item: "thorn" } };
    expect(tapped(thorn, { rack: "plume" })).toBe("aim");
    expect(tapped(thorn, { piece: 1 })).toBe("aim");
    expect(tapped(thorn, { rack: "thorn" })).toBe("down");
    // An emblem is no pair: the tap takes it in hand instead. And a figure in the hand is not an item.
    expect(tapped(thorn, { rack: "mosscharm" })).toBe("pick");
    expect(tapped({ at: "picked", held: pawn(1) }, { rack: "plume" })).toBe("pick");
    // The aim's tip is what the two would make, and its button is the forge.
    expect(dropOf(run, "thorn", { rack: "plume" })).toMatchObject({
      does: "make",
      command: { do: "forge", item: "plume", with: "thorn" },
    });
  });

  test("with two or more of a kind, its own tile tapped again aims it there: Make, two Thorns into a Blackthorn", () => {
    const run = planning();
    run.rack = rackOf(["thorn", "thorn", "mosscharm", "mosscharm"]);
    const tapped = (g: Gesture, on: Parameters<typeof tapOf>[2]): string => tapOf(g, marksOf(g, run).pairs, on);
    const thorn: Gesture = { at: "picked", held: { what: "item", item: "thorn" } };
    expect(tapped(thorn, { rack: "thorn" })).toBe("aim");
    expect(dropOf(run, "thorn", { rack: "thorn" })).toMatchObject({
      does: "make",
      item: "blackthorn",
      command: { do: "forge", item: "thorn", with: "thorn" },
    });
    // Two of a kind that make nothing together: its tile still puts it down.
    const moss: Gesture = { at: "picked", held: { what: "item", item: "mosscharm" } };
    expect(tapped(moss, { rack: "mosscharm" })).toBe("down");
  });

  test("the fielded figures that want an item are marked: for the one in the hand, or else the one pointed at", () => {
    const run = planning();
    const figure = pieces(run)[0];
    if (!figure) throw new Error("no figure");
    const part = halvesOf(CAT, GOOD_WITH[figure.kind][0])[0];
    expect(marksOf({ at: "picked", held: { what: "item", item: part } }, run).wanters).toEqual([figure.id]);
    expect(marksOf(IDLE, run, { aim: null, item: part }).wanters).toEqual([figure.id]);
    expect(marksOf(IDLE, run).wanters).toEqual([]);
    // A figure in the hand is not an item: what is pointed at meanwhile marks nobody.
    expect(marksOf({ at: "picked", held: pawn(figure.id) }, run, { aim: null, item: part }).wanters).toEqual([]);
  });
});
