import { describe, expect, it } from "bun:test";

import { type Ctx, isRefused } from "@sequoia-leaf/core";
import { figureIn, RAID } from "@sequoia-leaf/raid";
import { available, catalogAt, everyShared, prizeOf } from "@sequoia-leaf/raid/content/catalog.ts";
import { isBoughtLook } from "@sequoia-leaf/raid/content/looks.ts";
import { eraAt, eraOf } from "@sequoia-leaf/raid/content/releases.ts";
import { TOWN } from "@sequoia-leaf/town";
import { figureThing, isThing, memberThing } from "@sequoia-leaf/town/things.ts";

import {
  awardsBetween,
  BANNERS,
  type Counters,
  draw,
  EARLIER,
  featuredOf,
  headliner,
  HISTORY,
  opensAt,
  type Prizes,
  prizesOf,
  PULLS,
  type Pulls,
  type PullsCommand,
  RARITIES,
  type Rarity,
  rarityOf,
  RATES,
  readStaffCommand,
  topChance,
} from "./game.ts";

const DAY = RATES.free.every;
/** Wednesday 25 November 2026, 12:00 UTC: banner-1 is open. */
const T0 = Date.UTC(2026, 10, 25, 12);
const ctx = (now = T0, guest = false, seed = 7): Ctx => ({
  now,
  player: { id: "mossback", guest },
  seed,
  room: 0,
  awards: [],
  postcards: {},
});
const fresh = (): Pulls => PULLS.create(ctx());
const counters = (top = 0, mid = 0, owed = false): Counters => ({ top, mid, owed });
/** A pull, shown the prizes of the era at `at` (T0's, unless said). */
const pull = (pool: string, n: 1 | 10 = 10, paid: "leaf" | "free" = "leaf", at = T0): PullsCommand => ({
  do: "pull",
  pool,
  n,
  with: paid,
  era: eraAt(at),
});
const exchange = (prize: string): PullsCommand => ({ do: "exchange", prize });

/** A command that must be done, and what it did. */
function done(state: Pulls, c: PullsCommand, at = ctx()) {
  const answer = PULLS.apply(state, c, at);
  if (isRefused(answer)) throw new Error(`Refused: ${answer.refused}`);
  return answer;
}
/** The code a command is refused with, or null when it is done. */
function refused(state: Pulls, c: PullsCommand, at = ctx()): string | null {
  const answer = PULLS.apply(state, c, at);
  return isRefused(answer) ? answer.refused : null;
}
/** The raid's catalogue at T0, and what its two pools give then. */
const CAT = catalogAt(eraAt(T0));
const GROVE = prizesOf(CAT, "grove");
const BANNER = prizesOf(CAT, "banner-1");
/** The tiers drawn from the same counters with each of `n` streams. */
const tiers = (c: Counters, n: number) =>
  new Set(Array.from({ length: n }, (_, seed) => RARITIES[draw({ ...c }, GROVE, { rng: seed }).rarity].tier));

/**
 * The grove's figures, no headliner; those the pools have at T0, as prizes, which Seqwawa joins on 8
 * December (it came with the expansion's first release, while banner-1 was open); and those of one
 * of the raid's prices.
 */
const everyones = everyShared().filter((id) => CAT.figures[id] !== undefined);
const pooled = everyones.filter((id) => id !== "seqwawa");
const priced = (price: number): string[] => pooled.filter((id) => figureIn(CAT, id).tier === price).map(prizeOf);
/** Every prize of a pool. */
const all = (prizes: Prizes): string[] => Object.values(prizes).flat();
/** Whether a prize of earlier pulls is a thing the town has, or a look the raid's table sells. */
function known(prize: string): boolean {
  const [kind = "", id = ""] = prize.split(/:(.*)/);
  return kind === "thing" ? isThing(id) : kind === "look" && isBoughtLook(id);
}

/** The Treants a pool gives at a moment, as the catalogue of that moment's era has them, over many streams. */
function treants(pool: string, now: number): string[] {
  const prizes = prizesOf(catalogAt(eraAt(now)), pool);
  const seen = new Set<string>();
  for (let seed = 0; seed < 400; seed++) {
    const d = draw(counters(79), prizes, { rng: seed });
    if (d.rarity === "Treant") seen.add(d.prize);
  }
  return [...seen].toSorted();
}

