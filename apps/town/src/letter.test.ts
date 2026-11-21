import { describe, expect, test } from "bun:test";

import { worksWaiting } from "./games.ts";
import { compose, read, span } from "./letter.ts";
import { makeGuild } from "./madeup.ts";
import { blank, dayOf, type Kept } from "./save.ts";

const HOUR = 3_600_000;
const NOW = new Date(2026, 10, 21, 18, 0).getTime();
const g = makeGuild();

/** The letter a member finds, having last been in town at `lastSeen`, with `till` Coins waiting in the Works. */
function letter(kept: Kept, now = NOW, till = 0): ReturnType<typeof compose> {
  const away = g.away(kept.lastSeen, now);
  return compose(kept, now, away, [worksWaiting(till)]);
}

describe("the arrival letter", () => {
  test("a first visit is welcomed and paid", () => {
    const l = letter(blank());
    expect(l.show).toBe(true);
    expect(l.title).toBe("Welcome home");
    expect(l.leaf).toBeGreaterThan(0);
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
    expect(owed.leaf).toBe(80);
    expect(owed.coins).toBe(0);
  });

  test("what pays comes first", () => {
    const l = letter({ ...blank(), lastSeen: NOW - 30 * HOUR }, NOW, 340);
    expect(l.lines[0]?.pay?.kind).toBe("leaf");
    expect(l.lines.slice(1).every((x) => !x.pay)).toBe(true);
  });

  test("the Works' till is mentioned and not paid: the yard pays it itself", () => {
    expect(worksWaiting(0)).toBeNull();
    expect(worksWaiting(1)?.text).toBe("1 Coin is waiting in the Works' till");
    const line = worksWaiting(340);
    expect(line?.text).toBe("340 Coins are waiting in the Works' till");
    expect(line?.pay).toBeUndefined();
    const l = letter({ ...blank(), lastSeen: NOW - 30 * HOUR }, NOW, 340);
    expect(l.coins).toBe(0);
    expect(l.lines.some((x) => x.text.includes("340 Coins"))).toBe(true);
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
