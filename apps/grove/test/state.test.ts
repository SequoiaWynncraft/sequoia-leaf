import { describe, expect, test } from "bun:test";

import { BLOOM_MAX, CONE_PRICE, VERDANT_AT } from "../src/game/rules.ts";
import {
  buy,
  care,
  freshState,
  groot,
  type GroveState,
  parseState,
  pour,
  warmCones,
  waterFriend,
} from "../src/game/state.ts";

const never = (): number => 0.5;

describe("the saved model", () => {
  test("starts afresh from nothing, a broken save or another version", () => {
    expect(parseState(null)).toEqual(freshState());
    expect(parseState("{not json")).toEqual(freshState());
    expect(parseState(JSON.stringify({ version: 2, leaf: 1 }))).toEqual(freshState());
  });

  test("keeps what it saved and fills the rest", () => {
    const saved = { ...freshState(), leaf: 777, owned: ["fruma-fern"], spirits: { rock: { count: 2, verdant: true } } };
    const back = parseState(JSON.stringify(saved));
    expect(back.leaf).toBe(777);
    expect(back.owned).toEqual(["fruma-fern"]);
    expect(back.spirits["rock"]).toEqual({ count: 2, verdant: true });
  });

  test("drops values of the wrong kind rather than trusting them", () => {
    const back = parseState(JSON.stringify({ version: 1, leaf: "lots", owned: [1, "x"], charges: 99 }));
    expect(back.leaf).toBe(freshState().leaf);
    expect(back.owned).toEqual(["x"]);
    expect(back.charges).toBe(6);
  });
});

describe("warming cones", () => {
  test("costs 400 Leaf each, with no discount for ten", () => {
    const s = { ...freshState(), leaf: 10000, freeCones: 0 };
    expect(warmCones(s, 1, never)?.state.leaf).toBe(10000 - CONE_PRICE);
    expect(warmCones(s, 10, never)?.state.leaf).toBe(10000 - 10 * CONE_PRICE);
  });

  test("spends banked free cones first", () => {
    const s = { ...freshState(), leaf: 0, freeCones: 1 };
    const opened = warmCones(s, 1, never);
    expect(opened?.state.freeCones).toBe(0);
    expect(opened?.state.leaf).toBe(0);
  });

  test("refuses when the Leaf does not cover it", () => {
    expect(warmCones({ ...freshState(), leaf: 399, freeCones: 0 }, 1, never)).toBeNull();
  });

  test("deepens a spirit's bond with each copy and turns the fourth Verdant", () => {
    let s: GroveState = { ...freshState(), leaf: 100000, spirits: {}, pity: 0 };
    for (let i = 0; i < VERDANT_AT; i++) s = warmCones(s, 1, () => 0.01)?.state ?? s;
    const id = Object.keys(s.spirits)[0] ?? "";
    expect(s.spirits[id]?.count).toBe(VERDANT_AT);
    expect(s.spirits[id]?.verdant).toBe(true);
  });

  test("carries pity from one cone to the next", () => {
    const opened = warmCones({ ...freshState(), leaf: 10000, pity: 0 }, 3, never);
    expect(opened?.state.pity).toBe(3);
  });
});

describe("care and Bloom", () => {
  test("spends a charge and fills a segment of Bloom", () => {
    const s = { ...freshState(), charges: 2, bloom: 3 };
    expect(care(s)?.state).toMatchObject({ charges: 1, bloom: 4 });
  });

  test("banks a free cone when Bloom fills", () => {
    const done = care({ ...freshState(), charges: 1, bloom: BLOOM_MAX - 1, freeCones: 0 });
    expect(done?.bloomed).toBe(true);
    expect(done?.state).toMatchObject({ bloom: 0, freeCones: 1 });
  });

  test("does nothing without a charge: charges bank, nothing wilts", () => {
    expect(care({ ...freshState(), charges: 0 })).toBeNull();
  });

  test("raids water the tree for free, a segment each", () => {
    expect(groot({ ...freshState(), bloom: 8, freeCones: 0 }, 3)).toMatchObject({ bloom: 1, freeCones: 1 });
  });
});

describe("spending", () => {
  test("buys an item once, for its price", () => {
    const s = buy({ ...freshState(), leaf: 1000 }, "fruma-fern");
    expect(s?.leaf).toBe(550);
    expect(s && buy(s, "fruma-fern")).toBeNull();
  });

  test("pours Leaf into the Great Sequoia", () => {
    expect(pour({ ...freshState(), leaf: 150, poured: 0 })).toMatchObject({ leaf: 50, poured: 100 });
    expect(pour({ ...freshState(), leaf: 99 })).toBeNull();
  });

  test("waters a friend's tree once with a care charge", () => {
    const s = waterFriend({ ...freshState(), charges: 1, watered: [] }, "Wren");
    expect(s).toMatchObject({ charges: 0, watered: ["Wren"] });
    expect(s && waterFriend(s, "Wren")).toBeNull();
  });
});
