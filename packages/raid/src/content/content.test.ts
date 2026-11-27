import { describe, expect, test } from "bun:test";

import { CASTS } from "../fight/abilities.ts";
import { COLS, HOME_ROWS } from "../hex.ts";
import type { Carrier } from "../party.ts";
import { BOON_IDS, boonIn, boonText, giftOf } from "./boons.ts";
import { available, catalogAt } from "./catalog.ts";
import {
  abilityText,
  BOSS_IDS,
  FIGURE_IDS,
  type FigureId,
  figureIn,
  specOf,
  SUMMON_IDS,
  type Tier,
  TIERS,
  traitsOf,
  TROUBLE_IDS,
  type UnitKind,
} from "./figures.ts";
import {
  COMPONENT_IDS,
  EMBLEM_IDS,
  emblemTrait,
  FINISHED_IDS,
  halvesOf,
  HOLDS,
  type ItemId,
  itemIn,
  itemName,
  itemQuip,
  itemStats,
  itemText,
} from "./items.ts";
import { MEMBER_IDS } from "./members.ts";
import { combine, holdItem } from "./recipes.ts";
import { LEGACY_ERA } from "./releases.ts";

/** Everyone's figures of a tier, as the carousel would ring them. */
const figuresOfTier = (tier: Tier): readonly FigureId[] => available(catalogAt(LEGACY_ERA), { for: "carousel", tier });
import { CAT } from "../testkit.ts";
import { BOSS_ROOMS, ECONOMY, MAX_LEVEL, ROOMS, sellPrice, STALL_ODDS, TRAILS, worth } from "./rooms.ts";
import { CALLINGS, KINS, stepFor, TRAIT_IDS, traitIn, traitText } from "./traits.ts";

const EVERYONE: readonly UnitKind[] = [...FIGURE_IDS, ...MEMBER_IDS, ...SUMMON_IDS, ...TROUBLE_IDS];
/** A Worm (a Burrow and a Sneak) holding these. */
const worm = (items: ItemId[]): Carrier => ({ kind: "worm", items });
/** The mean health of a tier's figures. */
const mean = (tier: 1 | 2 | 3 | 4 | 5): number => {
  const list = figuresOfTier(tier);
  return list.reduce((sum, id) => sum + figureIn(CAT, id).hp, 0) / list.length;
};

