import { expect, test } from "bun:test";

import { type Ctx, isRefused } from "@sequoia-leaf/core";
import { pressedTwice } from "@sequoia-leaf/kit/dom.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";
import { press } from "@sequoia-leaf/kit/standin.ts";
import { BANNERS, draw, EARLIER, headliner, prizesOf, PULLS, type Rarity, RATES } from "@sequoia-leaf/pulls";
import type { BannerPerson } from "@sequoia-leaf/pulls/wire.ts";
import { catalogAt } from "@sequoia-leaf/raid/content/catalog.ts";
import { eraAt, RELEASES } from "@sequoia-leaf/raid/content/releases.ts";

import {
  bannerLine,
  cannotPull,
  chances,
  GROVE,
  groveState,
  nextFree,
  offers,
  onward,
  owedLine,
  past,
  percent,
  pityLine,
  prizeBook,
  prizeName,
  pullSpend,
  RARITY_NAMES,
  revealOf,
  rules,
  seedsOf,
  showing,
  takesCommand,
  ticked,
  timeline,
} from "./pulls.ts";

const banner = BANNERS[0] ?? { id: "banner-1", opens: "base", from: 0, until: 0, headliner: "banner-1" };
/** Wednesday 25 November 2026, 12:00 UTC: banner-1 is open, and its era; what its pools give then. */
const T0 = Date.UTC(2026, 10, 25, 12);
const ERA = eraAt(T0);
const GROVE_PRIZES = prizesOf(catalogAt(ERA), "grove");
const BANNER_PRIZES = prizesOf(catalogAt(ERA), banner.id);
/** A banner with a made-up headliner, and the same banner with nobody yet. */
const WITH: BannerPerson[] = [{ ...banner, headliner: { id: "mossback", name: "Mossback" } }];
const WITHOUT: BannerPerson[] = [{ ...banner, headliner: null }];

test("what a reveal says of a prize: its name, whether it is new, and the Seeds it gave; never how a 50/50 fell", () => {
  expect(
    revealOf({ t: "pull", prize: "figure:greg", rarity: "Treant", have: 1, top: 34, fifty: "lost" }, WITH),
  ).toEqual({
    name: "Greg",
    rarity: "Treant",
    have: "New",
    owned: false,
    seeds: `+${RATES.seeds.top} Seeds`,
  });
  const again = revealOf({ t: "pull", prize: "figure:crab7", rarity: "Leafkin", have: 3 }, WITH);
  expect([again.have, again.owned, again.seeds]).toEqual(["You have 3", true, "+1 Seed"]);
  const bought = revealOf({ t: "exchange", prize: "figure:heron", rarity: "Dryad", have: 1 }, WITH);
  expect([bought.name, bought.seeds]).toEqual(["Reed", null]);
  const person = revealOf(
    { t: "pull", prize: headliner(banner.id), rarity: "Yggdrasil", have: 1, fifty: "owed" },
    WITH,
  );
  expect(person).toEqual({ name: "Mossback", rarity: "Yggdrasil", have: "New", owned: false, seeds: "+20 Seeds" });
  expect(seedsOf([{ t: "pull", prize: "figure:crab7", rarity: "Leafkin", have: 1 }])).toBe("+1 Seed");
});

test("every prize in the pools, and every prize of earlier pulls, has a name", () => {
  const earlier = Object.values(EARLIER).flat();
  for (const prize of [...RARITY_NAMES.flatMap((r) => BANNER_PRIZES[r]), ...earlier])
    expect(prizeName(prize, WITH)).not.toBe(prize.split(":")[1] ?? "");
  expect([prizeName("thing:plank-path", WITH), prizeName("look:gingham", WITH)]).toEqual([
    "Plank path",
    "Picnic gingham",
  ]);
});

test("the pity line counts towards the pull that is certain, and a lost 50/50 names who is next", () => {
  expect(pityLine({ top: 34 })).toBe(`34 of ${RATES.top.certainAt}`);
  expect(owedLine({ owed: true }, "Mossback")).toBe("The next top prize here is Mossback");
  expect(owedLine({ owed: false }, "Mossback")).toBeNull();
});

test("a banner is shown only while it is open and has a person", () => {
  const open = { open: [{ id: banner.id, until: banner.until }] };
  expect(showing(open, WITH)).toEqual({
    id: banner.id,
    until: banner.until,
    person: { id: "mossback", name: "Mossback" },
  });
  expect(showing(open, WITHOUT)).toBeNull();
  expect(showing({ open: [] }, WITH)).toBeNull();
  const shown = showing(open, WITH);
  if (shown) expect(bannerLine(shown, "UTC")).toBe("Mossback's banner is open until 8 December, 00:00.");
});

