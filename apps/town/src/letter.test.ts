import { describe, expect, test } from "bun:test";

import { coinsText, type Ctx } from "@sequoia-leaf/core";
import { ALL_ITEMS, collect, create, FACTORY, ORDER_WAITS, play, step } from "@sequoia-leaf/factory";
import { TOWN, type Town } from "@sequoia-leaf/town";

import { worksWaiting } from "./games.ts";
import type { AwayLine } from "./guild.ts";
import { compose, notLinked, span } from "./letter.ts";

const HOUR = 3_600_000;
/** Wednesday 25 November 2026, 18:00 UTC. */
const NOW = Date.UTC(2026, 10, 25, 18);
const ctx = (now = NOW): Ctx => ({
  now,
  player: { id: "p", guest: false },
  seed: 3,
  room: 0,
  awards: [],
  postcards: {},
});

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
/** The town's doors as Leaf gives them, with so many whole Coins in the Works' till. */
const till = (coins: number) => ({
  works: { waiting: "The yard is quiet. Somebody should start it up.", till: coins },
});

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
    const l = compose(arrivalOf(back(7 * HOUR, NOW - 24 * HOUR)), [raids], [worksWaiting(till(340))]);
    expect(l.lines.map((x) => x.art)).toEqual(["leaf", "folk", "coin", "crab"]);
  });

  test("the Coins waiting in the Works as Leaf keeps them are mentioned and not paid: going in collects them", () => {
    expect(worksWaiting(till(1))).toEqual({
      art: "coin",
      text: "Your Works has 1 Coin waiting for you. Go in to collect it.",
    });
    expect(worksWaiting(till(1240))?.text).toBe("Your Works has 1,240 Coins waiting for you. Go in to collect them.");
  });

  test("an order handed over and left uncollected is waiting too, so the line says nothing of when it was made", () => {
    const y = create({ seed: 3, tier: 4 });
    const order = y.board[0];
    if (!order) throw new Error("no board");
    for (let k = 0; k < ORDER_WAITS; k++) step(y);
    for (const n of ALL_ITEMS) order.filled[n] = order.want[n] ?? 0;
    collect(y);
    expect(play(y, { do: "handOver", order: order.id, tick: y.tick })).not.toHaveProperty("refused");
    // The page has not collected it yet: closed now, the till still holds the order's pay.
    const card = FACTORY.postcard?.(y);
    expect(card?.till).toBe(order.pay);
    expect(worksWaiting({ works: { waiting: "", till: card?.till ?? 0 } })?.text).toBe(
      `Your Works has ${coinsText(order.pay)} waiting for you. Go in to collect them.`,
    );
  });

  test("no line while the till holds less than a Coin, or the member has no yard", () => {
    expect(worksWaiting(till(0))).toBeNull();
    expect(worksWaiting({})).toBeNull();
  });

  test("a member with no Wynncraft account linked is told its Leaf is kept, and nobody else is told anything", () => {
    const asked = compose(
      arrivalOf(back(7 * HOUR, NOW - 24 * HOUR)),
      [raids],
      [notLinked({ askLink: true }), worksWaiting(till(340))],
    );
    expect(asked.lines.map((x) => [x.art, x.text])).toContainEqual([
      "leaf",
      "Your Wynncraft account isn't linked. Its Leaf is kept until you link it.",
    ]);
    // It pays nothing, so it brings no letter of its own.
    expect(compose(arrivalOf(back(2 * 60_000)), [], [notLinked({ askLink: true })]).show).toBe(false);
    expect([notLinked({ askLink: false }), notLinked(null)]).toEqual([null, null]);
    const linked = compose(arrivalOf(back(7 * HOUR, NOW - 24 * HOUR)), [raids], [notLinked({ askLink: false })]);
    expect(linked.lines.some((x) => x.text.includes("linked"))).toBe(false);
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
