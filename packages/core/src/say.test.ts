import { expect, test } from "bun:test";

import { coinsText, duration, exact, num, PER_MINUTE, perMinute, whole } from "./say.ts";

test("a count is said whole, with its thousands, rounded half away from zero and never as -0", () => {
  expect([0, 1, 9.95, 10, 22_506, 1_000_000].map(whole)).toEqual(["0", "1", "10", "10", "22,506", "1,000,000"]);
  expect([2.5, 2.4, -2.5, -0.4, -0, -1200].map(whole)).toEqual(["3", "2", "-3", "0", "0", "-1,200"]);
});

test("a quantity is said whole from 10 up and to a tenth below, a whole tenth without its .0", () => {
  expect([0, 1, 0.6, 1.2, 2, 9.94, 9.95, 10, 37.5, 1234.4, 1_000_000].map(num)).toEqual([
    "0",
    "1",
    "0.6",
    "1.2",
    "2",
    "9.9",
    "10",
    "10",
    "38",
    "1,234",
    "1,000,000",
  ]);
  // What rounds to none is none, never "0.0" or "-0"; below none the same, with its sign.
  expect([0.04, -0.04, 1.96, -1.25, -12.5].map(num)).toEqual(["0", "0", "2", "-1.3", "-13"]);
});

test("an exact value keeps up to three places, and its thousands", () => {
  expect([0, 1, 0.5, 0.12, 0.001, 0.0125, 5.9525, 1234.5678, 1_000_000].map(exact)).toEqual([
    "0",
    "1",
    "0.5",
    "0.12",
    "0.001",
    "0.013",
    "5.953",
    "1,234.568",
    "1,000,000",
  ]);
  expect([-0, -0.0004, -0.5].map(exact)).toEqual(["0", "0", "-0.5"]);
});

test("a rate is always so many /min: the number as a quantity says it, what of where it is named, and a range unless its ends agree", () => {
  expect(PER_MINUTE).toBe("/min");
  expect([0, 1, 0.6, 9.95, 50, 1500].map((v) => perMinute(v))).toEqual([
    "0 /min",
    "1 /min",
    "0.6 /min",
    "10 /min",
    "50 /min",
    "1,500 /min",
  ]);
  expect(perMinute(20, "deadfall")).toBe("20 deadfall /min");
  expect(perMinute(1.2, "folios")).toBe("1.2 folios /min");
  expect(perMinute([6, 12])).toBe("6–12 /min");
  expect(perMinute([7.5, 15], "planks")).toBe("7.5–15 planks /min");
  // Ends that come out the same say one number.
  expect(perMinute([40.2, 39.8])).toBe("40 /min");
});

test("Coins are one Coin, or so many Coins", () => {
  expect([0, 1, 2, 1500, 1_000_000].map(coinsText)).toEqual([
    "0 Coins",
    "1 Coin",
    "2 Coins",
    "1,500 Coins",
    "1,000,000 Coins",
  ]);
});

test("a time played is written in minutes under an hour, hours and minutes under 100 hours, and hours from there", () => {
  const MIN = 60;
  const HOUR = 60 * MIN;
  expect(
    [
      0,
      59,
      MIN,
      42 * MIN + 59,
      HOUR - 1,
      HOUR,
      3 * HOUR,
      3 * HOUR + 20 * MIN,
      100 * HOUR - 1,
      100 * HOUR,
      132 * HOUR + 59 * MIN,
      1320 * HOUR,
    ].map(duration),
  ).toEqual([
    "under 1 min",
    "under 1 min",
    "1 min",
    "42 min",
    "59 min",
    "1 h",
    "3 h",
    "3 h 20 min",
    "99 h 59 min",
    "100 h",
    "132 h",
    "1,320 h",
  ]);
});
