import { describe, expect, test } from "bun:test";

import { CASTS } from "../fight/abilities.ts";
import { COLS, HOME_ROWS } from "../hex.ts";
import { BOON_IDS, BOONS, boonText } from "./boons.ts";
import {
  abilityText,
  BOSS_IDS,
  FIGURE_IDS,
  FIGURES,
  figuresOfTier,
  specOf,
  SUMMON_IDS,
  TIERS,
  traitsOf,
  TROUBLE_IDS,
  type UnitKind,
} from "./figures.ts";
import {
  COMPONENT_IDS,
  COMPONENTS,
  FINISHED,
  FINISHED_IDS,
  forge,
  holdItem,
  HOLDS,
  itemStats,
  itemText,
} from "./items.ts";
import { MILESTONES } from "./keepsakes.ts";
import { BOSS_ROOMS, ECONOMY, MAX_LEVEL, ROOMS, sellPrice, STALL_ODDS, TRAILS, worth } from "./rooms.ts";
import { CALLINGS, KINS, stepFor, TRAIT_IDS, TRAITS, traitText } from "./traits.ts";

const EVERYONE: readonly UnitKind[] = [...FIGURE_IDS, ...SUMMON_IDS, ...TROUBLE_IDS];
/** The mean health of a tier's figures. */
const mean = (tier: 1 | 2 | 3 | 4 | 5): number => {
  const list = figuresOfTier(tier);
  return list.reduce((sum, id) => sum + FIGURES[id].hp, 0) / list.length;
};

describe("the roster", () => {
  test("is twenty-eight figures in five tiers: 7, 7, 6, 5, 3", () => {
    expect(FIGURE_IDS.length).toBe(28);
    expect(TIERS.map((tier) => figuresOfTier(tier).length)).toEqual([7, 7, 6, 5, 3]);
  });
  test("everyone has a name of their own", () => {
    const names = EVERYONE.map((kind) => specOf(kind).name);
    expect(new Set(names).size).toBe(names.length);
  });
  test("every kin has four members, on at least three tiers, starting cheap", () => {
    for (const kin of KINS) {
      const members = FIGURE_IDS.filter((id) => FIGURES[id].kin === kin);
      expect(members.length).toBe(4);
      expect(new Set(members.map((id) => FIGURES[id].tier)).size).toBeGreaterThanOrEqual(3);
      // The two cheapest tiers each have one, so any kin can be started from the first rooms.
      expect(members.some((id) => FIGURES[id].tier === 1)).toBe(true);
      expect(members.some((id) => FIGURES[id].tier === 2)).toBe(true);
    }
  });
  test("every calling has four to six members across the tiers, enough for its top step", () => {
    for (const calling of CALLINGS) {
      const members = FIGURE_IDS.filter((id) => traitsOf(id).includes(calling));
      expect(members.length).toBeGreaterThanOrEqual(4);
      expect(members.length).toBeLessThanOrEqual(6);
      expect(new Set(members.map((id) => FIGURES[id].tier)).size).toBeGreaterThanOrEqual(3);
      expect(members.length).toBeGreaterThanOrEqual(TRAITS[calling].steps.at(-1) ?? 0);
    }
  });
  test("only the dearest carry a third trait", () => {
    for (const id of FIGURE_IDS) if (FIGURES[id].extra.length > 0) expect(FIGURES[id].tier).toBe(5);
  });
  test("dearer figures are sturdier, tier by tier", () => {
    for (const tier of [2, 3, 4, 5] as const) {
      const below = tier === 2 ? 1 : tier === 3 ? 2 : tier === 4 ? 3 : 4;
      expect(mean(tier)).toBeGreaterThan(mean(below));
    }
  });
  test("everyone with a mana bar has an ability to spend it on, and a sentence for it with no gaps", () => {
    for (const kind of EVERYONE) {
      const spec = specOf(kind);
      if (spec.mana[1] > 0) {
        expect(CASTS[kind]).toBeDefined();
        expect(spec.ability).not.toBeNull();
        expect(spec.mana[0]).toBeLessThan(spec.mana[1]);
      }
      for (const stars of [1, 2, 3] as const) {
        const text = abilityText(kind, stars);
        expect(text).not.toContain("{");
        if (spec.ability) expect(text.length).toBeGreaterThan(10);
      }
      expect(spec.quip.length).toBeGreaterThan(3);
    }
  });
  test("an ability's numbers never get worse with stars", () => {
    for (const kind of EVERYONE) {
      for (const [a, b, c] of Object.values(specOf(kind).ability?.n ?? {})) {
        expect(b).toBeGreaterThanOrEqual(a);
        expect(c).toBeGreaterThanOrEqual(b);
      }
    }
  });
  test("bosses and trouble are not for sale", () => {
    const forSale: readonly string[] = FIGURE_IDS;
    for (const id of TROUBLE_IDS) expect(forSale).not.toContain(id);
    expect(BOSS_IDS).toContain("bigcrab");
    expect(specOf("bigcrab").name).toBe("The Crab Nobody Counted");
  });
});