test("the chances shown are what RATES makes of a pull with no guarantee near", () => {
  for (const inBanner of [false, true]) {
    const shown = chances(inBanner);
    expect(RARITY_NAMES.reduce((sum, r) => sum + shown[r], 0)).toBeCloseTo(1, 12);
    expect(shown.Treant + shown.Yggdrasil).toBeCloseTo(RATES.top.chance, 12);
    expect(shown.Dryad / shown.Druid).toBeCloseTo(RATES.mid.Dryad / RATES.mid.Druid, 12);
    expect(shown.Leafkin / shown.Sprite).toBeCloseTo(RATES.filler.Leafkin / RATES.filler.Sprite, 12);
    // Drawn many times from counters at nothing, each rarity comes as often as the page says.
    const drawn: Partial<Record<Rarity, number>> = {};
    const n = 300_000;
    const stream = { rng: 20_261_122 };
    for (let i = 0; i < n; i++) {
      const { rarity } = draw({ top: 0, mid: 0, owed: false }, inBanner ? BANNER_PRIZES : GROVE_PRIZES, stream);
      drawn[rarity] = (drawn[rarity] ?? 0) + 1;
    }
    for (const r of RARITY_NAMES) expect(Math.abs((drawn[r] ?? 0) / n - shown[r])).toBeLessThan(0.004);
  }
  expect(chances(false).Yggdrasil).toBe(0);
  expect([percent(0.008), percent(0.05952), percent(0.5)]).toEqual(["0.8%", "5.952%", "50%"]);
});

test("the rules are written from RATES", () => {
  expect(rules("Mossback")).toEqual([
    "Top prize (Treant or Yggdrasil): 0.8% a pull. From pull 66 since the last top prize, 6.613 percentage points more each pull: 7.413% on pull 66. Pull 80 is always a top prize.",
    "Here a top prize is Mossback or a Treant, 50% each. After a Treant, the next top prize here is Mossback.",
    "Dryad or Druid: 6% of the pulls that are not a top prize, so 5.952% a pull while a top prize is 0.8%. At least 1 pull in every 10 is Dryad or better.",
    "Seeds: 1 for Leafkin, Sapling or Sprite, 5 for Dryad or Druid, 20 for a top prize.",
    "Free pull: 1 every 24 hours. Up to 7 wait.",
  ]);
  expect(rules(null)).toHaveLength(4);
  expect(rules(null)[0]).toStartWith("Top prize (Treant): ");
});

/** The numbers in a line, in order, a percentage as a share. */
const numbers = (line: string): number[] =>
  [...line.matchAll(/(\d+(?:\.\d+)?)(%| percentage points)?/g)].map(([, n = "", pc]) => Number(n) / (pc ? 100 : 1));

test("the rules' numbers are what a million seeded pulls in a banner do", () => {
  const [topLine = "", fiftyLine = "", midLine = ""] = rules("Mossback");
  const [base = 0, rampFrom = 0, rise = 0, first = 0, , certainAt = 0] = numbers(topLine);
  const [fifty = 0] = numbers(fiftyLine);
  const [midShare = 0, midAtStart = 0, , , midEvery = 0] = numbers(midLine);

  const c = { top: 0, mid: 0, owed: false };
  const stream = { rng: 20_261_122 };
  /** Pulls and top prizes by the pull since the last top prize; mid-tier among pulls not top; the 50/50s. */
  const tries = new Map<number, [number, number]>();
  const mids = { rolled: 0, won: 0, early: 0, earlyWon: 0 };
  const fifties = { free: 0, won: 0, owed: 0, owedWon: 0 };
  let longest = 0;
  for (let i = 0; i < 1_000_000; i++) {
    const at = c.top + 1;
    const certainMid = c.mid + 1 >= midEvery;
    const owed = c.owed;
    const { rarity } = draw(c, BANNER_PRIZES, stream);
    const top = rarity === "Treant" || rarity === "Yggdrasil";
    const [n = 0, won = 0] = tries.get(at) ?? [];
    tries.set(at, [n + 1, won + (top ? 1 : 0)]);
    if (top) {
      if (owed) fifties.owed++;
      else fifties.free++;
      if (rarity === "Yggdrasil") {
        if (owed) fifties.owedWon++;
        else fifties.won++;
      }
    } else if (!certainMid) {
      const mid = rarity === "Dryad" || rarity === "Druid";
      mids.rolled++;
      mids.won += mid ? 1 : 0;
    }
    if (at < rampFrom && !certainMid) {
      mids.early++;
      mids.earlyWon += rarity === "Dryad" || rarity === "Druid" ? 1 : 0;
    }
    longest = Math.max(longest, c.mid);
  }
  const share = (at: number): number => {
    const [n = 0, won = 0] = tries.get(at) ?? [];
    return won / n;
  };
  let before = [0, 0];
  for (let at = 1; at < rampFrom; at++) before = before.map((v, k) => v + (tries.get(at)?.[k] ?? 0));
  expect(Math.abs((before[1] ?? 0) / (before[0] ?? 1) - base)).toBeLessThan(0.0005);
  expect(Math.abs(share(rampFrom) - first)).toBeLessThan(0.01);
  expect(Math.abs(share(rampFrom + 1) - (first + rise))).toBeLessThan(0.015);
  // So few pulls get that far that it is drawn on its own.
  for (let i = 0; i < 1000; i++)
    expect(draw({ top: certainAt - 1, mid: 0, owed: false }, GROVE_PRIZES, stream).rarity).toBe("Treant");
  expect(tries.has(certainAt + 1)).toBe(false);
  expect(Math.abs(fifties.won / fifties.free - fifty)).toBeLessThan(0.02);
  expect(fifties.owedWon).toBe(fifties.owed);
  expect(Math.abs(mids.won / mids.rolled - midShare)).toBeLessThan(0.002);
  expect(Math.abs(mids.earlyWon / mids.early - midAtStart)).toBeLessThan(0.002);
  expect(longest).toBeLessThan(midEvery);
});

