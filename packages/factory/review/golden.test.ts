import { describe, expect, test } from "bun:test";

import { readPostcard } from "@sequoia-leaf/core";
import { pinTests } from "@sequoia-leaf/core/review/checks.ts";
import { changes, type Golden } from "@sequoia-leaf/core/review/golden.ts";
import { keysOf, readsOtherwise, uncovered } from "@sequoia-leaf/core/review/pins.ts";

import { PARTS } from "../src/cells.ts";
import * as F from "../src/index.ts";
import { bytesOf, cases, PART_CASES, partYard, pinValue, seenNow, VERSIONS } from "./cases.ts";
import { longRuns, PINS, scriptLine, TIERS, written, yardLine, YARDS } from "./golden.ts";
import { SCRIPTS } from "./scripts.ts";
import { material } from "./state.ts";

/**
 * The goldens (`golden.ts`) against what the rules do now, and the pins against what the writer
 * cases write (`cases.ts`). A golden that differs fails with a line for each difference: regenerate
 * with `bun review/golden.ts --write`, and say why in the PR.
 */
const played = seenNow();
const yards = new Map<string, Golden & { readonly tier: number }>();
const yardsNow = (): (Golden & { readonly tier: number })[] =>
  YARDS.map(([name, make]) => {
    const line = yards.get(name) ?? yardLine(name, make, played);
    yards.set(name, line);
    return line;
  });
const scripts: Golden[] = [];
const scriptsNow = (): Golden[] => {
  if (scripts.length === 0) scripts.push(...SCRIPTS.map((s) => scriptLine(s, played)));
  return scripts;
};
const writers = seenNow();
cases(writers);

describe("the staged yards", () => {
  test.each(YARDS.map(([name]) => name))("%s runs on as written", (name) => {
    const its = (l: Golden): boolean => l.id === `yard ${name}`;
    const now = yardsNow().map(({ id, says, hashes }) => ({ id, says, hashes }));
    expect(changes(written("yards").filter(its), now.filter(its))).toEqual([]);
  });
  test("are every one the goldens have, and no other, at every tier a stager makes", () => {
    expect(written("yards").map((l) => l.id)).toEqual(yardsNow().map((l) => l.id));
    expect([...new Set(yardsNow().map((l) => l.tier))].toSorted((a, b) => a - b)).toEqual(TIERS);
  });
});

describe("the command scripts, off the wire", () => {
  test("each does and is refused as written, paid as written and free of the cap as written, to the yard it leaves", () => {
    expect(changes(written("scripts"), scriptsNow())).toEqual([]);
  });
});

describe("a yard brought on 8 hours", () => {
  test("ends as one yard in one go, in slices and in slices stored between, to its power and its letter", () => {
    expect(longRuns().apart).toEqual([]);
  });
  test("goes as written", () => {
    expect(changes(written("long"), longRuns().lines)).toEqual([]);
  });
});

describe("the keys each stored shape is written with", () => {
  test("hold everything the goldens see written: the cases miss no branch play takes", () => {
    yardsNow();
    scriptsNow();
    expect(uncovered(writers.pins(), played)).toEqual([]);
  });
  test("of a plan of the whole yard keep every key beside its packed pieces", () => {
    const kept = PINS.rows("yard").find((r) => r.path.endsWith("yard-v9-full.json"));
    if (!kept) throw new Error("no full row of version 9");
    const raw: { blueprints: unknown[] } = JSON.parse(kept.row.text);
    for (const b of raw.blueprints) if (typeof b === "object" && b !== null) Object.assign(b, { flags: 9 });
    expect(keysOf(pinValue(JSON.stringify(raw)), new Set())).toContain("blueprints[].flags");
  });
});

describe("a piece's bytes", () => {
  test.each(PART_CASES.map((p) => [p.name, p] as const))("%s is written with its bit", (_, part) => {
    const { bits } = bytesOf(F.FACTORY.encode(partYard(part)));
    expect(part.bit === 0 ? bits & 1 : bits & part.bit).toBe(part.bit === 0 ? 1 : part.bit);
  });
  test("every part this Leaf reads is one the writer cases write", () => {
    const bits = PART_CASES.reduce((all, p) => all | bytesOf(F.FACTORY.encode(partYard(p))).bits, 0);
    expect(PARTS & ~bits).toBe(0);
  });
});

const yardRows = PINS.rows("yard");

describe("every yard row kept", () => {
  test.each(yardRows.map((r) => [r.path, r] as const))(
    "%s reads, on its first read, as it was written, reads the same once stored again, and runs on",
    (path, { row, version }) => {
      expect(JSON.parse(row.text).v).toBe(version);
      const y = F.FACTORY.decode(row.text);
      if (!y) throw new Error("does not read");
      // A row of `test/saves` says what it read as in its own terms, which `saves.test.ts` holds it to.
      if (path.startsWith("stored/")) expect(readsOtherwise(row.read, material(y))).toEqual([]);
      const again = F.FACTORY.decode(F.FACTORY.encode(y));
      if (!again) throw new Error("does not read once stored again");
      expect(readsOtherwise(material(y), material(again))).toEqual([]);
      for (let k = 0; k < 10; k++) F.step(y);
      expect(F.FACTORY.decode(F.FACTORY.encode(y))).not.toBeNull();
    },
  );
  test("are of every version a Leaf ever wrote, and of each version the writer writes now", () => {
    const versions = new Set(yardRows.map((r) => r.version));
    // 10 no Leaf wrote: it kept a yard as 10 only for a kind past 15, and none was there to keep.
    for (const v of [3, 6, 7, 8, ...(VERSIONS.yard ?? [])]) expect(versions.has(v)).toBe(true);
  });
});

describe("every standing, postcard and log row kept", () => {
  pinTests(PINS, () => writers, VERSIONS, "works_");
  test.each(PINS.rows("postcard").map((r) => [r.path, r.row] as const))(
    "%s reads as the town reads a postcard",
    (_, row) => {
      expect(row.read).toEqual(readPostcard(JSON.parse(row.text)));
    },
  );
});
