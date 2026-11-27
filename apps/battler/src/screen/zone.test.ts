import { describe, expect, test } from "bun:test";

import { choose, LEGACY_ERA, placeOf, type RunView, startRun, wingOf } from "@sequoia-leaf/raid";
import { type FigureId, FIGURES, isFigureId } from "@sequoia-leaf/raid/content/figures.ts";

import { type Gesture, type HandEvent, handStep, type Held, IDLE, marksOf } from "./gesture.ts";
import { zoneRows } from "./zone.ts";

const FRONT = Array.from({ length: 14 }, (_, i) => i);
const BACK = Array.from({ length: 14 }, (_, i) => i + 14);

/** A run planning its first room, with a tank, a ranged figure and a Sneak on the bench. */
function planning(): { run: RunView; tank: number; ranged: number; sneak: number } {
  const run = startRun(5, { era: LEGACY_ERA });
  choose(run, 0);
  const put = (slot: number, kind: FigureId): number => {
    const id = run.nextId++;
    run.bench[slot] = { id, kind, stars: 1, items: [], fed: 0 };
    return id;
  };
  return { run, tank: put(0, "glorp"), ranged: put(1, "finch"), sneak: put(2, "worm") };
}
const after = (g: Gesture, ...events: HandEvent[]): Gesture => events.reduce(handStep, g);
const pawn = (id: number): Held => ({ what: "pawn", id });
const carry = (held: Held): HandEvent => ({ e: "carry", pointer: 1, held, x: 70, y: 70 });
const move: HandEvent = { e: "move", pointer: 1, x: 80, y: 115, over: { on: "board", at: 24 }, aim: null, shop: false };

describe("the rows a figure in the hand belongs in", () => {
  test("are the ones its card names: the front two for front or second row, the back two for back row, none for a leap", () => {
    for (const id of Object.keys(FIGURES).filter(isFigureId)) {
      const place = placeOf(id);
      const rows = place === "front row" || place === "second row" ? [0, 1] : place === "back row" ? [2, 3] : [];
      expect([id, zoneRows(id)]).toEqual([id, rows]);
    }
  });

  test("light while a figure is carried or tapped, following its row, and go when it is put down or called off", () => {
    const { run, tank, ranged, sneak } = planning();
    const carried = after(IDLE, carry(pawn(tank)), move);
    expect(marksOf(carried, run).zone).toEqual(FRONT);
    expect(marksOf(after(IDLE, carry(pawn(ranged)), move), run).zone).toEqual(BACK);
    expect(marksOf(after(IDLE, carry(pawn(sneak)), move), run).zone).toEqual([]);
    // Tapped, waiting to be told where to go, as a finger does it.
    expect(marksOf({ at: "picked", held: pawn(ranged) }, run).zone).toEqual(BACK);
    // Let go (dropped), or called off (Escape, the window losing the pointer, a new run).
    expect(marksOf(after(carried, { e: "lift", pointer: 1 }), run).zone).toEqual([]);
    expect(marksOf(after(carried, { e: "lift", pointer: null }), run).zone).toEqual([]);
    expect(marksOf(after(carried, { e: "clear" }), run).zone).toEqual([]);
    // Another finger lifted leaves the carry, and its rows, as they were.
    expect(marksOf(after(carried, { e: "lift", pointer: 2 }), run).zone).toEqual(FRONT);
  });

  test("light for an offer carried off the stall, and never for an item", () => {
    const { run } = planning();
    run.stall = ["finch", "glorp", null, null, null];
    const offer = (at: number, kind: FigureId): Gesture => after(IDLE, carry({ what: "offer", at, kind }));
    expect(marksOf(offer(0, "finch"), run).zone).toEqual(BACK);
    expect(marksOf(offer(1, "glorp"), run).zone).toEqual(FRONT);
    run.items = ["thorn"];
    expect(marksOf(after(IDLE, carry({ what: "item", at: 0, item: "thorn" })), run).zone).toEqual([]);
  });

  test("advise only: a seat in the rows that is taken still lights, a seat outside them may still be gone to", () => {
    const { run, tank } = planning();
    const seat = run.board.findIndex((p) => p !== null);
    const starter = run.board[seat];
    expect(FRONT).toContain(seat);
    expect(marksOf(after(IDLE, carry(pawn(tank))), run).zone).toContain(seat);
    // The starter may still be moved to seats outside its rows.
    const moved = marksOf(after(IDLE, carry(pawn(starter?.id ?? -1))), run);
    expect(moved.zone.length).toBe(14);
    expect(moved.seats.some((s) => !moved.zone.includes(s))).toBe(true);
  });

  test("leave out the hexes a room's rules close", () => {
    const { run, tank, ranged } = planning();
    run.wing = { rule: "stumps", at: wingOf(run.room), stumps: [2, 20] };
    expect(marksOf(after(IDLE, carry(pawn(tank))), run).zone).toEqual(FRONT.filter((s) => s !== 2));
    expect(marksOf(after(IDLE, carry(pawn(ranged))), run).zone).toEqual(BACK.filter((s) => s !== 20));
    // Long Table: the front row is bare while planning, so a tank's rows are the second alone.
    run.wing = { rule: "long", at: wingOf(run.room), stumps: [] };
    expect(marksOf(after(IDLE, carry(pawn(tank))), run).zone).toEqual(FRONT.filter((s) => s >= 7));
  });
});