describe("a figure made while a banner is open", () => {
  it("joins the pools as the next release opens: Seqwawa is no prize during banner-1, and is one from 8 December", () => {
    const opens = Date.UTC(2026, 11, 8);
    const three = ["figure:greg", "figure:hearthcat", "figure:whitefox"];
    expect([treants("grove", T0), treants("grove", opens - 1)]).toEqual([three, three]);
    // With Groot Night's own Treant, Crab #8, which joins as its release opens.
    expect(treants("grove", opens)).toEqual([...three, "figure:seqwawa", "figure:crab8"].toSorted());
    // Lost on the 50/50, banner-1 pays out of the three it opened with.
    expect(treants("banner-1", opens - 1)).toEqual(three);
    // On the stall it is from the first.
    expect(available(CAT, { for: "stall", figures: { pool: "fair" }, tier: 5 })).toContain("seqwawa");
  });
});

describe("a pull shown one list of prizes", () => {
  it("is refused when the pool gives others by Leaf's clock, and nothing is paid; the same list in another era is pulled", () => {
    const opens = Date.UTC(2026, 11, 8);
    const s = fresh();
    // Shown the grove a millisecond before Seqwawa joined it, and pulled as it did.
    expect(refused(s, pull("grove", 10, "leaf", opens - 1), ctx(opens))).toBe("prizes_changed");
    expect(refused({ ...s, free: { ...s.free, waiting: 1 } }, pull("grove", 1, "free", opens - 1), ctx(opens))).toBe(
      "prizes_changed",
    );
    expect(refused(s, pull("grove", 10, "leaf", opens), ctx(opens))).toBeNull();
    // The base alone gave the grove what it gives until 8 December: shown then, it is pulled now.
    expect(refused(s, { do: "pull", pool: "grove", n: 10, with: "leaf", era: eraOf("base") }, ctx(T0))).toBeNull();
  });
});

describe("the prizes", () => {
  it("are the raid's figures, each in one rarity by its price there, and a banner's headliner", () => {
    const every = all(BANNER);
    expect(every.toSorted()).toEqual([...pooled.map(prizeOf), "headliner:banner-1"].toSorted());
    expect([BANNER.Leafkin, BANNER.Sapling, BANNER.Sprite, BANNER.Treant]).toEqual([
      priced(1),
      priced(2),
      priced(3),
      priced(5),
    ]);
    expect([...BANNER.Dryad, ...BANNER.Druid].toSorted()).toEqual(priced(4).toSorted());
    expect(BANNER.Dryad).toEqual(["figure:badger", "figure:fogowl", "figure:heron"]);
    expect(BANNER.Druid).toEqual(["figure:crab40", "figure:apothecary"]);
    expect(Object.values(BANNER).map((list) => list.length)).toEqual([7, 7, 6, 3, 2, 3, 1]);
    expect(BANNER.Yggdrasil).toEqual(["headliner:banner-1"]);
    // The grove gives the same, but no headliner.
    expect(GROVE).toEqual({ ...BANNER, Yggdrasil: [] });
    // The town has a thing to send for each figure, and for each banner's headliner.
    expect(everyones.filter((id) => !isThing(figureThing(id)))).toEqual([]);
    expect(BANNERS.filter(({ id }) => !isThing(memberThing(id)))).toEqual([]);
    // And each banner's headliner is a figure of the raid, which no `figure:` prize is.
    expect(BANNERS.map((b) => [b.id, b.headliner])).toEqual([
      ["banner-1", "banner-1"],
      ["groot-night", "commodore"],
    ]);
    expect(every.filter((prize) => BANNERS.some((b) => prize === `figure:${b.headliner}`))).toEqual([]);
    expect(rarityOf("figure:greg")).toBe("Treant");
    expect(rarityOf("figure:seqwawa")).toBe("Treant");
    expect(rarityOf("figure:nobody")).toBeUndefined();
    expect(rarityOf("headliner:banner-0")).toBe("Yggdrasil");
  });

  it("of earlier pulls are things and looks the town and the raid still have, each once, and in no pool", () => {
    const earlier = Object.values(EARLIER).flat();
    expect(earlier.filter((prize) => !known(prize))).toEqual([]);
    expect(new Set(earlier).size).toBe(earlier.length);
    expect(earlier).toHaveLength(69);
    expect(all(BANNER).filter((prize) => earlier.includes(prize))).toEqual([]);
    expect([rarityOf("look:plum"), rarityOf("thing:fountain"), rarityOf("thing:rock")]).toEqual([
      "Druid",
      "Treant",
      "Leafkin",
    ]);
    expect([rarityOf("look:bare"), rarityOf("ware:jar")]).toEqual([undefined, undefined]);
  });
});

