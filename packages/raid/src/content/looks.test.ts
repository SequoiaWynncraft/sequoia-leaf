import { describe, expect, test } from "bun:test";

import { LOOK_KINDS, LOOKS, newLooks, owns, readLooks, tryOn, wear } from "./looks.ts";

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
    const ids = LOOK_KINDS.flatMap((kind) => LOOKS[kind]).map((l) => l.id);
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

  test("the place is a look like the others: the clearing is everybody's, the hall is bought, chosen and kept", () => {
    const looks = newLooks();
    expect(looks.place).toBe("clearing");
    expect(wear(looks, "place", "hall")).toBe(false);
    // Trying it on shows it and changes nothing.
    expect(tryOn(looks, "place", "hall").place).toBe("hall");
    expect(tryOn(looks, "cloth", "hall")).toEqual(looks);
    expect(looks.place).toBe("clearing");
    looks.owned.push("hall");
    expect(wear(looks, "cloth", "hall")).toBe(false);
    expect(wear(looks, "place", "hall")).toBe(true);
    expect(readLooks(structuredClone(looks))).toEqual(looks);
    expect(wear(looks, "place", "clearing")).toBe(true);
    expect(looks).toEqual({ ...newLooks(), owned: ["hall"] });
  });

  test("looks kept before the table had a place are in the clearing", () => {
    const old = { cloth: "plum", lantern: "iron", bases: "plain", owned: ["plum"] };
    expect(readLooks(old)).toEqual({ ...newLooks(), cloth: "plum", owned: ["plum"] });
    expect(readLooks({ ...old, place: "hall" })?.place).toBe("clearing");
    expect(readLooks({ ...old, place: "hall", owned: ["plum", "hall"] })?.place).toBe("hall");
    expect(readLooks({ ...old, place: "moon" })).toBeNull();
  });

  test("are read back only as a member could have them: nothing worn that was not bought, nothing free listed as bought", () => {
    expect(readLooks(newLooks())).toEqual(newLooks());
    expect(readLooks({ cloth: "plum", lantern: "jar", bases: "gilt", owned: ["jar"] })).toEqual({
      ...newLooks(),
      lantern: "jar",
      owned: ["jar"],
    });
    expect(readLooks({ cloth: "plum", lantern: "jar", bases: "gilt", owned: ["plum", "jar", "gilt"] })).toEqual({
      place: "clearing",
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
