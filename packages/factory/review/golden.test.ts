import { describe, expect, test } from "bun:test";

import { changes, type Golden } from "@sequoia-leaf/core/review/golden.ts";
import { keysOf, Pinned, pinsNow } from "@sequoia-leaf/core/review/pins.ts";

import * as F from "../src/index.ts";
import { longLines, PINS, pinValue, scriptLine, seenNow, VERSIONS, written, yardLine, YARDS } from "./golden.ts";
import { SCRIPTS } from "./scripts.ts";

/**
 * The goldens (`golden.ts`) against what the rules do now. A golden that differs fails with a line
 * for each difference: regenerate with `bun review/golden.ts --write`, and say why in the PR.
 */
const seen = seenNow();
const yards = new Map<string, Golden>();
const yardsNow = (): Golden[] =>
  YARDS.map(([name, make]) => {
    const line = yards.get(name) ?? yardLine(name, make, seen);
    yards.set(name, line);
    return line;
  });
const scripts: Golden[] = [];
const scriptsNow = (): Golden[] => {
  if (scripts.length === 0) scripts.push(...SCRIPTS.map((s) => scriptLine(s, seen)));
  return scripts;
};

describe("the staged yards", () => {
  test.each(YARDS.map(([name]) => name))("%s runs on as written", (name) => {
    const its = (l: Golden): boolean => l.id === `yard ${name}`;
    expect(changes(written("yards").filter(its), yardsNow().filter(its))).toEqual([]);
  });
  test("are every one the goldens have, and no other", () => {
    expect(written("yards").map((l) => l.id)).toEqual(yardsNow().map((l) => l.id));
  });
});

describe("the command scripts, off the wire", () => {
  test("each does and is refused as written, to the yard it leaves", () => {
    expect(changes(written("scripts"), scriptsNow())).toEqual([]);
  });
});

describe("a yard brought on 8 hours", () => {
  test("in one go, in slices and in slices stored between, goes as written", () => {
    expect(changes(written("long"), longLines())).toEqual([]);
  });
});

describe("the keys each stored shape is written with", () => {
  test("are pinned beside its version, and are the keys pinned there; every row first seen is kept", () => {
    yardsNow();
    scriptsNow();
    expect(pinsNow(PINS, seen, VERSIONS)).toEqual({ refused: [], unpinned: [], unkept: [] });
  });
});

const rows = PINS.rows("yard");
const MAPS = seenNow().maps.yard ?? new Set<string>();

describe("every yard row the goldens keep", () => {
  test("is there for every version a Leaf ever wrote: 10 none did, for no kind past 15 was there to keep", () => {
    const versions = [...new Set(rows.map(([name]) => Pinned.versionOf(name)))].toSorted((a, b) => a - b);
    expect(versions).toEqual([3, 6, 7, 8, 9, F.VERSION]);
  });
  test.each(rows)("%s reads, reads the same once stored again, and runs on", (_, text) => {
    const y = F.decode(text);
    if (!y) throw new Error("does not read");
    const again = F.decode(F.encode(y));
    expect(again && F.encode(again)).toBe(F.encode(y));
    for (let k = 0; k < 10; k++) F.step(y);
    expect(F.decode(F.encode(y))).not.toBeNull();
  });
  test.each(rows.filter(([name]) => Pinned.versionOf(name) >= F.PLACED))(
    "%s has no key its version's pin does not hold",
    (name, text) => {
      const pin = PINS.written().get("yard")?.get(Pinned.versionOf(name)) ?? [];
      expect([...keysOf(pinValue(text), MAPS)].filter((k) => !pin.includes(k))).toEqual([]);
    },
  );
});
