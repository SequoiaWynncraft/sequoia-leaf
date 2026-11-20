import { describe, expect, it } from "bun:test";

import {
  announcesCone,
  assignSpots,
  type Banner,
  bannerAt,
  bloomCyclesBetween,
  bloomFrom,
  bondOf,
  chargesAt,
  type ConePull,
  GROVE_RANKS,
  ODDS_SCALE,
  openCone,
  openCones,
  rankOfSpirit,
  rateCard,
  spendCharge,
  treeOf,
  treeVariant,
} from "./grove.ts";
import { playerId } from "./player.ts";
import { DEFAULT_RULES } from "./rules.ts";

const rules = DEFAULT_RULES.grove;
const alice = playerId("00000000-0000-4000-8000-00000000000a");
const bob = playerId("00000000-0000-4000-8000-00000000000b");
const carol = playerId("00000000-0000-4000-8000-00000000000c");

const banner = rules.banners[0] ?? fail("the default rules have no banner");
/** A banner whose featured spirit is the pity rank's other one, for a banner change. */
const nextBanner: Banner = { ...banner, id: "next", featured: "greg", from: banner.from + 1 };
const none = () => 0;

function fail(message: string): never {
  throw new Error(message);
}

/** The first roll from 0 up whose cone, opened with no pity, matches. */
function rollWhere(matches: (pull: ConePull) => boolean): number {
  for (let roll = 0; roll < 1_000_000; roll += 1) {
    if (matches(openCone(0, roll, none, banner, rules))) {
      return roll;
    }
  }
  return fail("no roll matches");
}

const commonRoll = rollWhere((pull) => pull.rank === "leafkin" && !pull.verdant);
const treantRoll = rollWhere((pull) => pull.rank === "treant");

describe("the rate card", () => {
  it("publishes odds that add up to every cone", () => {
    const card = rateCard(banner, rules);

    expect(rules.ranks.reduce((sum, rank) => sum + rank.odds, 0)).toBe(ODDS_SCALE);
    expect(card.ranks.reduce((sum, rank) => sum + rank.chance, 0)).toBeCloseTo(1, 12);
    for (const rank of card.ranks) {
      expect(rank.spirits.reduce((sum, spirit) => sum + spirit.chance, 0)).toBeCloseTo(rank.chance, 12);
    }
  });

  it("lists the ranks commonest first, with the client's odds", () => {
    const card = rateCard(banner, rules);

    expect(card.ranks.map((rank) => rank.rank)).toEqual([...GROVE_RANKS]);
    expect(card.ranks.map((rank) => rank.chance)).toEqual([0.4, 0.27, 0.16, 0.09, 0.05, 0.025, 0.005]);
  });

  it("gives the featured spirit its share of its rank, and the rank's others the rest evenly", () => {
    const treant = rateCard(banner, rules).ranks.find((rank) => rank.rank === "treant");

    expect(treant?.spirits).toEqual([
      { spirit: "rock", chance: 0.0125 },
      { spirit: "greg", chance: 0.0125 },
    ]);
  });

  it("shares a rank evenly between its spirits when no banner is on", () => {
    const treant = rateCard(undefined, rules).ranks.find((rank) => rank.rank === "treant");

    expect(treant?.spirits.map((spirit) => spirit.chance)).toEqual([0.0125, 0.0125]);
    expect(rateCard(undefined, rules).ranks.find((rank) => rank.rank === "leafkin")?.spirits[0]?.chance).toBeCloseTo(
      0.4 / 7,
      12,
    );
  });

  it("names the pity it guarantees", () => {
    expect(rateCard(banner, rules).pity).toEqual({ cones: 40, rank: "treant" });
  });
});

