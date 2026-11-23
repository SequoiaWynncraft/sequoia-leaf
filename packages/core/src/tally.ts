/**
 * The Tally: where the town keeps count. Each board ranks players by one number Leaf counts itself:
 * from what it records of the guild (raids, wars, quests, the ledger), from where the games' states
 * stand, and from counters it keeps of what players do (`TallyStat`). Nothing on a board is anything
 * Leaf or Coins can buy, and nothing counts days in a row. A board is for all time, and some for
 * the week as the weekly quests count it (`utcWeekStart`).
 */
import { RAID_KEYS, type RaidKey, RAIDS } from "./activity.ts";
import type { Logged } from "./play.ts";
import { DEFAULT_RULES, levelForXp } from "./rules.ts";
import { LOGGED } from "./visits.ts";

/** The groups the boards are listed in, in order. */
export const TALLY_GROUPS = ["guild", "works", "raid", "town"] as const;
export type TallyGroup = (typeof TALLY_GROUPS)[number];
export const GROUP_NAMES: Readonly<Record<TallyGroup, string>> = {
  guild: "The guild",
  works: "The Works",
  raid: "The Little Raid",
  town: "The town",
};

/** How a board's number is written: a count, a time in seconds, Leaf, Coins, or a level. */
export type TallyUnit = "count" | "time" | "leaf" | "coins" | "level";

/** The two spans a board may cover. */
export const PERIODS = ["week", "all"] as const;
export type Period = (typeof PERIODS)[number];

/**
 * What Leaf counts itself, by player: one row each in `tallies`, for all time and for the week.
 * `played:<game>` and `afk:<game>` are times in milliseconds, counted from visits as a person's card
 * counts them.
 */
export const TALLY_STATS = [
  "raid_wins",
  "raid_rooms",
  "works_orders",
  "crab",
  "greeted",
  "waves",
  "taps",
  "logs",
  "rolls",
  "played:town",
  "afk:town",
  "played:works",
  "played:raid",
] as const;
export type TallyStat = (typeof TALLY_STATS)[number];

/** The counters a game's time goes to, as a person's card counts it from visits: played, and in town AFK too. */
export const TIMED: Readonly<Record<string, { readonly played: TallyStat; readonly afk?: TallyStat }>> = {
  town: { played: "played:town", afk: "afk:town" },
  works: { played: "played:works" },
  raid: { played: "played:raid" },
};

export interface TallyBoard {
  readonly id: string;
  readonly group: TallyGroup;
  readonly name: string;
  /** What it counts, in one plain line. */
  readonly counts: string;
  readonly unit: TallyUnit;
  /** Whether it has a board for this week beside the one for all time. */
  readonly week: boolean;
}

const raidBoard = (key: RaidKey): TallyBoard => ({
  id: `raid-${key}`,
  group: "guild",
  name: RAIDS[key],
  counts: "Finished with the guild.",
  unit: "count",
  week: true,
});

/** Every board, in the order the Tally lists them. */
export const TALLY_BOARDS: readonly TallyBoard[] = [
  {
    id: "raids",
    group: "guild",
    name: "Guild raids",
    counts: "Raids finished with the guild.",
    unit: "count",
    week: true,
  },
  ...RAID_KEYS.map(raidBoard),
  { id: "wars", group: "guild", name: "Wars", counts: "Wars taken part in for the guild.", unit: "count", week: true },
  {
    id: "defences",
    group: "guild",
    name: "Defences",
    counts: "Wars over a territory in Sequoia's claim.",
    unit: "count",
    week: true,
  },
  {
    id: "rating",
    group: "guild",
    name: "Season rating",
    counts: "Each war's season rating, and a share of each raid's.",
    unit: "count",
    week: true,
  },
  {
    id: "quests",
    group: "guild",
    name: "Quests",
    counts: "Daily, weekly and timed quests finished.",
    unit: "count",
    week: true,
  },
  {
    id: "leaf",
    group: "guild",
    name: "Leaf earned",
    counts: "From raids, wars, quests, levels and milestones. Spending does not lower it.",
    unit: "leaf",
    week: true,
  },
  { id: "level", group: "guild", name: "SEQ level", counts: "Level with the guild.", unit: "level", week: false },
  {
    id: "milestones",
    group: "guild",
    name: "Milestones",
    counts: "Raid and war milestones reached.",
    unit: "count",
    week: true,
  },
  { id: "yards", group: "works", name: "Top yards", counts: "Coins the yard has earned.", unit: "coins", week: false },
  {
    id: "tier",
    group: "works",
    name: "Highest tier",
    counts: "The tier the yard has reached.",
    unit: "count",
    week: false,
  },
  {
    id: "orders",
    group: "works",
    name: "Orders handed over",
    counts: "Orders from the board, filled and handed over.",
    unit: "count",
    week: true,
  },
  {
    id: "works-time",
    group: "works",
    name: "Time in the Works",
    counts: "Time played in the Works.",
    unit: "time",
    week: true,
  },
  {
    id: "runs-won",
    group: "raid",
    name: "Runs won",
    counts: "Runs that won the trail's last room.",
    unit: "count",
    week: true,
  },
  { id: "rooms", group: "raid", name: "Rooms fought", counts: "Rooms fought, won or lost.", unit: "count", week: true },
  {
    id: "bosses",
    group: "raid",
    name: "Bosses beaten",
    counts: "Different bosses beaten, every trail together.",
    unit: "count",
    week: false,
  },
  {
    id: "raid-time",
    group: "raid",
    name: "Time at the table",
    counts: "Time played at The Little Raid.",
    unit: "time",
    week: true,
  },
  {
    id: "town-time",
    group: "town",
    name: "Time in town",
    counts: "Time played in town and camp.",
    unit: "time",
    week: true,
  },
  {
    id: "dozing",
    group: "town",
    name: "Dozing",
    counts: "Time in town AFK: 5 minutes or more with nothing done.",
    unit: "time",
    week: true,
  },
  {
    id: "crab",
    group: "town",
    name: "Crab No. 7 spotted",
    counts: "Times No. 7 was found where it hides.",
    unit: "count",
    week: true,
  },
  {
    id: "greeted",
    group: "town",
    name: "Callers greeted",
    counts: "The town's own greeted when they called at your camp.",
    unit: "count",
    week: true,
  },
  {
    id: "waves",
    group: "town",
    name: "Waves",
    counts: "Waves in town. One counts every 30 seconds.",
    unit: "count",
    week: true,
  },
  {
    id: "taps",
    group: "town",
    name: "Things tapped",
    counts: "Taps on things in town. One counts every 5 seconds.",
    unit: "count",
    week: true,
  },
  {
    id: "logs",
    group: "town",
    name: "Logs on the fire",
    counts: "Logs put on the town's fire. One counts every 5 seconds.",
    unit: "count",
    week: true,
  },
  {
    id: "rolls",
    group: "town",
    name: "Roll calls",
    counts: "Times the crabs' roll was called. One counts every 10 seconds.",
    unit: "count",
    week: true,
  },
  {
    id: "camps",
    group: "town",
    name: "Camps visited",
    counts: "Other camps stayed in for 30 seconds or more.",
    unit: "count",
    week: true,
  },
  {
    id: "visitors",
    group: "town",
    name: "Visitors",
    counts: "People who stayed in your camp for 30 seconds or more.",
    unit: "count",
    week: true,
  },
];

