/** What a mark lights: every tile of the pieces it names, each once, worked out again when the yard changes. */
import { expect, test } from "bun:test";

import { create, DEPOT } from "@sequoia-leaf/factory";

import { markCovers } from "./big.ts";

const depotTiles = (y: ReturnType<typeof create>): number[] => [...y.kind.keys()].filter((i) => y.kind[i] === DEPOT);

test("a mark naming every tile of a piece of three by three lights each of its nine tiles once", () => {
  const y = create({ seed: 5, tier: 3 });
  const nine = depotTiles(y);
  expect(nine.length).toBe(9);
  const { all, on } = markCovers(y, nine);
  expect(all.toSorted((a, b) => a - b)).toEqual(nine);
  expect(on.reduce((n, b) => n + b, 0)).toBe(9);
  // One of its tiles names it whole.
  expect(markCovers(y, nine.slice(0, 1)).all.toSorted((a, b) => a - b)).toEqual(nine);
});

test("what a mark covers is kept while the yard stands still, and worked out again once it changes", () => {
  const y = create({ seed: 5, tier: 3 });
  const tiles = depotTiles(y);
  const first = markCovers(y, tiles);
  expect(markCovers(y, tiles)).toBe(first);
  // The rules count every command they do (`Yard.rev`); a copy turned and set back over its own tiles is one.
  y.rev++;
  expect(markCovers(y, tiles)).not.toBe(first);
  // Another yard (one read afresh, or the yard in hand) is never answered from this one's.
  expect(markCovers(create({ seed: 5, tier: 3 }), tiles)).not.toBe(markCovers(y, tiles));
});
