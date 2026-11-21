import { describe, expect, test } from "bun:test";

import {
  BASES,
  CLOTHS,
  LANTERNS,
  loadPrefs,
  LOOK_KINDS,
  LOOKS,
  newPrefs,
  owns,
  PREFS_VERSION,
  savePrefs,
} from "./keep.ts";

const kept = (prefs: unknown, v: unknown = PREFS_VERSION): string =>
  JSON.stringify({ game: "little-raid-prefs", v, prefs });

describe("what the table keeps", () => {
  test("prefs come back as they were saved", () => {
    const prefs = newPrefs();
    prefs.owned = ["baize", "jar"];
    prefs.cloth = "baize";
    prefs.lantern = "jar";
    prefs.speed = 4;
    prefs.trail = 1;
    prefs.taught = ["pick", "buy"];
    expect(loadPrefs(savePrefs(prefs))).toEqual(prefs);
  });

  test("text that is not this version's prefs starts over", () => {
    expect(loadPrefs(null)).toEqual(newPrefs());
    expect(loadPrefs("")).toEqual(newPrefs());
    expect(loadPrefs("{nonsense")).toEqual(newPrefs());
    expect(loadPrefs(JSON.stringify({ game: "something-else", v: PREFS_VERSION, prefs: {} }))).toEqual(newPrefs());
    expect(loadPrefs(kept({ speed: 4 }, PREFS_VERSION + 1))).toEqual(newPrefs());
    expect(loadPrefs(kept([]))).toEqual(newPrefs());
  });

  test("each part that makes no sense is put back to a new member's", () => {
    const prefs = loadPrefs(
      kept({ cloth: 7, lantern: "disco", bases: null, owned: "all", speed: 3, trail: 9, taught: "yes" }),
    );
    expect(prefs).toEqual(newPrefs());
    expect(loadPrefs(kept({ speed: 2, trail: 2 })).speed).toBe(2);
    expect(loadPrefs(kept({ speed: 2, trail: 2 })).trail).toBe(2);
  });

  test("a look that was never bought is not worn, whatever the text says", () => {
    const sneaky = loadPrefs(kept({ cloth: "plum", lantern: "jar", bases: "gilt", owned: [] }));
    expect([sneaky.cloth, sneaky.lantern, sneaky.bases]).toEqual(["bare", "iron", "plain"]);
    const bought = loadPrefs(kept({ cloth: "plum", lantern: "jar", bases: "gilt", owned: ["plum", "gilt"] }));
    expect([bought.cloth, bought.lantern, bought.bases]).toEqual(["plum", "iron", "gilt"]);
  });

  test("only looks that are for sale can be owned, and each once", () => {
    const prefs = loadPrefs(kept({ owned: ["baize", "baize", "bare", "a crown", 3, "moss"] }));
    expect(prefs.owned).toEqual(["baize", "moss"]);
  });

  test("the nudges given are kept, without repeats or nonsense", () => {
    const prefs = loadPrefs(kept({ taught: ["pick", "pick", 4, "buy", "x".repeat(80)] }));
    expect(prefs.taught).toEqual(["pick", "buy"]);
  });

  test("everybody has the first look of each kind, and the rest cost Leaf", () => {
    const prefs = newPrefs();
    for (const kind of LOOK_KINDS) {
      const [first, ...rest] = LOOKS[kind];
      expect(first?.leaf).toBe(0);
      expect(first ? owns(prefs, kind, first.id) : false).toBe(true);
      expect(rest.length).toBeGreaterThan(0);
      for (const look of rest) {
        expect(look.leaf).toBeGreaterThan(0);
        expect(owns(prefs, kind, look.id)).toBe(false);
      }
    }
    prefs.owned.push("gingham");
    expect(owns(prefs, "cloth", "gingham")).toBe(true);
    // A cloth is not a lantern.
    expect(owns(prefs, "lantern", "gingham")).toBe(false);
  });

  test("every look has a name of its own", () => {
    const ids = [...CLOTHS, ...LANTERNS, ...BASES].map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
