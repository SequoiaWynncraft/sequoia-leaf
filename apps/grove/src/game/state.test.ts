import { describe, expect, test } from "bun:test";

import {
  advance,
  AWAY_CAP_MS,
  fresh,
  grow,
  growCost,
  leaflingCost,
  leaflingRoom,
  load,
  MAX_LEVEL,
  rate,
  type Save,
  short,
  store,
  tap,
  welcome,
} from "./state.ts";

const at = (over: Partial<Save>): Save => ({ ...fresh(0), ...over });
const memory = (): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe("sap", () => {
  test("a grove makes sap while away, at its rate", () => {
    const s = at({ level: 2, leaflings: 1 });
    const a = advance(s, 60_000);
    expect(a.gained).toBeCloseTo(rate(s) * 60, 6);
    expect(a.save.sap).toBeCloseTo(a.gained, 6);
    expect(a.save.seen).toBe(60_000);
    expect(a.capped).toBe(false);
  });
  test("it stops at a day, so nobody has to come back daily", () => {
    const s = at({ level: 3 });
    const a = advance(s, AWAY_CAP_MS * 3);
    expect(a.gained).toBeCloseTo((rate(s) * AWAY_CAP_MS) / 1000, 3);
    expect(a.capped).toBe(true);
  });
  test("a clock that went backwards gives nothing and loses nothing", () => {
    const a = advance(at({ sap: 5, seen: 1000 }), 500);
    expect(a.gained).toBe(0);
    expect(a.save.sap).toBe(5);
  });
  test("a tap always gives something", () => {
    expect(tap(at({})).sap).toBeGreaterThanOrEqual(1);
  });
});

describe("spending", () => {
  test("growing costs sap and adds a ring", () => {
    const s = at({ sap: 100 });
    const g = grow(s);
    expect(g?.level).toBe(1);
    expect(g?.sap).toBe(100 - (growCost(s) ?? 0));
  });
  test("nothing is done without the sap for it", () => {
    expect(grow(at({ sap: 1 }))).toBeNull();
    expect(welcome(at({ sap: 1 }))).toBeNull();
  });
  test("a full-grown tree grows no more", () => {
    const s = at({ level: MAX_LEVEL, sap: 1e12 });
    expect(growCost(s)).toBeNull();
    expect(grow(s)).toBeNull();
  });
  test("leaflings need room, and the tree makes room as it grows", () => {
    const full = at({ leaflings: 2, sap: 1e9 });
    expect(leaflingRoom(full)).toBe(2);
    expect(leaflingCost(full)).toBeNull();
    expect(welcome({ ...full, level: 2 })?.leaflings).toBe(3);
  });
  test("every ring costs more than the last and pays more than the last", () => {
    for (let level = 0; level < MAX_LEVEL - 1; level++) {
      expect(growCost(at({ level: level + 1 })) ?? 0).toBeGreaterThan(growCost(at({ level })) ?? 0);
      expect(rate(at({ level: level + 1 }))).toBeGreaterThan(rate(at({ level })));
    }
  });
  test("the next ring is always within reach: under two days of waiting with a full grove", () => {
    for (let level = 0; level < MAX_LEVEL; level++) {
      const s = at({ level, leaflings: leaflingRoom(at({ level })) });
      expect((growCost(s) ?? 0) / rate(s)).toBeLessThan(2 * 24 * 3600);
    }
  });
});

describe("saving", () => {
  test("a grove comes back as it was left", () => {
    const m = memory();
    const s = at({ sap: 12.5, level: 4, leaflings: 2, seen: 77, total: 900 });
    store(m, s);
    expect(load(m, 100)).toEqual(s);
  });
  test("a broken or foreign save gives a fresh grove", () => {
    const m = memory();
    m.setItem("grove.save.v1", "{not json");
    expect(load(m, 5)).toEqual(fresh(5));
    m.setItem("grove.save.v1", JSON.stringify({ v: 1, sap: -4, level: 1, leaflings: 0, seen: 0, total: 0 }));
    expect(load(m, 5)).toEqual(fresh(5));
  });
  test("a save from the future cannot be cashed in", () => {
    const m = memory();
    store(m, at({ seen: 9_999_999 }));
    expect(load(m, 1000).seen).toBe(1000);
  });
});

test("numbers read short", () => {
  expect(short(0)).toBe("0");
  expect(short(1234.9)).toBe("1,234");
  expect(short(12_345)).toBe("12.3k");
  expect(short(4_560_000)).toBe("4.6M");
});
