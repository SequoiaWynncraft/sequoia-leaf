import { describe, expect, test } from "bun:test";

import { choose, pieces, type RunView, spotOf, startRun } from "@sequoia-leaf/raid";

import { type Gesture, type HandEvent, handStep, type Held, IDLE, marksOf } from "./gesture.ts";
import { reachOf, reachOfOffer } from "./logic.ts";

/** A run in its first room, its starter on the board and an item on the rack. */
function planning(): RunView {
  const run = startRun(5);
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
  taker: -1,
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
      reachOfOffer(run).seats,
      reachOfOffer(run).slots,
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
  });
});