describe("traits", () => {
  test("there are seven kins and six callings", () => {
    expect(KINS.length).toBe(7);
    expect(CALLINGS.length).toBe(6);
  });
  test("each has a sentence for every step, with no gaps, and numbers for every step", () => {
    for (const id of TRAIT_IDS) {
      const spec = TRAITS[id];
      expect(spec.text.length).toBe(spec.steps.length);
      for (const list of Object.values(spec.n)) expect(list.length).toBe(spec.steps.length);
      for (let step = 1; step <= spec.steps.length; step++) expect(traitText(id, step)).not.toContain("{");
    }
  });
  test("a step switches on at its count", () => {
    expect(stepFor("ember", 1)).toBe(0);
    expect(stepFor("ember", 2)).toBe(1);
    expect(stepFor("ember", 3)).toBe(1);
    expect(stepFor("ember", 4)).toBe(2);
    expect(stepFor("bulwark", 6)).toBe(3);
    expect(stepFor("greg", 1)).toBe(1);
  });
});

describe("items", () => {
  test("five components make fifteen things, one for every pair", () => {
    expect(COMPONENT_IDS.length).toBe(5);
    expect(FINISHED_IDS.length).toBe(15);
    const made = new Set<string>();
    for (const a of COMPONENT_IDS) {
      for (const b of COMPONENT_IDS) {
        expect(forge(a, b)).toBe(forge(b, a));
        made.add(forge(a, b));
      }
    }
    expect(made.size).toBe(15);
  });
  test("each component is a single stat", () => {
    for (const id of COMPONENT_IDS) {
      const s = COMPONENTS[id].stats;
      const kinds = [s.attack, s.speed, s.power, s.armour + s.ward, s.health].filter((n) => n > 0);
      expect(kinds.length).toBe(1);
    }
  });
  test("a finished item has both halves' stats and a sentence with no gaps", () => {
    for (const id of FINISHED_IDS) {
      const [a, b] = FINISHED[id].made;
      const whole = itemStats(id);
      expect(whole.attack).toBe(COMPONENTS[a].stats.attack + COMPONENTS[b].stats.attack);
      expect(whole.health).toBe(COMPONENTS[a].stats.health + COMPONENTS[b].stats.health);
      expect(whole.armour).toBe(COMPONENTS[a].stats.armour + COMPONENTS[b].stats.armour);
      expect(itemText(id)).not.toContain("{");
    }
    const names = FINISHED_IDS.map((id) => FINISHED[id].name);
    expect(new Set(names).size).toBe(15);
  });
  test("a second component forges with the first; a third thing takes a free place; a fourth is refused", () => {
    const one = holdItem([], "thorn");
    expect(one?.held).toEqual(["thorn"]);
    const two = holdItem(one?.held ?? [], "plume");
    expect(two?.held).toEqual(["wasptail"]);
    expect(two?.forged).toBe("wasptail");
    const three = holdItem(["wasptail", "stump"], "bark");
    expect(three?.held).toEqual(["wasptail", "stump", "bark"]);
    // Full of finished things: nothing more fits.
    expect(holdItem(["wasptail", "stump", "hoard"], "bark")).toBeNull();
    // Full, but one is a loose component: another component still forges with it.
    expect(holdItem(["wasptail", "stump", "bark"], "bark")?.held).toEqual(["wasptail", "stump", "stump"]);
    expect(holdItem(["wasptail", "stump", "bark"], "hoard")).toBeNull();
    expect(HOLDS).toBe(3);
  });
});

describe("boons", () => {
  test("there are about eighteen, with a charm for every kin", () => {
    expect(BOON_IDS.length).toBeGreaterThanOrEqual(16);
    expect(BOON_IDS.length).toBeLessThanOrEqual(22);
    for (const kin of KINS) expect(BOON_IDS.filter((id) => BOONS[id].charm === kin).length).toBe(1);
    for (const id of BOON_IDS) expect(boonText(id)).not.toContain("{");
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
  test("four to six figures start locked, and none of them is one of the three cheapest starts needed", () => {
    expect(MILESTONES.length).toBeGreaterThanOrEqual(4);
    expect(MILESTONES.length).toBeLessThanOrEqual(6);
    for (const m of MILESTONES) expect(FIGURES[m.figure].tier).toBeGreaterThan(1);
    expect(new Set(MILESTONES.map((m) => m.figure)).size).toBe(MILESTONES.length);
  });
});