describe("the roster", () => {
  test("is twenty-nine figures in five tiers: 7, 7, 6, 5, 4", () => {
    expect(FIGURE_IDS.length).toBe(29);
    expect(TIERS.map((tier) => figuresOfTier(tier).length)).toEqual([7, 7, 6, 5, 4]);
  });
  test("everyone has a name of their own", () => {
    const names = EVERYONE.map((kind) => specOf(CAT, kind).name);
    expect(new Set(names).size).toBe(names.length);
  });
  test("every kin has four members, on at least three tiers, starting cheap", () => {
    // Graid is the five named after the guild's raids, a kin as a third trait for four of them.
    for (const kin of KINS.filter((k) => k !== "graid")) {
      const members = FIGURE_IDS.filter((id) => figureIn(CAT, id).kin === kin);
      expect(members.length).toBe(4);
      expect(new Set(members.map((id) => figureIn(CAT, id).tier)).size).toBeGreaterThanOrEqual(3);
      // The two cheapest tiers each have one, so any kin can be started from the first rooms.
      expect(members.some((id) => figureIn(CAT, id).tier === 1)).toBe(true);
      expect(members.some((id) => figureIn(CAT, id).tier === 2)).toBe(true);
    }
  });
  test("every calling has four to six members across the tiers, enough for its top step", () => {
    for (const calling of CALLINGS) {
      const members = FIGURE_IDS.filter((id) => traitsOf(CAT, id).includes(calling));
      expect(members.length).toBeGreaterThanOrEqual(4);
      expect(members.length).toBeLessThanOrEqual(6);
      expect(new Set(members.map((id) => figureIn(CAT, id).tier)).size).toBeGreaterThanOrEqual(3);
      // Fang's top step takes an emblem until a sixth Fang joins: Orphion left it for Sage.
      if (calling !== "fang") expect(members.length).toBeGreaterThanOrEqual(traitIn(CAT, calling).steps.at(-1) ?? 0);
    }
  });
  test("only the dearest carry a third trait, and the Graid figures; nobody more than three", () => {
    for (const id of FIGURE_IDS) {
      if (figureIn(CAT, id).extra.length > 0 && figureIn(CAT, id).tier < 5)
        expect(figureIn(CAT, id).extra).toEqual(["graid"]);
      expect(traitsOf(CAT, id).length).toBeLessThanOrEqual(3);
    }
  });
  test("Graid is the five named after the guild's raids: Worm, Moth, Rock, Greg and Orphion", () => {
    expect(FIGURE_IDS.filter((id) => traitsOf(CAT, id).includes("graid"))).toEqual([
      "moth",
      "worm",
      "rock",
      "greg",
      "whitefox",
    ]);
    expect(traitsOf(CAT, "greg")).toEqual(["graid", "bulwark", "greg"]);
    expect(traitsOf(CAT, "whitefox")).toEqual(["mist", "sage", "graid"]);
    expect(traitsOf(CAT, "seqwawa")).toEqual(["moss", "mender", "rooted"]);
    expect(FIGURE_IDS.filter((id) => traitsOf(CAT, id).includes("moss"))).toEqual([
      "mossmote",
      "slug",
      "leafling",
      "seqwawa",
    ]);
  });
  test("dearer figures are sturdier, tier by tier", () => {
    for (const tier of [2, 3, 4, 5] as const) {
      const below = tier === 2 ? 1 : tier === 3 ? 2 : tier === 4 ? 3 : 4;
      expect(mean(tier)).toBeGreaterThan(mean(below));
    }
  });
  test("everyone with a mana bar has an ability to spend it on, and a sentence for it with no gaps", () => {
    for (const kind of EVERYONE) {
      const spec = specOf(CAT, kind);
      if (spec.mana[1] > 0) {
        expect(CASTS[kind]).toBeDefined();
        expect(spec.ability).not.toBeNull();
        expect(spec.mana[0]).toBeLessThan(spec.mana[1]);
      }
      for (const stars of [1, 2, 3] as const) {
        const text = abilityText(CAT, kind, stars);
        expect(text).not.toContain("{");
        if (spec.ability) expect(text.length).toBeGreaterThan(10);
      }
      expect(spec.quip.length).toBeGreaterThan(3);
    }
  });
  test("an ability's numbers never get worse with stars", () => {
    for (const kind of EVERYONE) {
      for (const [a, b, c] of Object.values(specOf(CAT, kind).ability?.n ?? {})) {
        expect(b).toBeGreaterThanOrEqual(a);
        expect(c).toBeGreaterThanOrEqual(b);
      }
    }
  });
  test("bosses and trouble are not for sale", () => {
    const forSale: readonly string[] = FIGURE_IDS;
    for (const id of TROUBLE_IDS) expect(forSale).not.toContain(id);
    expect(BOSS_IDS).toContain("bigcrab");
    expect(specOf(CAT, "bigcrab").name).toBe("The Crab Nobody Counted");
  });
});

describe("traits", () => {
  test("there are eight kins and six callings", () => {
    expect(KINS.length).toBe(8);
    expect(CALLINGS.length).toBe(6);
  });
  test("each has a sentence for every step, with no gaps, and numbers for every step", () => {
    for (const id of TRAIT_IDS) {
      const spec = traitIn(CAT, id);
      expect(spec.text.length).toBe(spec.steps.length);
      for (const list of Object.values(spec.n)) expect(list.length).toBe(spec.steps.length);
      for (let step = 1; step <= spec.steps.length; step++) expect(traitText(CAT, id, step)).not.toContain("{");
    }
  });
  test("a step switches on at its count", () => {
    expect(stepFor(CAT, "ember", 1)).toBe(0);
    expect(stepFor(CAT, "ember", 2)).toBe(1);
    expect(stepFor(CAT, "ember", 3)).toBe(1);
    expect(stepFor(CAT, "ember", 4)).toBe(2);
    expect(stepFor(CAT, "bulwark", 6)).toBe(3);
    expect(stepFor(CAT, "greg", 1)).toBe(1);
    expect([1, 2, 3, 4, 5].map((n) => stepFor(CAT, "graid", n))).toEqual([0, 1, 2, 2, 3]);
    expect([1, 2, 3, 4].map((n) => stepFor(CAT, "moss", n))).toEqual([0, 1, 2, 3]);
    expect([1, 2, 3, 4].map((n) => stepFor(CAT, "mender", n))).toEqual([0, 1, 2, 3]);
  });
});