describe("a pull", () => {
  it("is top tier for certain on the 80th since the last, with the chance rising from the 66th", () => {
    expect(topChance(65)).toBe(RATES.top.chance);
    expect(topChance(66)).toBeCloseTo(0.008 + 0.992 / 15, 12);
    expect(topChance(79)).toBeCloseTo(0.008 + (0.992 * 14) / 15, 12);
    expect(topChance(80)).toBe(1);
    expect(tiers(counters(79, 3), 2000)).toEqual(new Set(["top"]));
  });

  it("is mid tier or better for certain on the 10th since the last", () => {
    expect(tiers(counters(30, 9), 2000).has("filler")).toBe(false);
    expect(tiers(counters(30, 8), 2000).has("filler")).toBe(true);
  });

  it("owes the headliner after a lost 50/50, in whichever banner the next top-tier prize comes", () => {
    const seen = { won: 0, lost: 0 };
    for (let seed = 0; seed < 200; seed++) {
      const c = counters(79);
      const s = { rng: seed };
      const first = draw(c, BANNER, s);
      if (first.fifty === "won") {
        expect(first).toMatchObject({ prize: "headliner:banner-1", rarity: "Yggdrasil" });
        expect(c.owed).toBe(false);
        seen.won += 1;
        continue;
      }
      expect(first).toMatchObject({ rarity: "Treant", fifty: "lost" });
      expect(c.owed).toBe(true);
      seen.lost += 1;
      // The banner after it: its next top-tier prize is its own headliner, and nothing is owed after it.
      c.top = 79;
      expect(draw(c, { ...BANNER, Yggdrasil: [headliner("banner-2")] }, s)).toEqual({
        prize: "headliner:banner-2",
        rarity: "Yggdrasil",
        top: 80,
        fifty: "owed",
      });
      expect(c.owed).toBe(false);
    }
    expect(seen.won).toBeGreaterThan(70);
    expect(seen.lost).toBeGreaterThan(70);
    // The grove has no headliner and no 50/50.
    const grove = counters(79);
    expect(draw(grove, GROVE, { rng: 1 })).toMatchObject({ rarity: "Treant", top: 80 });
    expect(grove).toEqual(counters());
  });

  it("from the grove leaves the banners' counters as they are, and the other way round", () => {
    const grove = done(fresh(), pull("grove")).state;
    expect(grove.counters.banner).toEqual(counters());
    expect(grove.counters.grove).not.toEqual(counters());
    const banner = done(grove, pull("banner-1")).state;
    expect(banner.counters.grove).toEqual(grove.counters.grove);
    expect(banner.counters.banner).not.toEqual(counters());
  });

  it("is only from a banner that is open by Leaf's clock", () => {
    const s = fresh();
    expect(refused(s, pull("banner-1"), ctx(Date.UTC(2026, 10, 22, 23, 59)))).toBe("closed");
    expect(refused(s, pull("banner-1"), ctx(Date.UTC(2026, 10, 23)))).toBeNull();
    expect(refused(s, pull("banner-1"), ctx(Date.UTC(2026, 11, 8)))).toBe("closed");
    expect(refused(s, pull("grove", 10, "leaf", Date.UTC(2030, 0, 1)), ctx(Date.UTC(2030, 0, 1)))).toBeNull();
    expect(PULLS.view(s, ctx()).open).toEqual([{ id: "banner-1", until: Date.UTC(2026, 11, 8) }]);
    // Groot Night opens as banner-1 closes, and closes two weeks later.
    const night = { id: "groot-night", until: Date.UTC(2026, 11, 22) };
    expect(PULLS.view(s, ctx(Date.UTC(2026, 11, 8) - 1)).open).toEqual([
      { id: "banner-1", until: Date.UTC(2026, 11, 8) },
    ]);
    expect(PULLS.view(s, ctx(Date.UTC(2026, 11, 8))).open).toEqual([night]);
    expect(PULLS.view(s, ctx(Date.UTC(2026, 11, 22))).open).toEqual([]);
    expect(refused(s, pull("groot-night", 10, "leaf", Date.UTC(2026, 11, 8) - 1), ctx(Date.UTC(2026, 11, 8) - 1))).toBe(
      "closed",
    );
    expect(refused(s, pull("groot-night", 10, "leaf", Date.UTC(2026, 11, 8)), ctx(Date.UTC(2026, 11, 8)))).toBeNull();
    // A banner these rules do not know (one retired, or never) is closed.
    expect(refused(s, pull("banner-9"))).toBe("closed");
    expect(PULLS.command({ ...pull("grove"), n: 5 })).toBeNull();
  });

  it("is a guest's as much as a member's: free pulls, exchanges, and pulls for Leaf that anyone may spend on", () => {
    const s = { ...fresh(), seeds: 500 };
    const guest = ctx(T0, true);
    expect(refused(s, pull("grove", 1, "free"), guest)).toBeNull();
    expect(refused(s, exchange("figure:badger"), guest)).toBeNull();
    expect(done(s, pull("grove"), guest).leaf).toEqual([
      { amount: 10_000, reason: "Pulls: 10 in grove", key: "pull:0", for: "everyone" },
    ]);
  });

  it("takes 1,000 Leaf, ten at once as one spend keyed by the pulls before them", () => {
    const ten = done(fresh(), pull("grove"));
    expect(ten.leaf).toEqual([{ amount: 10_000, reason: "Pulls: 10 in grove", key: "pull:0", for: "everyone" }]);
    expect(done(ten.state, pull("banner-1", 1)).leaf).toEqual([
      { amount: 1000, reason: "Pulls: 1 in banner-1", key: "pull:10", for: "everyone" },
    ]);
  });

  it("notes each prize in order with its rarity and how many the player has, and gives Seeds by tier", () => {
    const { state, notes, log } = done(fresh(), pull("grove"));
    expect(notes.map((note) => note.prize)).toEqual(state.history.map((pulled) => pulled.prize));
    expect(notes.every((note) => note.t === "pull" && rarityOf(note.prize) === note.rarity)).toBe(true);
    const last = new Map(notes.map((note) => [note.prize, note.have]));
    expect(Object.fromEntries(last)).toEqual(state.have);
    const seeds = notes.reduce((sum, note) => sum + RATES.seeds[RARITIES[note.rarity].tier], 0);
    expect(state.seeds).toBe(seeds);
    expect(state.pulls).toBe(10);
    expect(state.history.map((pulled) => [pulled.pool, pulled.at])).toEqual(
      Array.from({ length: 10 }, () => ["grove", T0]),
    );
    expect(log).toEqual([]);
  });

  it("notes a top-tier prize with what top stood at and the 50/50, and logs it", () => {
    const s = fresh();
    s.counters.banner = counters(79, 4);
    const { state, notes, log } = done(s, pull("banner-1", 1));
    const [note] = notes;
    expect(note).toMatchObject({ t: "pull", top: 80, have: 1, fifty: expect.stringMatching(/^(won|lost)$/) });
    expect(log).toEqual([{ kind: "pulls_top", data: { prize: note?.prize ?? "", pool: "banner-1", top: 80 } }]);
    expect(state.counters.banner).toEqual(counters(0, 0, note?.fifty === "lost"));
    expect(state.seeds).toBe(RATES.seeds.top);
    expect(PULLS.standing?.(state)).toEqual({ score: 1, also: { pulls: 1, top: 1 } });
  });
});

