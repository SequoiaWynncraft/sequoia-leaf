import { describe, expect, it } from "bun:test";

import {
  allotMonths,
  CONVERSION_KINDS,
  conversionCost,
  utcMonth,
  utcMonthStart,
  withinMemberLimit,
} from "./conversions.ts";
import { DEFAULT_RULES } from "./rules.ts";

const rules = DEFAULT_RULES.conversions;
const november = utcMonth(Date.UTC(2026, 10, 20));

describe("conversion rates", () => {
  it("are the Branchmasters' proposal, marked as provisional", () => {
    expect(rules.provisional).toBe(true);
    expect(conversionCost("le", 32, rules)).toBe(6_400);
    expect(conversionCost("tome", 1, rules)).toBe(4_000);
    expect(conversionCost("aspect", 1, rules)).toBe(4_000);
  });

  it("take from 32 to 64 whole LE at once, and one tome or aspect", () => {
    expect([31, 32, 64, 65, 40.5].map((units) => conversionCost("le", units, rules))).toEqual([
      undefined,
      6_400,
      12_800,
      undefined,
      undefined,
    ]);
    expect(conversionCost("tome", 2, rules)).toBeUndefined();
  });

  it("never take a claim bigger than a whole month pays, or one member's month", () => {
    for (const kind of CONVERSION_KINDS) {
      const rule = rules.kinds[kind];
      expect(rule.maxUnits).toBeLessThanOrEqual(rule.monthlyCap);
      expect(rule.minUnits).toBeLessThanOrEqual(rule.memberMonthly ?? rule.maxUnits);
    }
  });

  it("let a member ask for up to their own monthly limit", () => {
    const le = rules.kinds.le;

    expect(withinMemberLimit(32, 32, le)).toBe(true);
    expect(withinMemberLimit(64, 32, le)).toBe(false);
    const { memberMonthly: _limit, ...unlimited } = le;
    expect(withinMemberLimit(1_000, 32, unlimited)).toBe(true);
  });
});

describe("months", () => {
  it("count calendar months in UTC from January 1970", () => {
    expect(utcMonth(0)).toBe(0);
    expect(utcMonth(Date.UTC(2026, 10, 30, 23, 59, 59, 999))).toBe(november);
    expect(utcMonth(Date.UTC(2026, 11, 1))).toBe(november + 1);
    expect(new Date(utcMonthStart(november + 2)).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

function claim(units: number, requestedMonth = november) {
  return { units, requestedMonth, paidMonth: null };
}

function paid(units: number, paidMonth: number) {
  return { units, requestedMonth: november, paidMonth };
}

describe("the monthly cap", () => {
  const cap = 100;

  it("pays claims this month while they fit, and queues the rest for the next, in order", () => {
    expect(allotMonths([claim(64), claim(32), claim(32), claim(64)], new Map(), cap)).toEqual([
      november,
      november,
      november + 1,
      november + 1,
    ]);
  });

  it("never lets a smaller claim pass one ahead of it into a month with room", () => {
    // 64 then 64 overflow into December; the 32 after them waits behind them, not in November's gap.
    expect(allotMonths([claim(64), claim(64), claim(32)], new Map(), cap)).toEqual([
      november,
      november + 1,
      november + 1,
    ]);
  });

  it("keeps a claim behind the ones ahead of it that were already paid, and counts what they took", () => {
    // Paid ahead of it: 64 from November and 64 from December, so a claim of 64 waits for January.
    expect(
      allotMonths(
        [claim(64)],
        new Map([
          [november, 64],
          [november + 1, 64],
        ]),
        cap,
      ),
    ).toEqual([november + 2]);
    // A claim paid behind a waiting one keeps its month, and counts against it.
    expect(allotMonths([claim(32), paid(64, november), claim(32)], new Map(), cap)).toEqual([
      november,
      november,
      november + 1,
    ]);
  });

  it("starts a claim no earlier than the month it was made, so unclaimed allowance doesn't carry over", () => {
    expect(allotMonths([claim(64, november + 1)], new Map(), cap)).toEqual([november + 1]);
  });

  it("moves the claims behind one that leaves the queue up into its place", () => {
    expect(allotMonths([claim(64), claim(64), claim(64)], new Map(), cap)).toEqual([
      november,
      november + 1,
      november + 2,
    ]);
    // The second leaves, and the third moves up into December.
    expect(allotMonths([claim(64), claim(64)], new Map(), cap)).toEqual([november, november + 1]);
  });

  it("gives a claim bigger than a month's cap a month of its own rather than none", () => {
    expect(allotMonths([claim(32), claim(150)], new Map(), cap)).toEqual([november, november + 1]);
  });
});
