import { describe, expect, test } from "bun:test";

import { newCamp } from "./camp.ts";
import { letter } from "./mail.ts";
import { blank, dayOf, type Kept, minutesAway, parse, VERSION, write } from "./save.ts";

const camp = newCamp();
camp.first = "cat";
camp.tray = { gnome: 2 };
camp.parcels = ["well"];
camp.letters = [letter("m-1", "Tindra", "A mushroom, for your gate.", "toadstool")];

const full: Kept = {
  owned: ["crown", "jar", "bread"],
  wearing: ["crown"],
  claimed: ["raids"],
  sightings: 4,
  welcomed: "2026-11-21",
  chest: "2026-11-20",
  lastSeen: 1_795_000_000_000,
  cursor: 1204,
  stay: false,
  camp,
};

describe("the town's kept record", () => {
  test("comes back as it was written", () => {
    expect(parse(write(full))).toEqual(full);
  });

  test("nothing kept, or nonsense, is nothing", () => {
    for (const text of [null, undefined, "", "town", "[]", "null", "42", '{"owned":["crown"]}'])
      expect(parse(text)).toBeNull();
  });

  test("another version starts over", () => {
    expect(parse(JSON.stringify({ ...full, v: VERSION + 1 }))).toBeNull();
    expect(parse(JSON.stringify({ ...full, v: "1" }))).toBeNull();
  });

  test("a part that makes no sense is put back, and the rest kept", () => {
    const kept = parse(
      JSON.stringify({
        v: VERSION,
        owned: ["crown", 7, "crown", "<script>", null, "jar"],
        wearing: "crown",
        claimed: { raids: true },
        sightings: "lots",
        welcomed: "yesterday",
        chest: 20261120,
        lastSeen: -5,
        cursor: -3,
      }),
    );
    expect(kept).toEqual({ ...blank(), owned: ["crown", "jar"] });
  });

  test("nobody wears what they do not own", () => {
    const kept = parse(JSON.stringify({ v: VERSION, owned: ["jar"], wearing: ["crown", "jar"] }));
    expect(kept?.wearing).toEqual(["jar"]);
  });

  test("counts are whole and never below nothing", () => {
    expect(parse(JSON.stringify({ v: VERSION, sightings: 3.9 }))?.sightings).toBe(3);
    expect(parse(JSON.stringify({ v: VERSION, sightings: -2 }))?.sightings).toBe(0);
    expect(parse(JSON.stringify({ v: VERSION, sightings: 1e99 }))?.sightings).toBe(1e6);
  });

  test("a missing part is a new member's", () => {
    expect(parse(JSON.stringify({ v: VERSION }))).toEqual(blank());
  });

  test("a member's character stays in town after they go unless they said it should not", () => {
    expect(blank().stay).toBe(true);
    for (const stay of [true, undefined, "no", 0, null])
      expect(parse(JSON.stringify({ v: VERSION, stay }))?.stay).toBe(true);
    expect(parse(JSON.stringify({ v: VERSION, stay: false }))?.stay).toBe(false);
  });

  test("a record from before there were camps keeps what it had, and gets a new camp", () => {
    const old = parse(JSON.stringify({ v: VERSION, owned: ["crown"], sightings: 2 }));
    expect(old?.owned).toEqual(["crown"]);
    expect(old?.camp).toEqual(newCamp());
  });

  test("a camp that makes no sense is a new camp, and the rest is kept", () => {
    const kept = parse(JSON.stringify({ v: VERSION, owned: ["jar"], camp: { placed: 12 } }));
    expect(kept).toEqual({ ...blank(), owned: ["jar"] });
  });

  test("days are written the local way", () => {
    expect(dayOf(new Date(2026, 10, 3, 23, 59).getTime())).toBe("2026-11-03");
    expect(dayOf(new Date(2027, 0, 1, 0, 0).getTime())).toBe("2027-01-01");
  });

  test("time away is never negative, and never counted for a first visit", () => {
    const now = 1_795_000_600_000;
    expect(minutesAway(full, now)).toBe(10);
    expect(minutesAway(full, full.lastSeen - 60_000)).toBe(0);
    expect(minutesAway(blank(), now)).toBe(0);
  });
});