/** A board by its id, or undefined for none. */
export const tallyBoard = (id: string): TallyBoard | undefined => TALLY_BOARDS.find((b) => b.id === id);

/** How many a board lists: the top three on the podium, then the next seven. */
export const TALLY_SHOWN = 10;

/** How long a board worked out is kept before it is worked out again. */
export const TALLY_KEPT_MS = 60_000;

/** How long somebody must stay in another's camp for it to count as a visit. */
export const STAY_MS = 30_000;

/** Where the Tally reads a board, for a span. */
export const tallyPath = (board: string, period: Period): string =>
  `/v1/game/tally/${encodeURIComponent(board)}/${period}`;

/** A player's number on a board as Leaf reads it: a count, milliseconds, Leaf, Coins or XP; and when they reached it. */
export interface Counted<Id extends string = string> {
  readonly playerId: Id;
  readonly value: number;
  readonly at: number;
}

/** A player's place on a board: how many score higher, and one; and their score as the board writes it. */
export interface Ranked<Id extends string = string> {
  readonly playerId: Id;
  readonly place: number;
  readonly score: number;
}

/** A board's score for a number Leaf read: whole seconds of a time, the level of an amount of XP, and the rest as it is. */
export function scoreOf(unit: TallyUnit, value: number): number {
  if (unit === "time") return Math.floor(value / 1000);
  if (unit === "level") return value > 0 ? levelForXp(value, DEFAULT_RULES.levels).level : 0;
  return value;
}

/**
 * Everybody on a board, highest first: those whose score is above 0, a tie sharing a place.
 * Within a tie, more of the number read goes first (more XP at a level), then whoever reached it first.
 */
export function rankTally<Id extends string>(unit: TallyUnit, counted: readonly Counted<Id>[]): Ranked<Id>[] {
  const scored = counted
    .map((c) => ({ ...c, score: scoreOf(unit, c.value) }))
    .filter((c) => c.score > 0)
    .toSorted((a, b) => b.score - a.score || b.value - a.value || a.at - b.at || (a.playerId < b.playerId ? -1 : 1));
  const ranked: Ranked<Id>[] = [];
  for (const [i, c] of scored.entries()) {
    const before = ranked[i - 1];
    ranked.push({ playerId: c.playerId, score: c.score, place: before?.score === c.score ? before.place : i + 1 });
  }
  return ranked;
}

/** Each counter a thing the games log adds one to (`Done.log`). */
export function talliedFrom(logged: readonly Logged[]): TallyStat[] {
  return logged.flatMap((l): TallyStat[] => {
    switch (l.kind) {
      case LOGGED.raidRoom:
        return ["raid_rooms"];
      case LOGGED.raidEnded:
        return l.data["ended"] === "won" ? ["raid_wins"] : [];
      case LOGGED.worksOrder:
        return ["works_orders"];
      case LOGGED.townCrab:
        return ["crab"];
      case LOGGED.townGreeted:
        return ["greeted"];
      default:
        return [];
    }
  });
}

/** The least time between two acts that count for one player, by the counter they add to. */
export const ACT_EVERY_MS = { waves: 30_000, taps: 5_000, logs: 5_000, rolls: 10_000 } as const;
export type ActStat = keyof typeof ACT_EVERY_MS;

/**
 * The counters an act in a live room adds one to: a wave; and a touch on anything, a log on the
 * fire (a touch on it) and the crabs' roll.
 */
export function talliedActs(kind: string, arg: string): readonly ActStat[] {
  if (kind === "emote") return arg === "wave" ? ["waves"] : [];
  if (kind !== "touch") return [];
  const thing = arg.split(":")[0];
  return thing === "fire" ? ["taps", "logs"] : thing === "roll" ? ["taps", "rolls"] : ["taps"];
}
