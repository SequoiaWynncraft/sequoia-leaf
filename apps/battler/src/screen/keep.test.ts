import { afterEach, describe, expect, test } from "bun:test";

import { type Standin, standin } from "@sequoia-leaf/kit/standin.ts";

import { keepPrefs, loadPrefs, newPrefs, PREFS_VERSION, readPrefs, savePrefs } from "./keep.ts";
import { NUDGES } from "./logic.ts";

const kept = (prefs: unknown, v: unknown = PREFS_VERSION): string =>
  JSON.stringify({ game: "little-raid-prefs", v, prefs });

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
});

describe("what the table keeps in the browser", () => {
  test("only how fast fights are watched and the nudges given, as they were saved", () => {
    const prefs = newPrefs();
    prefs.speed = 4;
    prefs.taught = ["pick", "buy"];
    expect(loadPrefs(savePrefs(prefs))).toEqual(prefs);
    expect(Object.keys(prefs).toSorted()).toEqual(["speed", "taught"]);
  });

  test("every nudge given comes back", () => {
    const prefs = newPrefs();
    prefs.taught = [...NUDGES];
    expect(loadPrefs(savePrefs(prefs))).toEqual(prefs);
  });

  test("of what an older page kept under the same name, only those two are read: the table is Leaf's", () => {
    const old = kept({
      cloth: "plum",
      lantern: "jar",
      bases: "gilt",
      owned: ["plum", "jar", "gilt"],
      speed: 2,
      trail: 2,
      taught: ["pick"],
    });
    expect(loadPrefs(old)).toEqual({ speed: 2, taught: ["pick"] });
  });

  test("text that is not this version's prefs starts over", () => {
    expect(loadPrefs(null)).toEqual(newPrefs());
    expect(loadPrefs("")).toEqual(newPrefs());
    expect(loadPrefs("{nonsense")).toEqual(newPrefs());
    expect(loadPrefs(JSON.stringify({ game: "something-else", v: PREFS_VERSION, prefs: {} }))).toEqual(newPrefs());
    expect(loadPrefs(kept({ speed: 4 }, PREFS_VERSION + 1))).toEqual(newPrefs());
    expect(loadPrefs(kept([]))).toEqual(newPrefs());
  });

  test("each part that makes no sense is put back to a new member's, and nudges without repeats or nonsense", () => {
    expect(loadPrefs(kept({ speed: 3, taught: "yes" }))).toEqual(newPrefs());
    expect(loadPrefs(kept({ speed: 2 })).speed).toBe(2);
    expect(loadPrefs(kept({ taught: ["pick", "pick", 4, "buy", "x".repeat(80)] })).taught).toEqual(["pick", "buy"]);
  });

  test("they are written into the browser, and read back", () => {
    world = standin({});
    const prefs = { speed: 2 as const, taught: ["pick"] };
    keepPrefs(prefs);
    expect(readPrefs()).toEqual(prefs);
  });
});