describe("a staff grant", () => {
  const grant = { do: "grant", prize: "figure:crab40", copies: 2, by: "steward", name: "Steward" } as const;
  it("is never read off a page's wire, only off Leaf's staff route", () => {
    expect(PULLS.command({ ...grant, id: "g-1" })).toBeNull();
    expect(readStaffCommand({ ...grant, id: "g-1" })).toEqual(grant);
    expect(readStaffCommand({ do: "pull", pool: "grove", n: 1, with: "free", era: eraAt(T0) })).toBeNull();
    expect(readStaffCommand({ ...grant, copies: 8 })).toBeNull();
  });
  it("adds copies as a pull would, for nothing: no Leaf, no Seeds, no counter or history, and the awards follow", () => {
    const s = PULLS.create(ctx());
    const granted = PULLS.apply(s, grant, ctx());
    if (isRefused(granted)) throw new Error(granted.refused);
    expect(granted.state.have).toEqual({ "figure:crab40": 2 });
    expect({ ...granted.state, have: s.have }).toEqual(s);
    expect(granted.leaf ?? []).toEqual([]);
    expect(granted.notes).toEqual([{ t: "grant", prize: "figure:crab40", rarity: "Druid", have: 2 }]);
    expect(granted.log).toEqual([
      { kind: "pulls_granted", data: { prize: "figure:crab40", copies: 2, have: 2, by: "steward", name: "Steward" } },
    ]);
    expect(PULLS.awards?.(granted.state)).toEqual(awardsBetween("figure:crab40", 0, 2));
    expect(awardsBetween("figure:crab40", 2, 3)).toEqual(["copies:figure:crab40:3"]);
    expect(awardsBetween("figure:crab40", 7, 9)).toEqual([]);
  });
  it("is refused for a prize not open yet by Leaf's clock, and for one no release has", () => {
    const s = PULLS.create(ctx());
    const banner = { ...grant, prize: headliner("banner-1") };
    expect(opensAt(banner.prize)).toBe(Date.UTC(2026, 10, 23));
    expect(PULLS.apply(s, banner, ctx(Date.UTC(2026, 10, 22)))).toEqual({ refused: "not_released" });
    expect(isRefused(PULLS.apply(s, banner, ctx()))).toBe(false);
    expect(PULLS.apply(s, { ...grant, prize: "figure:nobody" }, ctx())).toEqual({ refused: "no_such_prize" });
  });
});

