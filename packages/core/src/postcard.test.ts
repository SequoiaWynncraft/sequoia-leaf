/**
 * A postcard off the wire (`readPostcard`): what is waiting, the till, and the lights a game has put in
 * the town's sky, each a short name, a few at most; a sky that is anything else is let go and the
 * postcard still reads, as one from a Leaf that names none.
 */
import { describe, expect, test } from "bun:test";

import { readPostcard, readPostcards } from "./postcard.ts";

describe("a postcard's lights in the town's sky", () => {
  test("are read as named, and a postcard naming none has none", () => {
    expect(readPostcard({ waiting: "Quiet.", till: 3, sky: ["sky-beacon"] })).toEqual({
      waiting: "Quiet.",
      till: 3,
      sky: ["sky-beacon"],
    });
    expect(readPostcard({ waiting: "Quiet.", till: 3 })).toEqual({ waiting: "Quiet.", till: 3 });
    expect(readPostcards({ works: { waiting: "Quiet.", till: 0, sky: ["sky-beacon"] } }).works?.sky).toEqual([
      "sky-beacon",
    ]);
  });

  test("anything else is let go, and the postcard still reads", () => {
    for (const sky of ["sky-beacon", [1], [""], ["x".repeat(41)], Array.from({ length: 9 }, () => "a"), null, {}])
      expect(readPostcard({ waiting: "Quiet.", till: 1, sky })).toEqual({ waiting: "Quiet.", till: 1 });
  });
});