test("a pull or an exchange is taken only at the banner and at a ceremony's end", () => {
  const at = { leaving: false, sent: false, dark: 0, end: null, t: 0 };
  const states = [
    groveState({ ...at, dark: 0.4 }),
    groveState(at),
    groveState({ ...at, sent: true }),
    groveState({ ...at, end: 9, t: 0.2 }),
    groveState({ ...at, end: 9, t: 9 }),
    groveState({ ...at, end: 9, t: 9, sent: true }),
    groveState({ ...at, leaving: true, dark: 0.4 }),
  ];
  expect(states).toEqual(["arriving", "banner", "sent", "ceremony", "end", "sent", "leaving"]);
  expect(states.filter(takesCommand)).toEqual(["banner", "end"]);
});

test("a ceremony's clock stops at each mid-tier and top prize among several, once its reveal is done, and at no filler", () => {
  const line = timeline(["filler", "mid", "filler", "top"], 2.6);
  expect(line.starts.map((s) => Number(s.toFixed(3)))).toEqual([2.6, 3.9, 5.8, 7.1]);
  expect(line.end).toBeCloseTo(10.5, 9);
  // The last frame of the second and the fourth reveals, and nowhere else.
  expect(line.waits.map((w) => Number((w + 1 / 60).toFixed(3)))).toEqual([5.8, 10.5]);

  /** Where the clock stands after `seconds` of frames from `t`, and how long it stood still. */
  const run = (t: number, seconds: number): [number, number] => {
    let stood = 0;
    for (let n = 0; n < seconds * 30; n++) {
      const to = ticked(line, t, 1 / 30);
      stood += t + 1 / 30 - to;
      t = to;
    }
    return [t, stood];
  };
  const [first = 0, last = 0] = line.waits;
  // The filler goes on by itself; the mid-tier prize is not left, however long nobody presses.
  const [t, stood] = run(0, 60);
  expect(t).toBe(first);
  expect(stood).toBeCloseTo(60 - first, 6);
  // Going on is to the next prize, which goes on by itself to the top prize, and waits there.
  expect(onward(line, first)).toBe(line.starts[2] ?? 0);
  expect(run(onward(line, first), 60)[0]).toBe(last);
  // Going on from the last wait is the end, and the end's clock runs.
  expect(onward(line, last)).toBe(line.end);
  expect(run(line.end, 2)[0]).toBeCloseTo(line.end + 2, 6);
  // Skip pressed goes on from wherever the clock is, past the tell first; held, it puts the clock at the end, past every wait.
  expect([onward(line, 0), onward(line, 2.6), onward(line, 4)]).toEqual(line.starts.slice(0, 3));
  expect(line.waits.every((w) => w < line.end)).toBe(true);
});

test("one prize alone stays on show as it did, and ten fillers never wait", () => {
  expect(timeline(["top"], 2.6).waits).toEqual([]);
  expect(timeline(["mid"], 0).waits).toEqual([]);
  expect(
    timeline(
      Array.from({ length: 10 }, () => "filler" as const),
      2.6,
    ).waits,
  ).toEqual([]);
  expect(ticked(timeline(["top"], 2.6), 5.99, 0.05)).toBeCloseTo(6.04, 9);
});