describe("items", () => {
  test("five components make fifteen things, one for every pair", () => {
    expect(COMPONENT_IDS.length).toBe(5);
    expect(FINISHED_IDS.length).toBe(15);
    const made = new Set<string>();
    for (const a of COMPONENT_IDS) {
      for (const b of COMPONENT_IDS) {
        expect(combine(CAT, a, b)).toEqual(combine(CAT, b, a));
        made.add(combine(CAT, a, b)?.id ?? "nothing");
      }
    }
    expect(made.size).toBe(15);
  });
  test("each component is a single stat", () => {
    for (const id of COMPONENT_IDS) {
      const s = itemIn(CAT, id).stats;
      const kinds = [s.attack, s.speed, s.power, s.armour + s.ward, s.health].filter((n) => n > 0);
      expect(kinds.length).toBe(1);
    }
  });
  test("a finished item has both halves' stats and a sentence with no gaps", () => {
    for (const id of FINISHED_IDS) {
      const [a, b] = halvesOf(CAT, id);
      const whole = itemStats(CAT, id);
      expect(whole.attack).toBe(itemIn(CAT, a).stats.attack + itemIn(CAT, b).stats.attack);
      expect(whole.health).toBe(itemIn(CAT, a).stats.health + itemIn(CAT, b).stats.health);
      expect(whole.armour).toBe(itemIn(CAT, a).stats.armour + itemIn(CAT, b).stats.armour);
      expect(itemText(CAT, id)).not.toContain("{");
    }
    const names = FINISHED_IDS.map((id) => itemName(CAT, id));
    expect(new Set(names).size).toBe(15);
  });
  test("a second component forges with the first; a third thing takes a free place; a fourth is refused", () => {
    expect(holdItem(CAT, worm([]), "thorn")).toEqual({ held: ["thorn"], made: null, forged: null, with: null });
    expect(holdItem(CAT, worm(["thorn"]), "plume")).toEqual({
      held: ["wasptail"],
      made: { gives: "item", id: "wasptail" },
      forged: "wasptail",
      with: "thorn",
    });
    expect(holdItem(CAT, worm(["wasptail", "stump"]), "bark")).toMatchObject({ held: ["wasptail", "stump", "bark"] });
    // Full of finished things: nothing more fits.
    expect(holdItem(CAT, worm(["wasptail", "stump", "hoard"]), "bark")).toEqual({ refused: "hands_full" });
    // Full, but one is a loose component: another component still forges with it.
    expect(holdItem(CAT, worm(["wasptail", "stump", "bark"]), "bark")).toMatchObject({
      held: ["wasptail", "stump", "stump"],
    });
    expect(holdItem(CAT, worm(["wasptail", "stump", "bark"]), "hoard")).toEqual({ refused: "hands_full" });
    expect(HOLDS).toBe(3);
  });
  test("an emblem takes a place of its own and never forges: components still pair up around it", () => {
    expect(holdItem(CAT, worm([]), "crabcharm")).toEqual({ held: ["crabcharm"], made: null, forged: null, with: null });
    expect(holdItem(CAT, worm(["crabcharm"]), "thorn")).toEqual({
      held: ["crabcharm", "thorn"],
      made: null,
      forged: null,
      with: null,
    });
    expect(holdItem(CAT, worm(["crabcharm", "thorn"]), "plume")).toEqual({
      held: ["crabcharm", "wasptail"],
      made: { gives: "item", id: "wasptail" },
      forged: "wasptail",
      with: "thorn",
    });
    expect(holdItem(CAT, worm(["thorn"]), "crabcharm")).toEqual({
      held: ["thorn", "crabcharm"],
      made: null,
      forged: null,
      with: null,
    });
    expect(holdItem(CAT, worm(["crabcharm", "wasptail", "stump"]), "mistcharm")).toEqual({ refused: "hands_full" });
    expect(holdItem(CAT, worm(["crabcharm", "wasptail", "thorn"]), "plume")).toMatchObject({
      held: ["crabcharm", "wasptail", "wasptail"],
    });
  });
  test("an emblem is refused by a figure that carries its kin already, by its own kin or the same emblem", () => {
    expect(holdItem(CAT, worm([]), "burrowcharm")).toEqual({ refused: "already_kin" });
    expect(holdItem(CAT, worm(["crabcharm"]), "crabcharm")).toEqual({ refused: "already_kin" });
    // A Worm's calling is not a kin: any other emblem is held.
    expect(holdItem(CAT, worm(["crabcharm"]), "feathercharm")).toMatchObject({ held: ["crabcharm", "feathercharm"] });
    // Refused for the kin even with no place left.
    expect(holdItem(CAT, worm(["wasptail", "stump", "hoard"]), "burrowcharm")).toEqual({ refused: "already_kin" });
  });
  test("an emblem adds no stats, and is named and quipped as the charm that gives it", () => {
    for (const id of EMBLEM_IDS) {
      expect(Object.values(itemStats(CAT, id)).every((n) => n === 0)).toBe(true);
      expect(itemName(CAT, id)).toBe(boonIn(CAT, id).name);
      expect(itemQuip(CAT, id)).toBe(boonIn(CAT, id).quip);
      expect(itemText(CAT, id)).toContain(traitIn(CAT, emblemTrait(CAT, id)).name);
    }
  });
});