describe("free pulls", () => {
  it("fall due one a day by Leaf's clock, up to 7, with one for a new player and none while the clock stands still", () => {
    const s = fresh();
    expect(s.free).toEqual({ waiting: 1, next: T0 + DAY });
    expect(PULLS.advance(s, ctx(T0))).toBe(s);
    expect(PULLS.advance(s, ctx(T0 + DAY - 1))).toBe(s);
    expect(PULLS.advance(s, ctx(T0 + DAY)).free).toEqual({ waiting: 2, next: T0 + 2 * DAY });
    expect(PULLS.advance(s, ctx(T0 + 3.5 * DAY)).free).toEqual({ waiting: 4, next: T0 + 4 * DAY });
    const month = PULLS.advance(s, ctx(T0 + 30 * DAY));
    expect(month.free).toEqual({ waiting: 7, next: T0 + 31 * DAY });
    expect(refused(month, pull("grove", 10, "free"))).toBe("no_free");
    const one = done(month, pull("grove", 1, "free"));
    expect(one.state.free).toEqual({ waiting: 6, next: T0 + 31 * DAY });
    expect(one.leaf).toEqual([]);
  });
});

describe("Seeds", () => {
  it("buy a mid-tier figure the player does not have: 60 for a Dryad one, 150 for a Druid one", () => {
    const s = { ...fresh(), seeds: 200 };
    expect(refused(s, exchange("figure:greg"))).toBe("not_for_seeds");
    expect(refused(s, exchange("figure:worm"))).toBe("not_for_seeds");
    expect(refused(s, exchange("headliner:banner-1"))).toBe("not_for_seeds");
    expect(refused(s, exchange("nothing"))).toBe("not_for_seeds");
    const dryad = done(s, exchange("figure:badger"));
    expect(dryad.notes).toEqual([{ t: "exchange", prize: "figure:badger", rarity: "Dryad", have: 1 }]);
    expect(dryad.state.seeds).toBe(140);
    expect(refused(dryad.state, exchange("figure:badger"))).toBe("owned");
    expect(refused(dryad.state, exchange("figure:crab40"))).toBe("not_enough_seeds");
    // What was a mid-tier prize of earlier pulls, or a ware, is not to be had.
    for (const prize of ["look:baize", "thing:glass-lantern", "look:plum", "thing:sun-banner", "ware:crown"])
      expect(refused(dryad.state, exchange(prize))).toBe("not_for_seeds");
    const druid = done({ ...dryad.state, seeds: 150 }, exchange("figure:crab40"));
    expect([druid.state.seeds, druid.state.have["figure:crab40"], druid.state.pulls]).toEqual([0, 1, 0]);
  });
});

