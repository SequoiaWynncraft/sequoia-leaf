import type { AchievementRules } from "./achievements.ts";
import { type Activity, RAID_KEYS, type RaidKey } from "./activity.ts";
import type { QuestReward, QuestRules, QuestSlot, QuestTemplate } from "./quests.ts";

/**
 * The numbers that tune the game. They live here, together, so they can be
 * read and changed in one place.
 */
export interface Rules {
  readonly earning: EarningRules;
  readonly quests: QuestRules;
  readonly levels: LevelRules;
  readonly achievements: AchievementRules;
}

export interface EarningRules {
  /** Leaf paid to each party member per point of season rating a raid earns. */
  readonly leafPerRaidSeasonRating: number;
  /** Leaf paid to a participant per war point they scored, in an FFA war or a snipe. */
  readonly leafPerWarPoint: number;
  /**
   * Leaf per war point in a war over Sequoia's own claim. The guild agreed that
   * defending pays a lot and FFA and snipes a little; war points already score
   * a claim war about three times an FFA one, and this doubles it again.
   */
  readonly leafPerClaimWarPoint: number;
}

export interface LevelRules {
  /** XP needed to go from level 1 to level 2. */
  readonly firstLevelXp: number;
  /** How much more XP each further level needs than the one before it. */
  readonly xpGrowthPerLevel: number;
  /** Leaf paid for reaching level 2. */
  readonly firstLevelLeaf: number;
  /** How much more Leaf each further level pays than the one before it. */
  readonly leafGrowthPerLevel: number;
}

// As a rough anchor, 100 Leaf is worth about 1 LE. In the first day of real
// play a raid earned 220 to 440 season rating, about 330 on average, and a war 60.
//
// Most quests can be finished by raiding or by warring, whichever comes first, so
// raiders and warrers both have a way. Over the first three days a raid took
// about 10 minutes and a war about 3.4, measured between two in a row, so a war
// goal asks three wars for each raid the quest is worth. A weekly for 12 of one
// raid is worth 20 raids of any kind, as its reward says.
const WARS_PER_RAID = 3;

function raidsOrWars(
  slot: QuestSlot,
  raids: { readonly raid?: RaidKey; readonly count: number },
  raidsWorth: number,
  reward: QuestReward,
): QuestTemplate {
  const wars = raidsWorth * WARS_PER_RAID;
  return {
    id: `${slot}.raids.${raids.raid ?? "any"}.${raids.count}.or.wars.${wars}`,
    slot,
    objectives: [
      raids.raid === undefined
        ? { type: "raids", count: raids.count }
        : { type: "raids", raid: raids.raid, count: raids.count },
      { type: "wars", count: wars },
    ],
    reward,
  };
}

const QUEST_TEMPLATES: readonly QuestTemplate[] = [
  ...RAID_KEYS.map((raid) => raidsOrWars("daily", { raid, count: 3 }, 3, { leaf: 300, xp: 150 })),
  raidsOrWars("daily", { count: 2 }, 2, { leaf: 200, xp: 100 }),
  {
    id: "daily.season_rating.1000",
    slot: "daily",
    objectives: [{ type: "season_rating", amount: 1000 }],
    reward: { leaf: 250, xp: 125 },
  },
  ...RAID_KEYS.map((raid) => raidsOrWars("weekly", { raid, count: 12 }, 20, { leaf: 800, xp: 400 })),
  raidsOrWars("weekly", { count: 20 }, 20, { leaf: 800, xp: 400 }),
  {
    id: "weekly.season_rating.6000",
    slot: "weekly",
    objectives: [{ type: "season_rating", amount: 6000 }],
    reward: { leaf: 800, xp: 400 },
  },
  raidsOrWars("repeatable", { count: 8 }, 8, { leaf: 200, xp: 100 }),
];

// A milestone pays roughly 6 to 9% on top of the Leaf the raids or wars on the
// way to it paid. The "all raids" ladder has the same tiers at twice the count.
const ACHIEVEMENT_RULES: AchievementRules = {
  payingLadders: ["raid:", "war:"],
  leafByMilestone: new Map([
    ["bronze", 250],
    ["silver", 500],
    ["gold", 1000],
    ["platinum", 2500],
    ["diamond", 5000],
    ["obsidian", 10_000],
    ["mythril", 20_000],
  ]),
};

export const DEFAULT_RULES: Rules = {
  earning: {
    leafPerRaidSeasonRating: 1,
    leafPerWarPoint: 1,
    leafPerClaimWarPoint: 2,
  },
  quests: {
    templates: QUEST_TEMPLATES,
    dailyChargeCap: 3,
  },
  levels: {
    firstLevelXp: 1000,
    xpGrowthPerLevel: 250,
    // A level pays a tenth of the XP it took: 100 Leaf for level 2, 300 for level 10.
    firstLevelLeaf: 100,
    leafGrowthPerLevel: 25,
  },
  achievements: ACHIEVEMENT_RULES,
};

/**
 * The Leaf an activity pays, as a whole number that is never negative. A war
 * scored at zero or below pays nothing but still counts as an activity. A war
 * over Sequoia's claim pays its own rate; one the backend could not place pays
 * the ordinary rate.
 */
export function leafForActivity(activity: Activity, rules: EarningRules): number {
  const raw =
    activity.kind === "raid"
      ? activity.seasonRating * rules.leafPerRaidSeasonRating
      : activity.warPoints * (activity.inClaim === true ? rules.leafPerClaimWarPoint : rules.leafPerWarPoint);
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

export interface LevelProgress {
  /** Starts at 1. */
  readonly level: number;
  /** XP earned since reaching this level. */
  readonly xpIntoLevel: number;
  /** XP this level needs in total before the next one. */
  readonly xpForNextLevel: number;
}

/** The level a total amount of XP amounts to. Each level needs a fixed amount more XP than the last. */
export function levelForXp(xp: number, rules: LevelRules): LevelProgress {
  let level = 1;
  let remaining = Math.max(0, xp);
  let needed = rules.firstLevelXp;
  while (remaining >= needed) {
    remaining -= needed;
    level += 1;
    needed += rules.xpGrowthPerLevel;
  }
  return { level, xpIntoLevel: remaining, xpForNextLevel: needed };
}

/**
 * The Leaf paid for reaching a level, as a whole number that is never
 * negative. Everyone starts at level 1, so it pays nothing.
 */
export function leafForLevel(level: number, rules: LevelRules): number {
  if (!Number.isInteger(level) || level < 2) {
    return 0;
  }
  const raw = rules.firstLevelLeaf + (level - 2) * rules.leafGrowthPerLevel;
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}
