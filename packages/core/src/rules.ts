import type { AchievementRules } from "./achievements.ts";
import { type Activity, RAID_KEYS } from "./activity.ts";
import type { QuestRules, QuestTemplate } from "./quests.ts";

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
  /** Leaf paid to a participant per war point they scored. */
  readonly leafPerWarPoint: number;
}

export interface LevelRules {
  /** XP needed to go from level 1 to level 2. */
  readonly firstLevelXp: number;
  /** How much more XP each further level needs than the one before it. */
  readonly xpGrowthPerLevel: number;
}

// As a rough anchor, 100 Leaf is worth about 1 LE. In the first day of real
// play a raid earned 220 to 440 season rating, about 330 on average, and a war 60.
const QUEST_TEMPLATES: readonly QuestTemplate[] = [
  ...RAID_KEYS.map((raid): QuestTemplate => ({
    id: `daily.raids.${raid}.3`,
    slot: "daily",
    objective: { type: "raids", raid, count: 3 },
    reward: { leaf: 300, xp: 150 },
  })),
  { id: "daily.raids.any.2", slot: "daily", objective: { type: "raids", count: 2 }, reward: { leaf: 200, xp: 100 } },
  { id: "daily.wars.2", slot: "daily", objective: { type: "wars", count: 2 }, reward: { leaf: 200, xp: 100 } },
  {
    id: "daily.season_rating.1000",
    slot: "daily",
    objective: { type: "season_rating", amount: 1000 },
    reward: { leaf: 250, xp: 125 },
  },
  ...RAID_KEYS.map((raid): QuestTemplate => ({
    id: `weekly.raids.${raid}.12`,
    slot: "weekly",
    objective: { type: "raids", raid, count: 12 },
    reward: { leaf: 800, xp: 400 },
  })),
  {
    id: "weekly.raids.any.20",
    slot: "weekly",
    objective: { type: "raids", count: 20 },
    reward: { leaf: 800, xp: 400 },
  },
  { id: "weekly.wars.15", slot: "weekly", objective: { type: "wars", count: 15 }, reward: { leaf: 800, xp: 400 } },
  {
    id: "weekly.season_rating.6000",
    slot: "weekly",
    objective: { type: "season_rating", amount: 6000 },
    reward: { leaf: 800, xp: 400 },
  },
  {
    id: "repeatable.raids.any.8",
    slot: "repeatable",
    objective: { type: "raids", count: 8 },
    reward: { leaf: 200, xp: 100 },
  },
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
  },
  quests: {
    templates: QUEST_TEMPLATES,
    dailyChargeCap: 3,
  },
  levels: {
    firstLevelXp: 1000,
    xpGrowthPerLevel: 250,
  },
  achievements: ACHIEVEMENT_RULES,
};

/**
 * The Leaf an activity pays, as a whole number that is never negative. A war
 * scored at zero or below pays nothing but still counts as an activity.
 */
export function leafForActivity(activity: Activity, rules: EarningRules): number {
  const raw =
    activity.kind === "raid"
      ? activity.seasonRating * rules.leafPerRaidSeasonRating
      : activity.warPoints * rules.leafPerWarPoint;
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
