/**
 * What a ring's turn costs (`round.ts`): on the folded ring of 6,000 tiles with one free (`folded.ts`),
 * each tick looks at each tile of it 3 times at most, however its ways cross it, and the whole ring
 * moves on a tile each 4 ticks at grade I, as a full belt does.
 */
import { describe, expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { folded } from "./folded.ts";

/** How many times a tick the yard's ring turns looked at each of its tiles, over `ticks` ticks. */
function looks(y: F.Yard, ticks: number): number {
  F.rewire(y);
  const was = y.wire?.rings.looked[0] ?? 0;
  for (let k = 0; k < ticks; k++) F.step(y);
  const tiles = y.wire?.rings.tiles.length ?? 1;
  return ((y.wire?.rings.looked[0] ?? 0) - was) / tiles / ticks;
}

describe("the folded ring of 6,000 tiles, one free", () => {
  test("with its sorters set to nothing: 3 looks a tile a tick at most, and it moves on a tile each 4 ticks", () => {
    const { y, tiles } = folded();
    const free = (): number => tiles.findIndex((i) => y.item[i] === F.NONE);
    const each = looks(y, 4);
    const at = [free()];
    for (let k = 0; k < 9; k++) {
      for (let t = 0; t < 4; t++) F.step(y);
      at.push(free());
    }
    // Every thing moves on a tile, the one behind the free tile into it, so the free tile goes on round with them.
    expect([F.ringsOf(y), each <= 3, at]).toEqual([{ rings: 1, tiles: 6000 }, true, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]);
  });

  test("with its sorters set to stone, its ways crossing it 600 times: still 3 looks a tile a tick at most, and it moves as one", () => {
    const { y, tiles } = folded(true);
    const each = looks(y, 40);
    const free = tiles.findIndex((i) => y.item[i] === F.NONE);
    expect([F.ringsOf(y).rings, each <= 3, free]).toEqual([1, true, 10]);
  });
});
