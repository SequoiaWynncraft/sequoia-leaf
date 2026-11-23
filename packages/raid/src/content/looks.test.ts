import { describe, expect, test } from "bun:test";

import { BASES, CLOTHS, LANTERNS, LOOK_KINDS, LOOKS, newLooks, owns, readLooks, wear } from "./looks.ts";

describe("the looks of the table", () => {
  test("everybody has the first look of each kind, and the rest cost Leaf", () => {
    const looks = newLooks();
    for (const kind of LOOK_KINDS) {
      const [first, ...rest] = LOOKS[kind];
      expect(first?.leaf).toBe(0);
      expect(first ? owns(looks, kind, first.id) : false).toBe(true);
      expect(rest.length).toBeGreaterThan(0);
      for (const look of rest) {
        expect(look.leaf).toBeGreaterThan(0);
        expect(owns(looks, kind, look.id)).toBe(false);
      }
    }
    looks.owned.push("gingham");
    expect(owns(looks, "cloth", "gingham")).toBe(true);
    // A cloth is not a lantern.
    expect(owns(looks, "lantern", "gingham")).toBe(false);
  });

  test("every look has a name of its own", () => {
    const ids = [...CLOTHS, ...LANTERNS, ...BASES].map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("only a look owned goes on the table, and only as its own kind", () => {
    const looks = newLooks();
    expect(wear(looks, "cloth", "plum")).toBe(false);
    looks.owned.push("plum");
    expect(wear(looks, "lantern", "plum")).toBe(false);
    expect(wear(looks, "cloth", "plum")).toBe(true);
    expect(looks.cloth).toBe("plum");
    expect(wear(looks, "cloth", "bare")).toBe(true);
  });

  test("are read back only as a member could have them: nothing worn that was not bought, nothing free listed as bought", () => {
    expect(readLooks(newLooks())).toEqual(newLooks());
    expect(readLooks({ cloth: "plum", lantern: "jar", bases: "gilt", owned: ["jar"] })).toEqual({
      ...newLooks(),
      lantern: "jar",
      owned: ["jar"],
    });
    expect(readLooks({ cloth: "plum", lantern: "jar", bases: "gilt", owned: ["plum", "jar", "gilt"] })).toEqual({
      cloth: "plum",
      lantern: "jar",
      bases: "gilt",
      owned: ["plum", "jar", "gilt"],
    });
    expect(readLooks({ ...newLooks(), owned: ["baize", "baize"] })).toBeNull();
    expect(readLooks({ ...newLooks(), owned: ["bare", "moss"] })).toEqual({ ...newLooks(), owned: ["moss"] });
    expect(readLooks({ ...newLooks(), cloth: "disco" })).toBeNull();
    expect(readLooks("bare")).toBeNull();
  });
});
