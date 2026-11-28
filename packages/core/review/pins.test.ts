import { describe, expect, test } from "bun:test";

import { changes, goldensIn, goldensText } from "./golden.ts";
import { keysOf, pinned, type Pins, pinsText, readPins, rowName, Seen } from "./pins.ts";

describe("the keys a value is written with", () => {
  test("are paths, a list's items under `[]`, and a record keyed by ids as one key, `*`", () => {
    const v = { a: 1, b: [{ c: 2 }, { d: 3 }], have: { "figure:greg": 2, "figure:moth": 1 } };
    expect([...keysOf(v, new Set(["have"]))].toSorted()).toEqual(["a", "b", "b[].c", "b[].d", "have", "have.*"]);
  });
  test("are gathered by shape and version, and the first row of each case is the one kept", () => {
    const seen = new Seen();
    seen.saw("yard", 9, { a: 1 }, { as: "small", text: "first" });
    seen.saw("yard", 9, { b: 1 }, { as: "small", text: "second" });
    seen.saw("yard", 11, { c: 1 });
    expect(seen.pins()).toEqual(
      new Map([
        [
          "yard",
          new Map([
            [9, ["a", "b"]],
            [11, ["c"]],
          ]),
        ],
      ]),
    );
    expect([...seen.rows]).toEqual([[rowName("yard", 9, "small"), "first"]]);
  });
});

describe("the pins", () => {
  const was: Pins = new Map([["yard", new Map([[9, ["a", "b"]]])]]);
  test("moved under the same version are refused, with what moved", () => {
    expect(pinned(was, new Map([["yard", new Map([[9, ["a", "c"]]])]])).refused).toEqual([
      "yard is written with other keys at version 9 (+c -b): a stored shape that changes takes a new version",
    ]);
  });
  test("under a new version are pinned beside the old, which keeps its keys", () => {
    const next = pinned(was, new Map([["yard", new Map([[11, ["a", "b", "c"]]])]]));
    expect(next.refused).toEqual([]);
    expect(next.pins.get("yard")).toEqual(
      new Map([
        [9, ["a", "b"]],
        [11, ["a", "b", "c"]],
      ]),
    );
  });
  test("read back as they are written", () => {
    const pins: Pins = new Map([
      ["yard", new Map([[9, ["a", "b"]]])],
      ["standing", new Map([[1, ["score"]]])],
    ]);
    const text = pinsText(pins);
    expect(text).toBe("standing 1\n  score\nyard 9\n  a\n  b\n");
    expect(readPins(text)).toEqual(pins);
  });
});

describe("how goldens differ", () => {
  test("a line a golden: changed in words, changed in a hash only, new, gone", () => {
    const was = [
      { id: "a", says: "won", hashes: "start 1 end 2" },
      { id: "b", says: "lost", hashes: "start 1 end 2" },
      { id: "c", says: "lost", hashes: "start 1 end 2" },
    ];
    const now = [
      { id: "a", says: "lost", hashes: "start 1 end 3" },
      { id: "b", says: "lost", hashes: "start 1 end 3" },
      { id: "d", says: "won", hashes: "start 4 end 5" },
    ];
    expect(changes(was, now)).toEqual([
      "  a: won -> lost",
      "  b: lost (end differs)",
      "+ d | won | start 4 end 5",
      "- c | lost | start 1 end 2",
    ]);
    expect(goldensIn(goldensText(now))).toEqual(now);
  });
});
