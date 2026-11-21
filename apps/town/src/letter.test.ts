import { describe, expect, test } from "bun:test";

import { worksAway } from "./games.ts";
import { compose, read, span } from "./letter.ts";
import { makeGuild } from "./madeup.ts";
import { blank, dayOf, type Kept } from "./save.ts";

const HOUR = 3_600_000;
const NOW = new Date(2026, 10, 21, 18, 0).getTime();
const g = makeGuild();

/** The letter a member finds, having last been in town at `lastSeen`. */
function letter(kept: Kept, now = NOW): ReturnType<typeof compose> {
  const away = g.away(kept.lastSeen, now);
  return compose(kept, now, away, [worksAway(away.hours, away.first)]);
}

describe("the arrival letter", () => {
  test("a first visit is welcomed and paid", () => {
    const l = letter(blank());
    expect(l.show).toBe(true);
    expect(l.title).toBe("Welcome home");
    expect(l.leaf).toBeGreaterThan(0);
    expect(l.coins).toBeGreaterThan(0);
  });

  test("once read, a reload finds nothing to pay and no letter", () => {
    const after = read(blank(), NOW);
    const again = letter(after, NOW + 4000);
    expect(again.leaf + again.coins).toBe(0);
    expect(again.show).toBe(false);
  });

  test("not read, a reload finds the same letter", () => {
    const kept = { ...blank(), lastSeen: NOW - 9 * HOUR, welcomed: dayOf(NOW - 9 * HOUR) };
    const first = letter(kept, NOW);
    const second = letter(kept, NOW + 5000);
    expect(second.lines).toEqual(first.lines);
    expect(second.leaf).toBe(first.leaf);
    expect(second.coins).toBe(first.coins);
  });

  test("the day's first visit is welcomed even with nothing to pay", () => {
    const kept = { ...blank(), lastSeen: NOW - 20 * 60_000, welcomed: dayOf(NOW - 24 * HOUR) };
    const l = letter(kept);
    expect(l.leaf).toBe(0);
    expect(l.show).toBe(true);
    expect(l.sub).toBe("Gone 20 minutes. Meanwhile:");
  });

  test("later the same day there is a letter only if something is owed", () => {
    const today = dayOf(NOW);
    expect(letter({ ...blank(), lastSeen: NOW - 2 * 60_000, welcomed: today }).show).toBe(false);
    const owed = letter({ ...blank(), lastSeen: NOW - 5 * HOUR, welcomed: today });
    expect(owed.show).toBe(true);
    expect(owed.leaf).toBe(12);
    expect(owed.coins).toBe(110);
  });

  test("what pays comes first, Leaf before Coins", () => {
    const l = letter({ ...blank(), lastSeen: NOW - 30 * HOUR });
    expect(l.lines[0]?.pay?.kind).toBe("leaf");
    expect(l.lines[1]?.pay?.kind).toBe("coins");
    expect(l.lines.slice(2).every((x) => !x.pay)).toBe(true);
  });

  test("the Works is paid for eight hours at most", () => {
    expect(worksAway(8, false)?.pay?.amount).toBe(worksAway(800, false)?.pay?.amount);
    expect(worksAway(0, false)).toBeNull();
    expect(worksAway(0.05, false)).toBeNull();
  });

  test("time away, in plain words", () => {
    expect(span(0.2)).toBe("a moment");
    expect(span(1)).toBe("1 minute");
    expect(span(59.9)).toBe("59 minutes");
    expect(span(60)).toBe("an hour");
    expect(span(60 * 5.5)).toBe("5 hours");
    expect(span(60 * 24 * 3)).toBe("3 days");
  });
});
