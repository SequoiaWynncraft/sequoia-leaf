import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { canonical, changes, goldensIn, goldensText, hashOf } from "./golden.ts";
import {
  keysOf,
  Pinned,
  pinned,
  type Pins,
  pinsNow,
  pinsText,
  readPins,
  readsOtherwise,
  rowName,
  Seen,
  uncovered,
} from "./pins.ts";

describe("the keys a value is written with", () => {
  test("are paths, a list's items under `[]`, and a record keyed by ids as one key, `*`", () => {
    const v = { a: 1, b: [{ c: 2 }, { d: 3 }], have: { "figure:greg": 2, "figure:moth": 1 } };
    expect([...keysOf(v, new Set(["have"]))].toSorted()).toEqual(["a", "b", "b[].c", "b[].d", "have", "have.*"]);
  });
  test("are gathered by shape and version, and the first row of each case is the one kept", () => {
    const seen = new Seen();
    seen.saw("yard", 9, { a: 1 }, { as: "small", text: "first", read: 1 });
    seen.saw("yard", 9, { b: 1 }, { as: "small", text: "second", read: 2 });
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
    expect([...seen.rows]).toEqual([
      [rowName("yard", 9, "small"), { shape: "yard", version: 9, row: { text: "first", read: 1 } }],
    ]);
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

/** An empty folder for a game's pins. */
const folder = (): Pinned => new Pinned(pathToFileURL(`${mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "pins-"))}/`));

describe("a game's pins on disk", () => {
  test("stop at a shape seen at a version not said, or said and never seen, and at a row listed and gone", () => {
    const at = folder();
    writeFileSync(new URL("inventory.txt", at.dir), "yard 9 stored/yard-v9-gone.json\n");
    const seen = new Seen();
    seen.saw("yard", 9, { a: 1 });
    seen.saw("pulls_new", 1, { b: 1 });
    expect(pinsNow(at, seen, { yard: [9, 11] })).toEqual({
      refused: [],
      undeclared: ["pulls_new 1 is written, and not said", "yard 11 is said, and never seen written"],
      unpinned: ["yard 9 is not pinned yet", "yard 11 is not pinned yet"],
      unkept: [],
      lost: ["stored/yard-v9-gone.json is listed, and gone"],
    });
  });
  test("what other writers write is held to the cases': a key no case writes, a version none writes", () => {
    const cases = new Seen();
    cases.saw("yard", 9, { a: 1 });
    const other = new Seen();
    other.saw("yard", 9, { a: 1, b: 2 });
    other.saw("yard", 11, { a: 1 });
    expect(uncovered(cases.pins(), other)).toEqual([
      "yard 9 is written with b, which no case writes",
      "yard 11 is written, and no case writes it",
    ]);
  });
});

describe("a stored row read", () => {
  test("is as it says where it says, and may have more beside", () => {
    expect(readsOtherwise({ a: 1, b: [{ c: 2 }] }, { a: 1, b: [{ c: 2, d: 3 }], e: 4 })).toEqual([]);
    expect(readsOtherwise({ a: 1, b: [{ c: 2 }] }, { a: 2, b: [] })).toEqual(["a", "b"]);
    expect(readsOtherwise({ b: [{ c: 2 }] }, { b: [{ c: 3 }] })).toEqual(["b[0].c"]);
  });
});

describe("a hash", () => {
  test("is of a record's keys in order, whatever order they were written in, and of a list's in its own", () => {
    expect(hashOf({ order: 1, title: "a", pay: 2 })).toBe(hashOf({ pay: 2, title: "a", order: 1 }));
    expect(hashOf([1, 2])).not.toBe(hashOf([2, 1]));
    expect(canonical({ b: { d: 1, c: 2 }, a: [3] })).toEqual({ a: [3], b: { c: 2, d: 1 } });
  });
});
