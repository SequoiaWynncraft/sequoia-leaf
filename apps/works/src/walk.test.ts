/**
 * Walking a group of pieces in trouble, moved by its one function: begun at the group's first piece,
 * back and on round the group, from a piece mended to the nearest still in trouble, and ended when the
 * group is mended, the bar has nowhere to be, or Stop is pressed.
 */
import { describe, expect, test } from "bun:test";

import { NOT_WALKING, type Walk, walkAt, walkStep } from "./walk.ts";

const OUT = "Nowhere to send its stone";
const at = (tile: number): Walk => ({ is: "walking", title: OUT, tile });
const tiles = [10, 20, 30] as const;

describe("walking a group", () => {
  test("begins at the group's first piece; a group with none begins nothing", () => {
    expect(walkStep(NOT_WALKING, { do: "start", title: OUT, tiles })).toEqual(at(10));
    expect(walkStep(NOT_WALKING, { do: "start", title: OUT, tiles: [] })).toEqual(NOT_WALKING);
  });

  test("goes on and back round the group", () => {
    expect(walkStep(at(10), { do: "step", by: 1, tiles })).toEqual(at(20));
    expect(walkStep(at(30), { do: "step", by: 1, tiles })).toEqual(at(10));
    expect(walkStep(at(10), { do: "step", by: -1, tiles })).toEqual(at(30));
  });

  test("from a piece mended since, to the nearest still in trouble that way", () => {
    expect(walkStep(at(15), { do: "step", by: 1, tiles })).toEqual(at(20));
    expect(walkStep(at(15), { do: "step", by: -1, tiles })).toEqual(at(10));
    expect(walkStep(at(35), { do: "step", by: 1, tiles })).toEqual(at(10));
    expect(walkAt(15, tiles)).toBe("3 left");
    expect(walkAt(20, tiles)).toBe("2 of 3");
  });

  test("ends when its group is mended, when the bar has nowhere to be, or on Stop; and stays while it can be shown", () => {
    expect(walkStep(at(10), { do: "step", by: 1, tiles: null })).toEqual(NOT_WALKING);
    expect(walkStep(at(10), { do: "look", tiles: null, shown: true })).toEqual(NOT_WALKING);
    expect(walkStep(at(10), { do: "look", tiles, shown: false })).toEqual(NOT_WALKING);
    expect(walkStep(at(10), { do: "stop" })).toEqual(NOT_WALKING);
    const w = at(20);
    expect(walkStep(w, { do: "look", tiles, shown: true })).toBe(w);
    // Not walking, nothing moves it but a start.
    expect(walkStep(NOT_WALKING, { do: "step", by: 1, tiles })).toBe(NOT_WALKING);
    expect(walkStep(NOT_WALKING, { do: "look", tiles, shown: true })).toBe(NOT_WALKING);
  });
});
