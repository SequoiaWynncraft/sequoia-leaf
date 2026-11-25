import { describe, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";
import { TOWN, type Town } from "@sequoia-leaf/town";

import { worksWaiting } from "./games.ts";
import type { AwayLine } from "./guild.ts";
import { compose, span } from "./letter.ts";

const HOUR = 3_600_000;
/** Wednesday 25 November 2026, 18:00 UTC. */
const NOW = Date.UTC(2026, 10, 25, 18);
const ctx = (now = NOW): Ctx => ({ now, player: { id: "p", guest: false }, seed: 3, room: 0, awards: [] });

/** The arrival Leaf shows a town at `now`. */
const arrivalOf = (s: Town, now = NOW) => TOWN.view(s, ctx(now)).arrival;
/** A town last here `ago` ago, welcomed on the day of `welcomed`. */
function back(ago: number, welcomed = NOW - ago): Town {
  const s = TOWN.create(ctx());
  s.seenAt = NOW - ago;
  s.welcomedDay = Math.floor(welcomed / (24 * HOUR));
  return s;
}
const raids: AwayLine = { art: "leaf", text: "3 raids with the guild", got: 240 };

describe("the arrival letter", () => {
  test("a first visit is welcomed, with what Tindra left, and the crab still missing", () => {
    const l = compose(arrivalOf(TOWN.create(ctx())), [], []);
    expect([l.show, l.title, l.sub]).toEqual([true, "Welcome home", "The guild kept these for you:"]);
    expect(l.lines.map((x) => [x.art, x.text, x.who])).toEqual([
      ["folk", "Tindra left a mushroom by your gate.", ["Tindra"]],
      ["crab", "Crab No. 7 is still missing.", undefined],
    ]);
  });

  test("later the same UTC day there is a letter only if the member's news paid Leaf", () => {
    expect(compose(arrivalOf(back(2 * 60_000)), [], []).show).toBe(false);
    const paid = compose(arrivalOf(back(5 * HOUR)), [raids], []);
    expect(paid.show).toBe(true);
    expect(paid.lines[0]).toEqual(raids);
  });

  test("the UTC day's first visit is welcomed, saying how long the member was gone", () => {
    const l = compose(arrivalOf(back(20 * 60_000, NOW - 24 * HOUR)), [], []);
    expect([l.show, l.sub]).toEqual([true, "Gone 20 minutes. Meanwhile:"]);
  });

  test("the member's news comes first, then the town's own, then what is waiting, and the crab last", () => {
    const l = compose(arrivalOf(back(7 * HOUR, NOW - 24 * HOUR)), [raids], [worksWaiting(340)]);
    expect(l.lines.map((x) => x.art)).toEqual(["leaf", "folk", "coin", "crab"]);
  });

  test("Coins in the Works are mentioned, with no number, and not paid: going in collects them", () => {
    const line: AwayLine = { art: "coin", text: "Your Works has Coins waiting. Go in to collect them." };
    expect(worksWaiting(0)).toBeNull();
    // The postcard's number is what this browser last saw, not what the yard has made since: it is not shown.
    expect(worksWaiting(1)).toEqual(line);
    expect(worksWaiting(340)).toEqual(line);
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