describe("keeping it", () => {
  it("reads back what it wrote, keeps the last 200 pulls, and shows everything but the stream", () => {
    let s = fresh();
    for (let i = 0; i < 21; i++) s = done(s, pull(i % 2 === 0 ? "grove" : "banner-1"), ctx(T0, false, i)).state;
    expect([s.pulls, s.history.length]).toEqual([210, HISTORY]);
    expect(PULLS.decode(PULLS.encode(s))).toEqual(s);
    expect(PULLS.decode("{")).toBeNull();
    // A ware won before the wares went is let go, from what is held and from the history.
    const past = { prize: "ware:jar", pool: "grove", at: T0, top: 3 };
    const held = { ...s, have: { ...s.have, "ware:jar": 2 }, history: [past, ...s.history.slice(1)] };
    expect(PULLS.decode(PULLS.encode(held))).toEqual({ ...s, history: s.history.slice(1) });
    expect(PULLS.decode(PULLS.encode({ ...s, have: { "figure:worm": 0 } }))).toBeNull();
    // Under other content or numbers it still reads (`stored.test.ts`).
    expect(PULLS.decode(PULLS.encode({ ...s, have: { "figure:nobody": 1 } }))?.have).toEqual({ "figure:nobody": 1 });
    expect(
      PULLS.decode(PULLS.encode({ ...s, counters: { ...s.counters, banner: counters(80) } }))?.counters.banner,
    ).toEqual(counters(79));
    const { rng, ...shown } = s;
    expect(rng).toBeNumber();
    expect(PULLS.view(s, ctx())).toEqual({
      ...shown,
      open: [{ id: "banner-1", until: Date.UTC(2026, 11, 8) }],
      era: eraAt(T0),
    });
    expect(PULLS.awards?.(s)?.filter((id) => id.startsWith("pull:"))).toEqual(
      Object.keys(s.have).map((prize) => `pull:${prize}`),
    );
  });

  it("awards each prize once, and each further copy of it up to the seventh by a name of its own", () => {
    const s = { ...fresh(), have: { "figure:greg": 3, "figure:worm": 1, "figure:slug": 9, "thing:fountain": 2 } };
    const awards = PULLS.awards?.(s) ?? [];
    expect(awards).toEqual([
      "pull:figure:greg",
      "copies:figure:greg:2",
      "copies:figure:greg:3",
      "pull:figure:worm",
      "pull:figure:slug",
      ...[2, 3, 4, 5, 6, 7].map((n) => `copies:figure:slug:${n}`),
      "pull:thing:fountain",
      "copies:thing:fountain:2",
    ]);
    // The raid reads a figure's level from them: copies less one, 6 at most.
    expect(RAID.view(RAID.create(ctx()), { ...ctx(), awards }).roster).toEqual({ greg: 2, worm: 0, slug: 6 });
    // No other reader takes a copy's award for anything: the camp is sent each thing once, the table owns no look by it.
    const town = TOWN.advance(TOWN.create(ctx()), { ...ctx(), awards });
    const things = [figureThing("greg"), figureThing("worm"), figureThing("slug"), "fountain"];
    expect(town.camp.tray).toEqual(Object.fromEntries(things.map((id) => [id, 1])));
    expect(town.camp.earned.toSorted()).toEqual(things.toSorted());
    const table = RAID.create(ctx());
    expect(RAID.advance(table, { ...ctx(), awards: [...awards, "copies:look:gilt:2"] })).toBe(table);
  });

  it("keeps what earlier pulls gave: it reads, is in the history with its rarity, and is still the camp's and the table's", () => {
    const earlier = { "thing:fountain": 2, "look:baize": 1, "thing:plank-path": 1 };
    const won = { prize: "thing:fountain", pool: "grove", at: T0, top: 41 };
    // A member's pulls as they were stored before the pools gave figures, and after a ten-pull since.
    const before = { ...fresh(), have: earlier, history: [won], pulls: 4, seeds: 23 };
    const read = PULLS.decode(PULLS.encode(before));
    expect(read).toEqual(before);
    const after = done(read ?? before, pull("grove")).state;
    expect(after.have).toMatchObject(earlier);
    expect(after.history[0]).toEqual(won);
    expect(rarityOf(won.prize)).toBe("Treant");
    expect(Object.keys(after.have).filter((prize) => !(prize in earlier) && !prize.startsWith("figure:"))).toEqual([]);

    // The awards the other games read: the camp is sent each thing and each figure once, the table owns the look.
    const awards = PULLS.awards?.(after) ?? [];
    const figures = Object.keys(after.have).flatMap((prize) =>
      prize.startsWith("figure:") ? [figureThing(prize.slice(7))] : [],
    );
    const town = TOWN.advance(TOWN.create(ctx()), { ...ctx(), awards });
    expect(town.camp.tray).toEqual(Object.fromEntries(["fountain", "plank-path", ...figures].map((id) => [id, 1])));
    expect(figures.length).toBeGreaterThan(0);
    expect(RAID.advance(RAID.create(ctx()), { ...ctx(), awards }).looks.owned).toContain("baize");
  });
});

/**
 * Each tier's share of many pulls, worked out exactly from `RATES`. A top-tier prize ends a round of
 * pulls (by the 80th); within a round, each pull is followed through the chances of the mid counter.
 */