const redraw = (): void => undefined;
test("a pull asked for in one pool is not confirmed by pressing it in another", () => {
  const grove = scope();
  const pressed = (pool: string, n: 1 | 10): boolean => {
    press();
    return pressedTwice(grove, pullSpend(pool, n), redraw);
  };
  expect(pressed(banner.id, 10)).toBe(false);
  expect(pressed("grove", 10)).toBe(false);
  expect(pressed("grove", 1)).toBe(false);
  expect(pressed("grove", 1)).toBe(true);
});

test("a pull that cannot be paid for says why, in the kit's words for closed Leaf or for too little", () => {
  const shut = "Leaf spending opens after the play-test.";
  expect(cannotPull(1, 0, false, shut)).toBe(shut);
  expect(cannotPull(10, 10 * RATES.leaf - 1, true, shut)).toBe("Not enough Leaf.");
  expect(cannotPull(10, 10 * RATES.leaf, true, shut)).toBeNull();
});

test("the next free pull is said until the most are waiting", () => {
  const next = Date.UTC(2026, 10, 26, 14, 5);
  expect(nextFree({ waiting: 0, next }, "UTC")).toBe("Next free pull: 26 November, 14:05");
  expect(nextFree({ waiting: RATES.free.most, next }, "UTC")).toBeNull();
});

test("Seeds buy a mid-tier figure the player does not have, and the history is newest first, earlier prizes in it", () => {
  // A mid-tier look of earlier pulls is held, and is not among what Seeds buy.
  const list = offers({ have: { "figure:badger": 1, "look:baize": 1 }, seeds: RATES.exchange.Dryad, era: ERA });
  expect(list.map((o) => o.prize)).toEqual([
    "figure:badger",
    "figure:fogowl",
    "figure:heron",
    "figure:crab40",
    "figure:apothecary",
  ]);
  expect(list.find((o) => o.prize === "figure:badger")).toMatchObject({
    owned: true,
    enough: true,
    price: RATES.exchange.Dryad,
  });
  expect(list.find((o) => o.rarity === "Druid")).toMatchObject({
    owned: false,
    enough: false,
    price: RATES.exchange.Druid,
  });

  const at = Date.UTC(2026, 10, 25, 12);
  const rows = past(
    [
      { prize: "thing:pinecone", pool: "grove", at, top: 3 },
      { prize: "thing:fountain", pool: banner.id, at: at + 60_000, top: 34 },
      { prize: "figure:moth", pool: "grove", at: at + 120_000, top: 4 },
    ],
    WITH,
    "UTC",
  );
  expect(rows).toEqual([
    { prize: "figure:moth", rarity: "Leafkin", pool: "Evergreen", when: "25 November, 12:02", top: null },
    {
      prize: "thing:fountain",
      rarity: "Treant",
      pool: "Mossback",
      when: "25 November, 12:01",
      top: `34 of ${RATES.top.certainAt}`,
    },
    { prize: "thing:pinecone", rarity: "Leafkin", pool: "Evergreen", when: "25 November, 12:00", top: null },
  ]);
});

/** Leaf's word on a pull at a moment. */
const ctxAt = (now: number, seed = 1): Ctx => ({
  now,
  player: { id: "mossback", guest: false },
  seed,
  room: 0,
  awards: [],
  postcards: {},
});
/** Every prize Leaf draws from a pool at a moment, over many ten-pulls that each start certain of a top-tier prize. */
function drawnAt(pool: string, now: number): string[] {
  const drawn = new Set<string>();
  const certain = { top: RATES.top.certainAt - 1, mid: 0, owed: false };
  for (let seed = 1; seed <= 300; seed++) {
    const state = { ...PULLS.create(ctxAt(now, seed)), counters: { grove: certain, banner: certain } };
    const answer = PULLS.apply(state, { do: "pull", pool, n: 10, with: "leaf" }, ctxAt(now, seed));
    if (isRefused(answer)) throw new Error(`${pool} refused at ${now}: ${answer.refused}`);
    for (const note of answer.notes) drawn.add(note.prize);
  }
  return [...drawn].toSorted();
}

test("the prize book lists what Leaf draws from each pool open, and counts that, a millisecond before each release and at it", () => {
  for (const release of RELEASES.filter((r) => r.at > 0)) {
    for (const now of [release.at - 1, release.at]) {
      const view = PULLS.view(PULLS.create(ctxAt(now)), ctxAt(now));
      for (const pool of [GROVE, ...view.open.map((b) => b.id)]) {
        const listed = prizeBook(view, pool).flatMap(([, list]) => list);
        expect([pool, now, ...listed.toSorted()]).toEqual([pool, now, ...drawnAt(pool, now)]);
      }
    }
  }
});
