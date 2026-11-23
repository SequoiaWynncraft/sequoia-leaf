/**
 * What is in hand, moved by its one function: Escape steps back one stage of each variant, a lost
 * press ends whatever drag the hand holds and nothing else, and a drag answers only to the press that
 * began it. Nothing here reads a yard: aims, runs and marks are plain values handed in.
 */
import { describe, expect, test } from "bun:test";

import { BELT, emptyYard, kind, LAND } from "@sequoia-leaf/factory";

import { type Hand, type HandEvent, IDLE, step, toolOf } from "./hand.ts";
import type { Aim, Group, Mark, Run } from "./state.ts";

const yard = emptyYard(LAND);
const MILL = kind("mill");
const aim: Aim = { x: 3, y: 4, why: null, cost: 0, yard, rev: 0, coins: 0 };
const run: Run = { legs: [], turns: [], cost: 0, why: null, yard, rev: 0, coins: 0 };
const mark: Mark = { x0: 0, y0: 0, x1: 1, y1: 1, tiles: [5], pieces: [], cost: 0 };
const group: Group = { as: "copy", tiles: [5], turns: 0, at: [], why: [] };
const after = (h: Hand, ...events: HandEvent[]): Hand => events.reduce(step, h);
const back = (finger: boolean): HandEvent => ({ do: "back", finger });

const build: Hand = { is: "build", kind: MILL, aim, faced: 7 };
const belt: Hand = { is: "build", kind: BELT, aim, faced: -1 };
const dragging: Hand = { is: "beltDrag", pointer: 1, path: [{ x: 1, y: 1 }], run, aim };
const tapping: Hand = { is: "beltTaps", from: { x: 1, y: 1 }, run, aim };
const stroking: Hand = { is: "paint", aim, stroke: { pointer: 1, id: 9 } };
const select = (stage: Extract<Hand, { is: "select" }>["stage"]): Hand => ({ is: "select", stage });

describe("Escape", () => {
  test("steps back one stage of whatever is in hand, and from nothing stays", () => {
    const table: [string, Hand, Hand][] = [
      ["nothing", IDLE, IDLE],
      ["a kind, with a mouse", build, IDLE],
      ["a run dragged out", dragging, { is: "build", kind: BELT, aim, faced: -1 }],
      ["a run tapped out", tapping, { is: "build", kind: BELT, aim: null, faced: -1 }],
      ["the spade", { is: "remove", aim }, IDLE],
      ["the brush in a stroke", stroking, { is: "paint", aim, stroke: null }],
      ["the brush", { is: "paint", aim, stroke: null }, IDLE],
      ["pieces held from an area", select({ is: "holding", group, mark, aim }), select({ is: "marked", mark })],
      ["a blueprint held", select({ is: "holding", group, mark: null, aim }), select({ is: "empty" })],
      ["Save asking", select({ is: "saving", mark }), select({ is: "marked", mark })],
      ["an area marked", select({ is: "marked", mark }), select({ is: "empty" })],
      [
        "an area being marked",
        select({ is: "marking", corner: { x: 0, y: 0 }, mark, pointer: null }),
        select({ is: "empty" }),
      ],
      ["Select with nothing marked", select({ is: "empty" }), IDLE],
    ];
    for (const [what, from, to] of table) expect([what, step(from, back(false))]).toEqual([what, to]);
  });

  test("with a finger, an aim is put away before the tool is", () => {
    expect(after(build, back(true))).toEqual({ ...build, aim: null });
    expect(after(build, back(true), back(true))).toEqual(IDLE);
    expect(after({ is: "remove", aim }, back(true))).toEqual({ is: "remove", aim: null });
  });
});

describe("a lost press", () => {
  test("ends the drag the hand holds, doing nothing, and leaves the tool in hand", () => {
    expect(step(dragging, { do: "drop" })).toEqual({ is: "build", kind: BELT, aim, faced: -1 });
    expect(step(stroking, { do: "drop" })).toEqual({ is: "paint", aim, stroke: null });
    // An area a mouse was marking keeps what it marked so far.
    expect(step(select({ is: "marking", corner: { x: 0, y: 0 }, mark, pointer: 1 }), { do: "drop" })).toEqual(
      select({ is: "marked", mark }),
    );
  });

  test("changes nothing that holds no drag: a finger's corner, a run tapped out, an aim", () => {
    for (const h of [
      IDLE,
      build,
      tapping,
      { is: "paint", aim, stroke: null } satisfies Hand,
      select({ is: "marking", corner: { x: 0, y: 0 }, mark, pointer: null }),
      select({ is: "holding", group, mark, aim }),
    ])
      expect(step(h, { do: "drop" })).toBe(h);
  });
});

describe("a drag", () => {
  test("begins only with the belt in hand, and answers only to the press that began it", () => {
    expect(step(build, { do: "drag", pointer: 1, path: [{ x: 0, y: 0 }] })).toBe(build);
    const begun = step(belt, { do: "drag", pointer: 1, path: [{ x: 0, y: 0 }] });
    expect(begun).toMatchObject({ is: "beltDrag", pointer: 1 });
    expect(step(begun, { do: "drag", pointer: 2, path: [] })).toBe(begun);
    expect(
      step(begun, {
        do: "drag",
        pointer: 1,
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      }),
    ).toMatchObject({
      path: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    });
  });

  test("ends with the hand: taking up another tool, or the belt laid", () => {
    expect(step(dragging, { do: "pick", tool: "remove" })).toEqual({ is: "remove", aim: null });
    expect(step(stroking, { do: "pick", tool: null })).toEqual(IDLE);
    expect(step(dragging, { do: "laid" })).toMatchObject({ is: "build", kind: BELT });
    expect(toolOf(dragging)).toBe(BELT);
  });

  test("a stroke can only be begun with the brush in hand", () => {
    expect(step(IDLE, { do: "stroke", pointer: 1, id: 1 })).toBe(IDLE);
    expect(step({ is: "paint", aim: null, stroke: null }, { do: "stroke", pointer: 1, id: 1 })).toEqual({
      is: "paint",
      aim: null,
      stroke: { pointer: 1, id: 1 },
    });
  });
});

describe("Select", () => {
  test("goes from a corner to an area to Save and back, holds pieces, and puts a moved group down marked", () => {
    let h = step(select({ is: "empty" }), { do: "corner", corner: { x: 0, y: 0 }, pointer: 1 });
    h = step(h, { do: "marking", mark });
    h = step(h, { do: "marked", mark });
    expect(h).toEqual(select({ is: "marked", mark }));
    expect(after(h, { do: "save" })).toEqual(select({ is: "saving", mark }));
    expect(after(h, { do: "save" }, { do: "save" })).toEqual(h);
    const held = step(h, { do: "hold", group, mark });
    expect(held).toEqual(select({ is: "holding", group, mark, aim: null }));
    // An empty area marks nothing.
    expect(step(h, { do: "marked", mark: null })).toEqual(select({ is: "empty" }));
    // A corner is not begun with pieces held.
    expect(step(held, { do: "corner", corner: { x: 0, y: 0 }, pointer: 1 })).toBe(held);
  });
});