describe("opening a cone", () => {
  it("opens the same cone from the same roll and pity", () => {
    expect(openCone(12, 987_654_321, none, banner, rules)).toEqual(openCone(12, 987_654_321, none, banner, rules));
  });

  it("gives every spirit of every rank, at about the published odds", () => {
    const seen = new Map<string, number>();
    const ranks = new Map<string, number>();
    const cones = 400_000;
    for (let roll = 0; roll < cones; roll += 1) {
      // Each roll is a different member's first cone, so pity never lifts one.
      const pull = openCone(0, roll * 10_007, none, banner, rules);
      seen.set(pull.spirit, (seen.get(pull.spirit) ?? 0) + 1);
      ranks.set(pull.rank, (ranks.get(pull.rank) ?? 0) + 1);
    }

    for (const card of rateCard(banner, rules).ranks) {
      // Within 5% of the expected count, or a few cones for the rarest.
      const expected = card.chance * cones;
      expect(Math.abs((ranks.get(card.rank) ?? 0) - expected)).toBeLessThan(Math.max(expected * 0.05, 60));
      for (const spirit of card.spirits) {
        const expectedSpirit = spirit.chance * cones;
        expect(Math.abs((seen.get(spirit.spirit) ?? 0) - expectedSpirit)).toBeLessThan(
          Math.max(expectedSpirit * 0.06, 60),
        );
      }
    }
  });

  it("counts a cone below the pity rank toward pity, and resets it on one at or above", () => {
    expect(openCone(5, commonRoll, none, banner, rules)).toMatchObject({ pityBefore: 5, pityAfter: 6 });
    expect(openCone(5, treantRoll, none, banner, rules)).toMatchObject({
      rank: "treant",
      pityAfter: 0,
      guaranteed: false,
    });
  });

  it("lifts the fortieth cone without a Treant to one", () => {
    const pull = openCone(39, commonRoll, none, banner, rules);

    expect(pull).toMatchObject({ rank: "treant", guaranteed: true, pityBefore: 39, pityAfter: 0 });
    expect(["rock", "greg"]).toContain(pull.spirit);
  });

  it("does not lift the thirty-ninth", () => {
    expect(openCone(38, commonRoll, none, banner, rules)).toMatchObject({ rank: "leafkin", guaranteed: false });
  });

  it("carries pity from one cone to the next, and from one banner to the next", () => {
    const first = openCones(
      0,
      Array.from({ length: 30 }, () => commonRoll),
      new Map(),
      banner,
      rules,
    );
    const pity = first.at(-1)?.pityAfter ?? fail("no cones");
    const second = openCones(
      pity,
      Array.from({ length: 10 }, () => commonRoll),
      new Map(),
      nextBanner,
      rules,
    );

    expect(pity).toBe(30);
    expect(second.map((pull) => pull.guaranteed)).toEqual([...Array.from({ length: 9 }, () => false), true]);
    expect(second.at(-1)).toMatchObject({ rank: "treant", pityBefore: 39, pityAfter: 0 });
  });

  it("names which copy of a spirit each cone is, counting the cones opened with it", () => {
    const pulls = openCones(0, [commonRoll, commonRoll, commonRoll], new Map([["x", 1]]), banner, rules);
    const spirit = pulls[0]?.spirit ?? fail("no cones");

    expect(pulls.map((pull) => pull.copy)).toEqual([1, 2, 3]);
    expect(openCones(0, [commonRoll], new Map([[spirit, 2]]), banner, rules)[0]?.copy).toBe(3);
  });

  it("turns the fourth copy of a spirit Verdant", () => {
    const pulls = openCones(
      0,
      Array.from({ length: 4 }, () => commonRoll),
      new Map(),
      banner,
      rules,
    );

    expect(pulls.map((pull) => pull.verdant)).toEqual([false, false, false, true]);
  });

  it("only gives spirits that belong to the rank it lands on", () => {
    for (let roll = 0; roll < 5_000; roll += 1) {
      const pull = openCone(roll % 40, roll * 7_919, none, banner, rules);
      expect(rankOfSpirit(pull.spirit, rules)).toBe(pull.rank);
    }
  });

  it("announces cones from Dryad up, so the Forest is not flooded", () => {
    expect(GROVE_RANKS.filter((rank) => announcesCone(rank, rules))).toEqual(["dryad", "druid", "treant", "yggdrasil"]);
  });
});

describe("banners", () => {
  it("has none before the first one starts, and the latest started after", () => {
    expect(bannerAt(banner.from - 1, rules)).toBeUndefined();
    expect(bannerAt(banner.from, rules)?.id).toBe(banner.id);
    const later = { ...rules, banners: [banner, nextBanner] };
    expect(bannerAt(nextBanner.from, later)?.id).toBe("next");
  });
});

describe("bonds", () => {
  it("deepens with each copy up to five hearts", () => {
    expect([0, 1, 2, 5, 9].map((copies) => bondOf(copies, rules))).toEqual([0, 1, 2, 5, 5]);
  });
});