function expected(): { top: number; mid: number } {
  /** The chance of each value of the mid counter, still in the round. */
  let round = new Map([[0, 1]]);
  let pulls = 0;
  let mid = 0;
  for (let top = 1; top <= RATES.top.certainAt; top++) {
    const next = new Map<number, number>();
    for (const [m, p] of round) {
      pulls += p;
      const notTop = p * (1 - topChance(top));
      const midChance = m + 1 >= RATES.mid.certainAt ? 1 : RATES.mid.chance;
      mid += notTop * midChance;
      next.set(0, (next.get(0) ?? 0) + notTop * midChance);
      if (midChance < 1) next.set(m + 1, notTop * (1 - midChance));
    }
    round = next;
  }
  return { top: 1 / pulls, mid: mid / pulls };
}

describe("a million pulls", () => {
  const want = expected();
  const filler = 1 - want.top - want.mid;
  const { Leafkin, Sapling, Sprite } = RATES.filler;
  const { Dryad, Druid } = RATES.mid;
  /** Each rarity's share of many pulls: in a banner, or in the always-open pool, where every top-tier prize is a Treant. */
  const shares = (banner: boolean): Record<Rarity, number> => ({
    Leafkin: (filler * Leafkin) / (Leafkin + Sapling + Sprite),
    Sapling: (filler * Sapling) / (Leafkin + Sapling + Sprite),
    Sprite: (filler * Sprite) / (Leafkin + Sapling + Sprite),
    Dryad: (want.mid * Dryad) / (Dryad + Druid),
    Druid: (want.mid * Druid) / (Dryad + Druid),
    // A won 50/50 is the headliner, and a lost one owes the next: two top-tier prizes in three.
    Treant: banner ? want.top / 3 : want.top,
    Yggdrasil: banner ? (want.top * 2) / 3 : 0,
  });

  it.each<[string, Prizes]>([
    ["a banner", BANNER],
    ["the always-open pool", GROVE],
  ])(
    "from %s give only figures and its headliner, each tier and rarity as often as RATES works out to",
    (_pool, prizes) => {
      expect(want.top).toBeCloseTo(0.018696, 6);
      expect(want.mid).toBeCloseTo(0.121153, 6);
      const share = shares(prizes.Yggdrasil.length > 0);

      const N = 1_000_000;
      const got: Record<Rarity, number> = {
        Leafkin: 0,
        Sapling: 0,
        Sprite: 0,
        Dryad: 0,
        Druid: 0,
        Treant: 0,
        Yggdrasil: 0,
      };
      const drawn = new Set<string>();
      const c = counters();
      const s = { rng: 2026 };
      let longest = 0;
      let fillers = 0;
      let mostFillers = 0;
      for (let i = 0; i < N; i++) {
        const { prize, rarity, top } = draw(c, prizes, s);
        got[rarity] += 1;
        drawn.add(prize);
        longest = Math.max(longest, top);
        fillers = RARITIES[rarity].tier === "filler" ? fillers + 1 : 0;
        mostFillers = Math.max(mostFillers, fillers);
      }
      // Every figure comes, and nothing else but the banner's headliner.
      expect([...drawn].toSorted()).toEqual([...pooled.map(prizeOf), ...prizes.Yggdrasil].toSorted());
      // Few rounds ever reach the 80th pull: the chance on each pull from the 66th is high.
      expect(longest).toBeLessThanOrEqual(RATES.top.certainAt);
      expect(mostFillers).toBe(RATES.mid.certainAt - 1);
      expect(Math.abs((got.Treant + got.Yggdrasil) / N - want.top)).toBeLessThan(0.0005);
      expect(Math.abs((got.Dryad + got.Druid) / N - want.mid)).toBeLessThan(0.001);
      const rarities: Rarity[] = ["Leafkin", "Sapling", "Sprite", "Dryad", "Druid", "Treant", "Yggdrasil"];
      expect(rarities.filter((rarity) => Math.abs(got[rarity] / N - share[rarity]) >= 0.001)).toEqual([]);
    },
  );
});

/** The share of some prizes among what was drawn. */
const share = (seen: Map<string, number>, of: readonly string[]): number =>
  of.reduce((n, prize) => n + (seen.get(prize) ?? 0), 0) / [...seen.values()].reduce((a, b) => a + b, 0);