describe("boons", () => {
  test("there are about eighteen, with a charm for every kin, each giving the emblem of its own id", () => {
    expect(BOON_IDS.length).toBeGreaterThanOrEqual(16);
    expect(BOON_IDS.length).toBeLessThanOrEqual(22);
    expect(BOON_IDS.filter((id) => boonIn(CAT, id).sort === "charm")).toEqual([...EMBLEM_IDS]);
    expect(BOON_IDS.flatMap((id) => giftOf(CAT, id))).toEqual([...EMBLEM_IDS]);
    // Every kin but Graid, whose emblem comes with its banner.
    for (const kin of KINS)
      expect(EMBLEM_IDS.filter((id) => emblemTrait(CAT, id) === kin).length).toBe(kin === "graid" ? 0 : 1);
    for (const id of BOON_IDS) expect(boonText(CAT, id)).not.toContain("{");
  });
});

describe("the run's tables", () => {
  test("fifteen rooms: three wings of five, each ending in a boss, in the order planned", () => {
    expect(ROOMS.map((r) => r.kind[0]).join("")).toBe("ttssbstssbsstsb");
    expect(ROOMS.map((r) => r.wing)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
    expect(BOSS_ROOMS).toEqual([4, 9, 14]);
    expect(ROOMS[14]?.plans[0]?.party.some(([kind]) => kind === "bigcrab")).toBe(true);
  });
  test("trouble stands on seats of its own half, nobody on the same one, on every trail", () => {
    for (const room of ROOMS) {
      if (room.kind === "spar") {
        expect(room.spar).not.toBeNull();
        continue;
      }
      expect(room.plans.length).toBeGreaterThan(0);
      for (const plan of room.plans) {
        for (let trail = 0; trail < TRAILS.length; trail++) {
          const there = plan.party.filter(([, , , , from]) => (from ?? 0) <= trail);
          expect(there.length).toBeGreaterThan(0);
          const seats = there.map(([, , col, row]) => row * COLS + col);
          expect(new Set(seats).size).toBe(seats.length);
          for (const [, , col, row] of there) {
            expect(col).toBeGreaterThanOrEqual(0);
            expect(col).toBeLessThan(COLS);
            expect(row).toBeGreaterThanOrEqual(0);
            expect(row).toBeLessThan(HOME_ROWS);
          }
        }
      }
    }
  });
  test("later trails never have less in a room", () => {
    for (const room of ROOMS) {
      for (const plan of room.plans) {
        const count = (trail: number): number => plan.party.filter(([, , , , from]) => (from ?? 0) <= trail).length;
        expect(count(1)).toBeGreaterThanOrEqual(count(0));
        expect(count(2)).toBeGreaterThanOrEqual(count(1));
      }
    }
    for (let i = 1; i < TRAILS.length; i++) {
      expect(TRAILS[i]?.spent ?? 0).toBeGreaterThan(TRAILS[i - 1]?.spent ?? 0);
      expect(TRAILS[i]?.boss ?? 0).toBeGreaterThan(TRAILS[i - 1]?.boss ?? 0);
      expect(TRAILS[i]?.pays ?? 0).toBeGreaterThan(TRAILS[i - 1]?.pays ?? 0);
    }
  });
  test("the stall's odds add up, start with only the cheapest, and keep the dearest rare", () => {
    expect(STALL_ODDS.length).toBe(MAX_LEVEL);
    expect(MAX_LEVEL).toBe(8);
    for (const odds of STALL_ODDS) expect(odds.reduce((a, b) => a + b, 0)).toBe(100);
    expect(STALL_ODDS[0]).toEqual([100, 0, 0, 0, 0]);
    STALL_ODDS.forEach((odds, i) => {
      if (i + 1 < 6) expect(odds[4]).toBe(0);
      expect(odds[4]).toBeLessThanOrEqual(10);
    });
  });
  test("selling gives back the price at one star and a little less for merged ones", () => {
    for (const tier of TIERS) {
      expect(sellPrice(tier, 1)).toBe(tier);
      expect(sellPrice(tier, 2)).toBe(worth(tier, 2) - 1);
      expect(sellPrice(tier, 3)).toBe(worth(tier, 3) - 2);
    }
  });
  test("a loss can never cost more than seven", () => {
    expect(ECONOMY.lossMost).toBe(7);
    expect(ECONOMY.lossBase).toBe(2);
    expect(ECONOMY.resolve).toBe(20);
  });
});
