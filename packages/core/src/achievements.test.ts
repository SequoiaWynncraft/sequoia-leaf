import { describe, expect, it } from "bun:test";

import { type AchievementAward, leafForAward } from "./achievements.ts";
import { playerId } from "./player.ts";
import { DEFAULT_RULES } from "./rules.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");

function award(ladder: string, milestoneId: string | null): AchievementAward {
  return {
    awardId: `${alice}:${ladder}:1`,
    playerId: alice,
    ladder,
    milestoneId,
    tier: milestoneId,
    threshold: 25,
    label: null,
    earnedAt: 0,
  };
}

const rules = DEFAULT_RULES.achievements;

describe("leafForAward", () => {
  it("pays each tier of a guild raid ladder its own amount", () => {
    expect(
      ["bronze", "silver", "gold", "platinum", "diamond", "obsidian", "mythril"].map((tier) =>
        leafForAward(award("raid:TNA", tier), rules),
      ),
    ).toEqual([250, 500, 1000, 2500, 5000, 10_000, 20_000]);
  });

  it("pays the all-raids ladder and the guild war ladder like any raid ladder", () => {
    expect(leafForAward(award("raid:all raids", "diamond"), rules)).toBe(5000);
    expect(leafForAward(award("war:completed", "silver"), rules)).toBe(500);
  });

  it("pays nothing for ladders outside the guild's raids and wars", () => {
    expect(leafForAward(award("profession:mining", "level-132"), rules)).toBe(0);
    expect(leafForAward(award("role:insignia", "gold"), rules)).toBe(0);
    expect(leafForAward(award("badge:wartorn_palace_diamond", null), rules)).toBe(0);
  });

  it("pays nothing for a milestone it has no amount for, such as one staff added later", () => {
    expect(leafForAward(award("raid:TNA", "m-7f3a"), rules)).toBe(0);
    expect(leafForAward(award("raid:TNA", null), rules)).toBe(0);
  });

  it("does not mistake a ladder that only contains a paying prefix for one that starts with it", () => {
    expect(leafForAward(award("badge:raid:TNA", "gold"), rules)).toBe(0);
  });
});