describe("a banner's featured figures", () => {
  const opens = Date.UTC(2026, 11, 8);
  const cat = catalogAt(eraAt(opens));
  const night = prizesOf(cat, "groot-night");
  const featured = featuredOf(cat, "groot-night");
  /** What many pulls draw of a rarity from Groot Night, from counters that make it that tier, with or without its featured figures. */
  function drawn(rarity: Rarity, top: number, mid: number, favoured: readonly string[]): Map<string, number> {
    const seen = new Map<string, number>();
    for (let seed = 0; seed < 40_000; seed++) {
      const d = draw(counters(top, mid, true), night, { rng: seed }, favoured);
      if (d.rarity === rarity) seen.set(d.prize, (seen.get(d.prize) ?? 0) + 1);
    }
    return seen;
  }

  it("are Groot Night's six, in its pool from its opening; the grove and banner-1 have none", () => {
    expect(featured.toSorted()).toEqual(
      ["figure:crab8", "figure:clutch", "figure:crab31", "figure:munch", "figure:peep", "figure:seqwawa"].toSorted(),
    );
    expect([featuredOf(cat, "grove"), featuredOf(cat, "banner-1")]).toEqual([[], []]);
    expect(featured.every((prize) => Object.values(night).flat().includes(prize))).toBe(true);
    expect(RATES.featured).toBe(0.5);
    // Before its release Groot Night has no prizes at all, so nothing featured.
    expect(featuredOf(catalogAt(eraAt(opens - 1)), "groot-night")).toEqual([]);
  });

  it("are one of a pull's prizes of their rarity half the time, evenly, and anything of it the other half", () => {
    // Sprite: Crab #31 and Munch of eight. 50% for them, and 2 in 8 of the rest: 62.5%, evenly.
    const sprites = drawn("Sprite", 0, 0, featured);
    expect(night.Sprite).toHaveLength(8);
    expect(share(sprites, ["figure:crab31", "figure:munch"])).toBeCloseTo(0.5 + 0.5 * (2 / 8), 1);
    expect((sprites.get("figure:crab31") ?? 0) / (sprites.get("figure:munch") ?? 1)).toBeCloseTo(1, 0);
    // Leafkin: Peep of eight, 56%; Druid: Clutch of three, 67%.
    expect(share(drawn("Leafkin", 0, 0, featured), ["figure:peep"])).toBeCloseTo(0.5 + 0.5 / 8, 1);
    expect(share(drawn("Druid", 0, 9, featured), ["figure:clutch"])).toBeCloseTo(0.5 + 0.5 / 3, 1);
    // Treant, from a lost 50/50 (owed is false here, so it is drawn): Crab #8 and Seqwawa of five, 70%.
    const treant = new Map<string, number>();
    for (let seed = 0; seed < 40_000; seed++) {
      const d = draw(counters(79), night, { rng: seed }, featured);
      if (d.rarity === "Treant") treant.set(d.prize, (treant.get(d.prize) ?? 0) + 1);
    }
    expect(night.Treant).toHaveLength(5);
    expect(share(treant, ["figure:crab8", "figure:seqwawa"])).toBeCloseTo(0.5 + 0.5 * (2 / 5), 1);
    // Without them the same pulls are even.
    expect(share(drawn("Sprite", 0, 0, []), ["figure:crab31", "figure:munch"])).toBeCloseTo(2 / 8, 1);
  });

  it("leave a rarity with none of them drawn as the grove draws it, stream and all", () => {
    for (let seed = 0; seed < 500; seed++) {
      const [a, b] = [counters(10, 9), counters(10, 9)];
      const [sa, sb] = [{ rng: seed }, { rng: seed }];
      const both = draw(a, night, sa, featured);
      const without = draw(b, night, sb);
      if (both.rarity !== "Dryad") continue;
      expect([both, a, sa]).toEqual([without, b, sb]);
    }
  });

  it("favour a pull from Groot Night, and never one from the grove", () => {
    let s = { ...fresh(), free: { waiting: 0, next: opens + DAY } };
    const at = ctx(opens);
    const notes: string[] = [];
    for (let i = 0; i < 120; i++) {
      const { state, notes: got } = done(s, pull("groot-night", 10, "leaf", opens), at);
      s = state;
      for (const n of got ?? []) if (n.rarity === "Sprite") notes.push(n.prize);
    }
    const favoured = notes.filter((p) => p === "figure:crab31" || p === "figure:munch").length / notes.length;
    expect(favoured).toBeGreaterThan(0.5);
    expect(favoured).toBeLessThan(0.75);
  });
});
