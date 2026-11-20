import { describe, expect, test } from "bun:test";

import { KINDS, PITY, RATES, TREANT } from "./spirits.ts";
import {
  advance,
  AWAY_CAP_MS,
  BLOOM_WATERS,
  bonus,
  coneCost,
  CONES_MAX,
  forage,
  fresh,
  grow,
  growCost,
  load,
  MAX_LEVEL,
  open,
  rankOf,
  rate,
  type Save,
  short,
  stoke,
  STOKE_MS,
  store,
  tap,
  water,
  WATER_EVERY_MS,
  WATER_MAX,
} from "./state.ts";

const at = (over: Partial<Save>): Save => ({ ...fresh(0), ...over });
const memory = (): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe("sap", () => {
  test("a grove makes sap while away, at its rate", () => {
    const s = at({ level: 2, spirits: { glorp: 1 } });
    const a = advance(s, 60_000);
    expect(a.gained).toBeCloseTo(rate(s) * 60, 6);
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
    expect(a.save.seen).toBe(1000);
  });
  test("a stoked fire adds half again, only while it burns", () => {
    const s = stoke(at({ level: 1 }), 0);
    expect(advance(s, STOKE_MS).gained).toBeCloseTo((rate(s) * 1.5 * STOKE_MS) / 1000, 6);
    expect(advance(s, STOKE_MS * 2).gained).toBeCloseTo((rate(s) * 2.5 * STOKE_MS) / 1000, 6);
  });
  test("a tap always gives something", () => {
    expect(tap(at({})).sap).toBeGreaterThanOrEqual(1);
  });
});

describe("the tree", () => {
  test("growing costs sap and adds a ring", () => {
    const s = at({ sap: 100 });
    expect(grow(s)?.level).toBe(1);
    expect(grow(s)?.sap).toBe(100 - (growCost(s) ?? 0));
    expect(grow(at({ sap: 1 }))).toBeNull();
  });
  test("a full-grown tree grows no more", () => {
    expect(grow(at({ level: MAX_LEVEL, sap: 1e12 }))).toBeNull();
  });
  test("every ring costs more than the last and pays more than the last", () => {
    for (let level = 0; level < MAX_LEVEL - 1; level++) {
      expect(growCost(at({ level: level + 1 })) ?? 0).toBeGreaterThan(growCost(at({ level })) ?? 0);
      expect(rate(at({ level: level + 1 }))).toBeGreaterThan(rate(at({ level })));
    }
  });
});

describe("care", () => {
  test("watering uses a charge, pays sap and fills the bloom; a full bloom drops a cone", () => {
    let s = at({ water: WATER_MAX, cones: 0 });
    for (let i = 0; i < BLOOM_WATERS; i++) {
      const w = water(s);
      expect(w).not.toBeNull();
      expect(w!.cone).toBe(i === BLOOM_WATERS - 1);
      s = w!.save;
    }
    expect(s.cones).toBe(1);
    expect(s.bloom).toBe(0);
    expect(s.water).toBe(WATER_MAX - BLOOM_WATERS);
    expect(s.sap).toBeGreaterThan(0);
  });
  test("no water, no watering; waterings come back with time and never past the brim", () => {
    expect(water(at({ water: 0.9 }))).toBeNull();
    expect(advance(at({ water: 0 }), WATER_EVERY_MS * 2).save.water).toBeCloseTo(2, 6);
    expect(advance(at({ water: 4 }), WATER_EVERY_MS * 50).save.water).toBe(WATER_MAX);
  });
  test("a grove full of cones keeps its bloom until there is room", () => {
    const w = water(at({ water: 1, bloom: 0.9, cones: CONES_MAX }));
    expect(w!.cone).toBe(false);
    expect(w!.save.bloom).toBe(1);
  });
  test("a cone can be foraged for sap, dearer each time, while there is room", () => {
    const s = at({ sap: 1e6, cones: 0 });
    const f = forage(s)!;
    expect(f.cones).toBe(1);
    expect(coneCost(f) ?? 0).toBeGreaterThan(coneCost(s) ?? 0);
    expect(forage(at({ sap: 1e6, cones: CONES_MAX }))).toBeNull();
  });
});

describe("cones", () => {
  test("the published rates add to a hundred, and every rank has a spirit", () => {
    expect(RATES.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    for (let r = 0; r < RATES.length; r++) expect(KINDS.some((k) => k.rank === r)).toBe(true);
  });
  test("a roll gives ranks in the published shares", () => {
    const n = 200_000;
    const seen = RATES.map(() => 0);
    for (let i = 0; i < n; i++) seen[rankOf((i + 0.5) / n, 0)]!++;
    RATES.forEach((p, r) => expect((seen[r]! / n) * 100).toBeCloseTo(p, 1));
  });
  test("a Treant or better within the pity, whatever the roll", () => {
    expect(rankOf(0, PITY - 1)).toBeGreaterThanOrEqual(TREANT);
    expect(rankOf(0.5, PITY - 2)).toBeLessThan(TREANT);
    let s = at({ cones: 1 });
    for (let i = 0; i < PITY; i++) {
      const o = open({ ...s, cones: 1 }, 0, 0)!;
      s = o.save;
      if (i < PITY - 1) expect(o.kind.rank).toBe(0);
      else expect(o.kind.rank).toBeGreaterThanOrEqual(TREANT);
    }
    expect(s.pity).toBe(0);
  });
  test("a first spirit is new and raises what the tree makes; more of it deepen the bond, then leave sap", () => {
    const first = open(at({ cones: 9 }), 0, 0)!;
    expect(first.isNew).toBe(true);
    expect(first.hearts).toBe(0);
    expect(rate(first.save)).toBeGreaterThan(rate(at({})));
    let s = first.save;
    let last = first;
    for (let i = 0; i < 4; i++) {
      const b = bonus(s);
      last = open({ ...s, cones: 1 }, 0, 0)!;
      expect(last.isNew).toBe(false);
      expect(bonus(last.save)).toBeGreaterThan(b);
      s = last.save;
    }
    expect(last.hearts).toBe(4);
    const over = open({ ...s, cones: 1 }, 0, 0)!;
    expect(over.gift).toBeGreaterThan(0);
    expect(bonus(over.save)).toBe(bonus(s));
  });
  test("no cone, nothing to open", () => {
    expect(open(at({ cones: 0 }), 0.5, 0.5)).toBeNull();
  });
});

describe("saving", () => {
  test("a grove comes back as it was left", () => {
    const m = memory();
    const s = at({
      sap: 12.5,
      level: 4,
      seen: 77,
      total: 900,
      spirits: { glorp: 2, fox: 1 },
      pity: 7,
      opened: 9,
      bloom: 0.5,
    });
    store(m, s);
    expect(load(m, 100)).toEqual(s);
  });
  test("a broken or foreign save gives a fresh grove", () => {
    const m = memory();
    m.setItem("grove.save.v2", "{not json");
    expect(load(m, 5)).toEqual(fresh(5));
    m.setItem("grove.save.v2", JSON.stringify({ ...at({}), sap: -4 }));
    expect(load(m, 5)).toEqual(fresh(5));
  });
  test("a grove from the first version keeps its sap and its tree", () => {
    const m = memory();
    m.setItem("grove.save.v1", JSON.stringify({ v: 1, sap: 40, level: 3, leaflings: 2, seen: 0, total: 99 }));
    const s = load(m, 5);
    expect([s.sap, s.level, s.total, s.cones]).toEqual([40, 3, 99, 1]);
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
