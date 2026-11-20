import type { AchievementRules } from "./achievements.ts";
import { type Activity, RAID_KEYS, type RaidKey } from "./activity.ts";
import type { ConversionRules } from "./conversions.ts";
import type { GreatRules } from "./great.ts";
import type { GroveRules } from "./grove.ts";
import type { MarketRules } from "./market.ts";
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
  readonly grove: GroveRules;
  readonly great: GreatRules;
  readonly market: MarketRules;
  readonly conversions: ConversionRules;
}

export interface EarningRules {
  /** Leaf paid to a party member per point of their share of the season rating a raid earns. */
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
// play a raid's guild message reported 220 to 440 season rating for the whole
// party, about 330 on average; each member's share is about 80 to 110. A war
// earned 60.
//
// Most quests can be finished by raiding or by warring, whichever comes first, so
// raiders and warrers both have a way. Over the first three days a raid took
// about 10 minutes and a war about 3.4, measured between two in a row, so a war
// goal asks three wars for each raid the quest is worth. A weekly for 12 of one
// raid is worth 20 raids of any kind, as its reward says.
const WARS_PER_RAID = 3;

const HOUR_MS = 60 * 60 * 1000;

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

// A raid earns each member their share of its season rating, about 80 to 110, so
// a season rating quest asks for about as many raids as the raids-or-wars quests
// beside it: 300 for three, 2,000 for twenty.
const QUEST_TEMPLATES: readonly QuestTemplate[] = [
  ...RAID_KEYS.map((raid) => raidsOrWars("daily", { raid, count: 3 }, 3, { leaf: 300, xp: 150 })),
  raidsOrWars("daily", { count: 2 }, 2, { leaf: 200, xp: 100 }),
  {
    id: "daily.season_rating.300",
    slot: "daily",
    objectives: [{ type: "season_rating", amount: 300 }],
    reward: { leaf: 250, xp: 125 },
  },
  ...RAID_KEYS.map((raid) => raidsOrWars("weekly", { raid, count: 12 }, 20, { leaf: 800, xp: 400 })),
  raidsOrWars("weekly", { count: 20 }, 20, { leaf: 800, xp: 400 }),
  {
    id: "weekly.season_rating.2000",
    slot: "weekly",
    objectives: [{ type: "season_rating", amount: 2000 }],
    reward: { leaf: 800, xp: 400 },
  },
  // Timed quests: the whole guild gets the same one for a two-hour window. They
  // pay more than a daily for a shorter time to do it in. Repeatable quests are
  // off for now: the rules give them no template.
  ...RAID_KEYS.map((raid) => raidsOrWars("timed", { raid, count: 2 }, 2, { leaf: 500, xp: 250 })),
  raidsOrWars("timed", { count: 3 }, 3, { leaf: 500, xp: 250 }),
  {
    id: "timed.season_rating.300",
    slot: "timed",
    objectives: [{ type: "season_rating", amount: 300 }],
    reward: { leaf: 500, xp: 250 },
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

// The Grove's cones, as the prototype client tuned them (apps/grove's rules.ts). A
// cone costs 400 Leaf, about four raids' worth for one member; a Treant or better
// comes within 40, so about 16,000 Leaf, and pity carries over between banners.
const GROVE_RULES: GroveRules = {
  conePrice: 400,
  coneBatches: [1, 10],
  ranks: [
    {
      rank: "leafkin",
      name: "Leafkin",
      odds: 4000,
      spirits: ["glarp", "glerp", "glirp", "glorp", "glurp", "glyrp", "gleep"],
    },
    { rank: "sapling", name: "Sapling", odds: 2700, spirits: ["mossmote", "slug", "crab"] },
    { rank: "sprite", name: "Sprite", odds: 1600, spirits: ["chickaree", "emberkit"] },
    { rank: "dryad", name: "Dryad", odds: 900, spirits: ["fog-owl", "crab-08"] },
    { rank: "druid", name: "Druid", odds: 500, spirits: ["moth", "worm"] },
    { rank: "treant", name: "Treant", odds: 250, spirits: ["rock", "greg"] },
    { rank: "yggdrasil", name: "Yggdrasil", odds: 50, spirits: ["white-fox"] },
  ],
  pity: { cones: 40, rank: "treant" },
  banners: [
    // The first banner: The Canyon Colossus's cone season, its face the Rock. It runs
    // until the next banner is added here.
    { id: "tcc", title: "The Canyon Colossus", featured: "rock", featuredShare: 5000, from: Date.UTC(2026, 10, 20) },
  ],
  verdant: { odds: 400, copy: 4 },
  bondMax: 5,
  bloomMax: 10,
  raidBloom: 1,
  // A charge comes back every four hours and six bank up, so a member who visits
  // once a day finds a full bank and loses nothing by missing a day.
  chargeSeconds: 4 * 60 * 60,
  chargeMax: 6,
  careBloom: 1,
  treeVariants: 3,
  announceFrom: "dryad",
};

// The Great Sequoia's weekly goals. In the first days the guild finished a raid
// about every 10 minutes and a war about every 3.4, so a week holds about 1,000
// raids and 3,000 wars; the goals sit near that, for a week of ordinary play to
// reach. The offering goal is a few percent of the Leaf a week pays. Tune them
// after the first weeks.
const GREAT_RULES: GreatRules = {
  goals: [
    {
      id: "raids",
      kind: "raids",
      target: 1000,
      title: "Finish 1,000 guild raids",
      reward: { id: "great.aurora", title: "An aurora over the Great Sequoia" },
    },
    {
      id: "offered_leaf",
      kind: "offered_leaf",
      target: 50_000,
      title: "Offer 50,000 Leaf to the Great Sequoia",
      reward: { id: "great.fairy-lights", title: "Fairy lights in the Great Sequoia's crown" },
    },
    {
      id: "wars",
      kind: "wars",
      target: 3000,
      title: "Fight 3,000 wars",
      reward: { id: "great.sky-lanterns", title: "Sky lanterns over the valley" },
    },
  ],
  offering: { min: 100, max: 10_000 },
  leafPerContribution: 100,
  glowAt: [1, 10, 30],
};

// The member marketplace. A listing takes orders for two weeks and a delivered
// order confirms itself a week after delivery unless the buyer disputes it,
// so held Leaf never waits on a buyer who forgot. There is no fee for now. A
// price is up to a million Leaf a unit, and a listing up to a stack of 64.
const MARKET_RULES: MarketRules = {
  listingDays: 14,
  autoConfirmDays: 7,
  fee: 0,
  title: { min: 3, max: 80 },
  description: { max: 1000 },
  price: { min: 1, max: 1_000_000 },
  quantity: { max: 64 },
  maxOpenListings: 20,
  note: { max: 500 },
  digestMs: HOUR_MS,
};

// Leaf out to LE, tomes and aspects, which staff pay in-game. PLACEHOLDERS, to
// tune with the Branchmasters: their first proposal was 200 Leaf to 1 LE from
// 32 LE, and 3,000 to 4,000 Leaf for a tome or an aspect, here 4,000. The
// guild's budget was about 100 LE a month. At launch Leaf was issued at about
// 118,000 a day, about 590 LE a day at this rate, so the cap, not the rate, is
// what keeps payouts inside the budget: a claim past it waits, in order, for
// the months after. A member may ask for 64 LE, one tome and one aspect a
// month, so one member can't hold the whole queue.
const CONVERSION_RULES: ConversionRules = {
  provisional: true,
  kinds: {
    le: { name: "Liquid Emerald", leafPerUnit: 200, minUnits: 32, maxUnits: 64, monthlyCap: 100, memberMonthly: 64 },
    tome: { name: "Tome", leafPerUnit: 4000, minUnits: 1, maxUnits: 1, monthlyCap: 4, memberMonthly: 1 },
    aspect: { name: "Aspect", leafPerUnit: 4000, minUnits: 1, maxUnits: 1, monthlyCap: 4, memberMonthly: 1 },
  },
  note: { max: 200 },
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
    // A timed quest opens at 00:00, 04:00, 08:00, ... UTC, for two hours each,
    // from the first window after they launched.
    timed: { everyMs: 4 * HOUR_MS, openMs: 2 * HOUR_MS, firstAt: Date.UTC(2026, 10, 19, 4) },
    // A member can swap a daily or weekly they don't fancy: once a day per slot
    // for free, then 100 Leaf a time. Timed quests are the guild's shared one.
    reroll: { slots: ["daily", "weekly"], freePerDay: 1, leaf: 100 },
  },
  levels: {
    firstLevelXp: 1000,
    xpGrowthPerLevel: 250,
    // A level pays a tenth of the XP it took: 100 Leaf for level 2, 300 for level 10.
    firstLevelLeaf: 100,
    leafGrowthPerLevel: 25,
  },
  achievements: ACHIEVEMENT_RULES,
  grove: GROVE_RULES,
  great: GREAT_RULES,
  market: MARKET_RULES,
  conversions: CONVERSION_RULES,
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
