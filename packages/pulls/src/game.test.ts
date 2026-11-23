import { describe, expect, it } from "bun:test";

import { type Ctx, isRefused } from "@sequoia-leaf/core";
import { isBoughtLook } from "@sequoia-leaf/raid/content/looks.ts";
import { isThing } from "@sequoia-leaf/town/things.ts";

import {
  BANNERS,
  type Counters,
  draw,
  headliner,
  HISTORY,
  PRIZES,
  PULLS,
  type Pulls,
  type PullsCommand,
  RARITIES,
  type Rarity,
  rarityOf,
  RATES,
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
});
const fresh = (): Pulls => PULLS.create(ctx());
const counters = (top = 0, mid = 0, owed = false): Counters => ({ top, mid, owed });
const pull = (pool: string, n: 1 | 10 = 10, paid: "leaf" | "free" = "leaf"): PullsCommand => ({
  do: "pull",
  pool,
  n,
  with: paid,
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
/** The tiers drawn from the same counters with each of `n` streams. */
const tiers = (c: Counters, n: number) =>
  new Set(Array.from({ length: n }, (_, seed) => RARITIES[draw({ ...c }, null, { rng: seed }).rarity].tier));

/** Whether a prize is something the town or the raid has, or a banner's headliner. */
function known(prize: string): boolean {
  const [kind = "", id = ""] = prize.split(/:(.*)/);
  if (kind === "thing") return isThing(id);
  if (kind === "look") return isBoughtLook(id);
  return kind === "headliner" && BANNERS.some((banner) => banner.id === id);
}

describe("the prizes", () => {
  it("are things the town and the raid have, each once, filler by the market's prices", () => {
    const all = Object.values(PRIZES).flat();
    expect(all.filter((prize) => !known(prize))).toEqual([]);
    expect(new Set(all).size).toBe(all.length);
    expect(PRIZES.Leafkin).toEqual(
      ["rock", "stepping-stones", "plank-path", "log-fence", "picket", "pinecone", "painted-pebble", "acorn-jar"].map(
        (id) => `thing:${id}`,
      ),
    );
    expect(PRIZES.Sapling).toContain("thing:sunflower");
    expect(PRIZES.Sprite).toContain("thing:toadstool");
    expect(PRIZES.Yggdrasil).toEqual(["headliner:banner-1"]);
    // The town has a statue to send for each banner's headliner, and nothing is a ware any more.
    expect(BANNERS.filter(({ id }) => !isThing(`statue-${id}`))).toEqual([]);
    expect(all.filter((prize) => prize.startsWith("ware:"))).toEqual([]);
    expect(rarityOf("look:plum")).toBe("Druid");
    expect(rarityOf("look:bare")).toBeUndefined();
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
      const first = draw(c, headliner("banner-1"), s);
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
      expect(draw(c, headliner("banner-2"), s)).toEqual({
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
    expect(draw(grove, null, { rng: 1 })).toMatchObject({ rarity: "Treant", top: 80 });
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
    expect(refused(s, pull("grove"), ctx(Date.UTC(2030, 0, 1)))).toBeNull();
    expect(PULLS.view(s, ctx()).open).toEqual([{ id: "banner-1", until: Date.UTC(2026, 11, 8) }]);
    expect(PULLS.view(s, ctx(Date.UTC(2026, 11, 8))).open).toEqual([]);
    expect(PULLS.command({ id: "c-1", ...pull("banner-9") })).toBeNull();
    expect(PULLS.command({ ...pull("grove"), n: 5 })).toBeNull();
  });

  it("is not for a guest", () => {
    const s = { ...fresh(), seeds: 500 };
    expect(refused(s, pull("grove", 1, "free"), ctx(T0, true))).toBe("members_only");
    expect(refused(s, exchange("look:baize"), ctx(T0, true))).toBe("members_only");
  });

  it("takes 1,000 Leaf, ten at once as one spend keyed by the pulls before them", () => {
    const ten = done(fresh(), pull("grove"));
    expect(ten.leaf).toEqual([{ amount: 10_000, reason: "Pulls: 10 in grove", key: "pull:0" }]);
    expect(done(ten.state, pull("banner-1", 1)).leaf).toEqual([
      { amount: 1000, reason: "Pulls: 1 in banner-1", key: "pull:10" },
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
  it("buy a mid-tier prize the player does not have: 60 for a Dryad one, 150 for a Druid one", () => {
    const s = { ...fresh(), seeds: 200 };
    expect(refused(s, exchange("thing:fountain"))).toBe("not_for_seeds");
    expect(refused(s, exchange("thing:rock"))).toBe("not_for_seeds");
    expect(refused(s, exchange("headliner:banner-1"))).toBe("not_for_seeds");
    expect(refused(s, exchange("nothing"))).toBe("not_for_seeds");
    const dryad = done(s, exchange("look:baize"));
    expect(dryad.notes).toEqual([{ t: "exchange", prize: "look:baize", rarity: "Dryad", have: 1 }]);
    expect(dryad.state.seeds).toBe(140);
    expect(refused(dryad.state, exchange("look:baize"))).toBe("owned");
    expect(refused(dryad.state, exchange("look:plum"))).toBe("not_enough_seeds");
    expect(refused(dryad.state, exchange("ware:crown"))).toBe("not_for_seeds");
    const druid = done({ ...dryad.state, seeds: 150 }, exchange("look:plum"));
    expect([druid.state.seeds, druid.state.have["look:plum"], druid.state.pulls]).toEqual([0, 1, 0]);
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
    expect(PULLS.decode(PULLS.encode({ ...s, have: { "thing:rock": 0 } }))).toBeNull();
    expect(PULLS.decode(PULLS.encode({ ...s, counters: { ...s.counters, banner: counters(80) } }))).toBeNull();
    const { rng, ...shown } = s;
    expect(rng).toBeNumber();
    expect(PULLS.view(s, ctx())).toEqual({ ...shown, open: [{ id: "banner-1", until: Date.UTC(2026, 11, 8) }] });
    expect(PULLS.awards?.(s)).toEqual(Object.keys(s.have).map((prize) => `pull:${prize}`));
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
  it("give each tier and rarity its share of what RATES works out to, within a small margin", () => {
    const want = expected();
    expect(want.top).toBeCloseTo(0.018696, 6);
    expect(want.mid).toBeCloseTo(0.121153, 6);
    const filler = 1 - want.top - want.mid;
    const { Leafkin, Sapling, Sprite } = RATES.filler;
    const { Dryad, Druid } = RATES.mid;
    const share: Record<Rarity, number> = {
      Leafkin: (filler * Leafkin) / (Leafkin + Sapling + Sprite),
      Sapling: (filler * Sapling) / (Leafkin + Sapling + Sprite),
      Sprite: (filler * Sprite) / (Leafkin + Sapling + Sprite),
      Dryad: (want.mid * Dryad) / (Dryad + Druid),
      Druid: (want.mid * Druid) / (Dryad + Druid),
      // A won 50/50 is the headliner, and a lost one owes the next: two top-tier prizes in three.
      Treant: want.top / 3,
      Yggdrasil: (want.top * 2) / 3,
    };

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
    const c = counters();
    const s = { rng: 2026 };
    let longest = 0;
    let fillers = 0;
    let mostFillers = 0;
    for (let i = 0; i < N; i++) {
      const { rarity, top } = draw(c, headliner("banner-1"), s);
      got[rarity] += 1;
      longest = Math.max(longest, top);
      fillers = RARITIES[rarity].tier === "filler" ? fillers + 1 : 0;
      mostFillers = Math.max(mostFillers, fillers);
    }
    // Few rounds ever reach the 80th pull: the chance on each pull from the 66th is high.
    expect(longest).toBeLessThanOrEqual(RATES.top.certainAt);
    expect(mostFillers).toBe(RATES.mid.certainAt - 1);
    expect(Math.abs((got.Treant + got.Yggdrasil) / N - want.top)).toBeLessThan(0.0005);
    expect(Math.abs((got.Dryad + got.Druid) / N - want.mid)).toBeLessThan(0.001);
    const rarities: Rarity[] = ["Leafkin", "Sapling", "Sprite", "Dryad", "Druid", "Treant", "Yggdrasil"];
    expect(rarities.filter((rarity) => Math.abs(got[rarity] / N - share[rarity]) >= 0.001)).toEqual([]);
  });
});