describe("Bloom", () => {
  it("fills to ten and starts again, never decaying", () => {
    expect(bloomFrom(0, rules)).toEqual({ bloom: 0, cycles: 0 });
    expect(bloomFrom(9, rules)).toEqual({ bloom: 9, cycles: 0 });
    expect(bloomFrom(10, rules)).toEqual({ bloom: 0, cycles: 1 });
    expect(bloomFrom(23, rules)).toEqual({ bloom: 3, cycles: 2 });
  });

  it("names each cycle a gain completes, once", () => {
    expect(bloomCyclesBetween(8, 9, rules)).toEqual([]);
    expect(bloomCyclesBetween(9, 10, rules)).toEqual([1]);
    expect(bloomCyclesBetween(10, 10, rules)).toEqual([]);
    expect(bloomCyclesBetween(18, 41, rules)).toEqual([2, 3, 4]);
  });
});

describe("care charges", () => {
  const every = rules.chargeSeconds * 1000;
  const t0 = Date.UTC(2026, 10, 20, 12);

  it("starts with a full bank", () => {
    expect(chargesAt(null, t0, rules)).toEqual({ charges: 6, nextAt: null });
  });

  it("spends one charge and brings it back after a charge's time", () => {
    const anchor = spendCharge(null, t0, rules);

    expect(chargesAt(anchor, t0, rules)).toEqual({ charges: 5, nextAt: t0 + every });
    expect(chargesAt(anchor, t0 + every - 1, rules).charges).toBe(5);
    expect(chargesAt(anchor, t0 + every, rules)).toEqual({ charges: 6, nextAt: null });
  });

  it("refuses a care with no charge left", () => {
    let anchor: number | null = null;
    for (let spent = 0; spent < 6; spent += 1) {
      anchor = spendCharge(anchor, t0, rules);
    }

    expect(chargesAt(anchor, t0, rules).charges).toBe(0);
    expect(spendCharge(anchor, t0, rules)).toBeNull();
  });

  it("costs nothing to miss days: a full bank waits, and never banks past full", () => {
    const anchor = spendCharge(null, t0, rules);
    const weekLater = t0 + 7 * 24 * 60 * 60 * 1000;

    expect(chargesAt(anchor, weekLater, rules)).toEqual({ charges: 6, nextAt: null });
    // Spending one then is the same as spending one from a fresh bank: the time away is not saved up.
    expect(spendCharge(anchor, weekLater, rules)).toBe(spendCharge(null, weekLater, rules));
  });

  it("counts a part-filled charge toward the next", () => {
    const anchor = spendCharge(spendCharge(null, t0, rules), t0, rules);
    const later = t0 + every / 2;

    expect(chargesAt(anchor, later, rules)).toEqual({ charges: 4, nextAt: t0 + every });
  });
});

describe("trees", () => {
  it("grows with the member's SEQ level and has no XP of its own", () => {
    expect(treeOf(alice, 0, DEFAULT_RULES.levels, rules).level).toBe(1);
    expect(treeOf(alice, 2250, DEFAULT_RULES.levels, rules).level).toBe(3);
  });

  it("keeps one of three looks per member, the same every time", () => {
    const variants = [alice, bob, carol].map((member) => treeVariant(member, rules));

    expect(variants.every((variant) => variant >= 0 && variant < 3)).toBe(true);
    expect([alice, bob, carol].map((member) => treeVariant(member, rules))).toEqual(variants);
  });

  it("hashes the member as the Grove client hashes a seed, so both pick the same look", () => {
    for (const member of [alice, bob, carol]) {
      expect(treeVariant(member, rules)).toBe(clientVariant(member));
    }
  });
});

/** The Grove client's `variantOf(seed, 3)` (`hashString` in its engine), to check the server's against. */
function clientVariant(seed: string): number {
  let value = 2166136261 >>> 0;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return (value >>> 0) % 3;
}

describe("spots in the Forest", () => {
  it("gives newcomers the spots nearest the heart, the most senior first", () => {
    expect([...assignSpots([], [alice, bob, carol])]).toEqual([
      [alice, 0],
      [bob, 1],
      [carol, 2],
    ]);
  });

  it("never moves anyone when a member joins", () => {
    const first = assignSpots([], [alice, bob]);
    const next = assignSpots(first.values(), [carol]);

    expect([...next]).toEqual([[carol, 2]]);
  });

  it("fills a spot left free before going further out", () => {
    expect([...assignSpots([0, 2, 3], [alice, bob])]).toEqual([
      [alice, 1],
      [bob, 4],
    ]);
  });
});
