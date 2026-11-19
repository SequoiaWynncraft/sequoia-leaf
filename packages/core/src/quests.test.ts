import { describe, expect, it } from "bun:test";

import type { Activity, RaidKey } from "./activity.ts";
import { playerId } from "./player.ts";
import {
  applyActivityToQuests,
  currentQuests,
  DAY_MS,
  leadingGoal,
  nextDailyChargeAt,
  nextTimedWindowAt,
  objectiveTitle,
  openQuestBook,
  pickTemplate,
  type Quest,
  type QuestBook,
  type QuestObjective,
  type QuestRules,
  type QuestSlot,
  questTitle,
  refreshQuests,
  rerollCost,
  rerollQuest,
  type RerollRules,
  timedTemplateFor,
  timedWindowAt,
  utcWeekStart,
  WEEK_MS,
} from "./quests.ts";
import { DEFAULT_RULES, leafForLevel, levelForXp } from "./rules.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const HOUR = 60 * 60 * 1000;
/** Monday 2 November 2026, 00:00 UTC. */
const MONDAY = Date.UTC(2026, 10, 2);
const WEDNESDAY_NOON = MONDAY + 2 * DAY_MS + 12 * HOUR;

/** One template per slot, so every test knows which quest it will get. */
const rules: QuestRules = {
  dailyChargeCap: 3,
  templates: [
    { id: "daily", slot: "daily", objectives: [{ type: "raids", count: 2 }], reward: { leaf: 200, xp: 100 } },
    { id: "weekly", slot: "weekly", objectives: [{ type: "raids", count: 3 }], reward: { leaf: 800, xp: 400 } },
    { id: "repeatable", slot: "repeatable", objectives: [{ type: "raids", count: 2 }], reward: { leaf: 50, xp: 25 } },
  ],
};

let nextId = 1;
function raid(occurredAt: number, key: RaidKey = "tna", seasonRating = 110): Activity {
  nextId += 1;
  return {
    kind: "raid",
    sourceKey: `raid:${nextId}:${alice}`,
    playerId: alice,
    occurredAt,
    seasonRating,
    raid: key,
    raidName: key,
  };
}

function war(occurredAt: number): Activity {
  nextId += 1;
  return {
    kind: "war",
    sourceKey: `war:${nextId}:${alice}`,
    playerId: alice,
    occurredAt,
    seasonRating: 60,
    territory: "Detlas",
    warPoints: 30,
  };
}

/** Applies activities in order and returns the final book with every quest finished along the way. */
function play(book: QuestBook, activities: Activity[], questRules = rules) {
  const completed: string[] = [];
  let current = book;
  for (const activity of activities) {
    const step = applyActivityToQuests(current, activity, questRules);
    current = step.book;
    completed.push(...step.completed.map((quest) => `${quest.slot}:${quest.sequence}`));
  }
  return { book: current, completed };
}

/** Rules whose only quest is a daily for this much season rating. */
function ratingDaily(amount: number): QuestRules {
  return {
    dailyChargeCap: 3,
    templates: [
      { id: "rating", slot: "daily", objectives: [{ type: "season_rating", amount }], reward: { leaf: 1, xp: 1 } },
    ],
  };
}

function progress(book: QuestBook, slot: QuestSlot): number | undefined {
  return book.latest[slot]?.goals[0]?.progress;
}

describe("refreshQuests", () => {
  it("hands a new player a daily, a weekly and a repeatable", () => {
    const step = refreshQuests(openQuestBook(WEDNESDAY_NOON), alice, WEDNESDAY_NOON, rules);

    expect(step.written.map((quest) => [quest.slot, quest.sequence, quest.startedAt, quest.expiresAt])).toEqual([
      ["daily", 1, MONDAY + 2 * DAY_MS, null],
      ["weekly", 1, MONDAY, MONDAY + WEEK_MS],
      ["repeatable", 1, WEDNESDAY_NOON, null],
    ]);
    expect(step.completed).toEqual([]);
  });

  it("changes nothing when asked again, or for an earlier moment", () => {
    const { book } = refreshQuests(openQuestBook(WEDNESDAY_NOON), alice, WEDNESDAY_NOON, rules);

    expect(refreshQuests(book, alice, WEDNESDAY_NOON + HOUR, rules).written).toEqual([]);
    expect(refreshQuests(book, alice, WEDNESDAY_NOON - 5 * DAY_MS, rules).written).toEqual([]);
  });
});

describe("counting activities", () => {
  it("counts one raid toward every quest it fits", () => {
    const { book, completed } = play(openQuestBook(WEDNESDAY_NOON), [raid(WEDNESDAY_NOON)]);

    expect(progress(book, "daily")).toBe(1);
    expect(progress(book, "weekly")).toBe(1);
    expect(progress(book, "repeatable")).toBe(1);
    expect(completed).toEqual([]);
  });

  it("does not count a war toward a raid quest", () => {
    const { book } = play(openQuestBook(WEDNESDAY_NOON), [war(WEDNESDAY_NOON)]);

    expect(progress(book, "daily")).toBe(0);
  });

  it("counts only the named raid toward a quest for one raid", () => {
    const nolOnly: QuestRules = {
      dailyChargeCap: 3,
      templates: [
        {
          id: "nol",
          slot: "daily",
          objectives: [{ type: "raids", raid: "nol", count: 3 }],
          reward: { leaf: 1, xp: 1 },
        },
      ],
    };

    const { book } = play(
      openQuestBook(WEDNESDAY_NOON),
      [raid(WEDNESDAY_NOON, "tna"), raid(WEDNESDAY_NOON + 1, "nol")],
      nolOnly,
    );

    expect(progress(book, "daily")).toBe(1);
  });

  it("counts wars toward a war quest", () => {
    const wars: QuestRules = {
      dailyChargeCap: 3,
      templates: [{ id: "wars", slot: "daily", objectives: [{ type: "wars", count: 2 }], reward: { leaf: 1, xp: 1 } }],
    };

    const { completed } = play(
      openQuestBook(WEDNESDAY_NOON),
      [war(WEDNESDAY_NOON), raid(WEDNESDAY_NOON + 1), war(WEDNESDAY_NOON + 2)],
      wars,
    );

    expect(completed).toEqual(["daily:1"]);
  });

  it("adds up the season rating of raids and wars toward a season rating quest", () => {
    const { book, completed } = play(
      openQuestBook(WEDNESDAY_NOON),
      [raid(WEDNESDAY_NOON, "wtp", 440), war(WEDNESDAY_NOON + 1)],
      ratingDaily(1000),
    );

    expect(progress(book, "daily")).toBe(500);
    expect(completed).toEqual([]);
  });

  it("finishes a season rating quest on reaching the amount and shows no more than the amount", () => {
    const { book, completed } = play(
      openQuestBook(WEDNESDAY_NOON),
      [raid(WEDNESDAY_NOON, "wtp", 440), raid(WEDNESDAY_NOON + 1, "wtp", 440), raid(WEDNESDAY_NOON + 2, "notg", 220)],
      ratingDaily(1000),
    );

    expect(completed).toEqual(["daily:1"]);
    expect(book.latest.daily).toMatchObject({ goals: [{ progress: 1000 }], completedAt: WEDNESDAY_NOON + 2 });
  });

  it("leaves a season rating quest alone for an activity that earned none", () => {
    const step = applyActivityToQuests(
      openQuestBook(WEDNESDAY_NOON),
      raid(WEDNESDAY_NOON, "tna", 0),
      ratingDaily(1000),
    );

    expect(progress(step.book, "daily")).toBe(0);
  });

  it("ignores an activity from before a quest started", () => {
    const { book } = refreshQuests(openQuestBook(WEDNESDAY_NOON), alice, WEDNESDAY_NOON, rules);

    const late = applyActivityToQuests(book, raid(WEDNESDAY_NOON - HOUR), rules);

    // It still counts toward the daily and weekly, which started at midnight and on Monday.
    expect(progress(late.book, "daily")).toBe(1);
    expect(progress(late.book, "weekly")).toBe(1);
    expect(progress(late.book, "repeatable")).toBe(0);
  });
});

const NOL_RAIDS: QuestObjective = { type: "raids", raid: "nol", count: 3 };
const NINE_WARS: QuestObjective = { type: "wars", count: 9 };

/** Rules whose only quest is a daily for 3 NOL raids or 9 wars. */
const raidsOrWars: QuestRules = {
  dailyChargeCap: 3,
  templates: [{ id: "either", slot: "daily", objectives: [NOL_RAIDS, NINE_WARS], reward: { leaf: 300, xp: 150 } }],
};

describe("a quest with two ways to finish it", () => {
  it("counts raids and wars toward their own goals", () => {
    const { book, completed } = play(
      openQuestBook(WEDNESDAY_NOON),
      [raid(WEDNESDAY_NOON, "nol"), war(WEDNESDAY_NOON + 1), war(WEDNESDAY_NOON + 2), raid(WEDNESDAY_NOON + 3, "tna")],
      raidsOrWars,
    );

    expect(book.latest.daily?.goals).toEqual([
      { objective: NOL_RAIDS, progress: 1 },
      { objective: NINE_WARS, progress: 2 },
    ]);
    expect(completed).toEqual([]);
  });

  it("finishes by wars alone, keeping the raids counted so far", () => {
    const wars = Array.from({ length: 9 }, (_, offset) => war(WEDNESDAY_NOON + 1 + offset));
    const { book, completed } = play(
      openQuestBook(WEDNESDAY_NOON),
      [raid(WEDNESDAY_NOON, "nol"), ...wars],
      raidsOrWars,
    );

    expect(completed).toEqual(["daily:1"]);
    expect(book.latest.daily).toMatchObject({
      sequence: 1,
      goals: [
        { objective: NOL_RAIDS, progress: 1 },
        { objective: NINE_WARS, progress: 9 },
      ],
      completedAt: WEDNESDAY_NOON + 9,
    });
  });

  it("finishes by raids alone, however many wars there were", () => {
    const wars = Array.from({ length: 8 }, (_, offset) => war(WEDNESDAY_NOON + offset));
    const raids = [10, 11, 12].map((offset) => raid(WEDNESDAY_NOON + offset, "nol"));
    const { completed } = play(openQuestBook(WEDNESDAY_NOON), [...wars, ...raids], raidsOrWars);

    expect(completed).toEqual(["daily:1"]);
  });

  it("leads with the goal nearest to being met, and the first on a tie", () => {
    const quest = (raids: number, wars: number): Quest => ({
      slot: "daily",
      sequence: 1,
      templateId: "either",
      reward: { leaf: 300, xp: 150 },
      startedAt: MONDAY,
      expiresAt: null,
      completedAt: null,
      goals: [
        { objective: NOL_RAIDS, progress: raids },
        { objective: NINE_WARS, progress: wars },
      ],
    });

    expect(leadingGoal(quest(1, 4)).objective).toBe(NINE_WARS);
    expect(leadingGoal(quest(2, 4)).objective).toBe(NOL_RAIDS);
    expect(leadingGoal(quest(1, 3)).objective).toBe(NOL_RAIDS);
  });
});

describe("the default quests", () => {
  const templates = DEFAULT_RULES.quests.templates;
  const warsFor = (id: string) =>
    templates.find((template) => template.id === id)?.objectives.find((objective) => objective.type === "wars");

  it("give every raid quest a war goal, at three wars for each raid it is worth", () => {
    for (const template of templates.filter((each) =>
      each.objectives.some((objective) => objective.type === "raids"),
    )) {
      expect([template.id, template.objectives.map((objective) => objective.type)]).toEqual([
        template.id,
        ["raids", "wars"],
      ]);
    }
    expect(warsFor("daily.raids.nol.3.or.wars.9")).toEqual({ type: "wars", count: 9 });
    expect(warsFor("daily.raids.any.2.or.wars.6")).toEqual({ type: "wars", count: 6 });
    expect(warsFor("weekly.raids.tna.12.or.wars.60")).toEqual({ type: "wars", count: 60 });
    expect(warsFor("weekly.raids.any.20.or.wars.60")).toEqual({ type: "wars", count: 60 });
    expect(warsFor("timed.raids.nol.2.or.wars.6")).toEqual({ type: "wars", count: 6 });
    expect(warsFor("timed.raids.any.3.or.wars.9")).toEqual({ type: "wars", count: 9 });
  });

  it("use each template id once, with one or two ways to finish", () => {
    expect(new Set(templates.map((template) => template.id)).size).toBe(templates.length);
    for (const template of templates) {
      expect(template.objectives.length).toBeGreaterThanOrEqual(1);
      expect(template.objectives.length).toBeLessThanOrEqual(2);
    }
  });
});

const TIMED_A: QuestObjective = { type: "raids", count: 2 };
const TIMED_B: QuestObjective = { type: "wars", count: 3 };

/** Rules with a timed quest every four hours for two, from two templates. */
const timedRules: QuestRules = {
  dailyChargeCap: 3,
  templates: [
    { id: "timed.a", slot: "timed", objectives: [TIMED_A], reward: { leaf: 500, xp: 250 } },
    { id: "timed.b", slot: "timed", objectives: [TIMED_B], reward: { leaf: 500, xp: 250 } },
  ],
  timed: { everyMs: 4 * HOUR, openMs: 2 * HOUR, firstAt: 0 },
};

describe("timed quests", () => {
  it("open for two hours every four, from midnight UTC", () => {
    const schedule = { everyMs: 4 * HOUR, openMs: 2 * HOUR, firstAt: 0 };
    expect(timedWindowAt(WEDNESDAY_NOON, schedule)).toEqual({
      index: Math.floor(WEDNESDAY_NOON / (4 * HOUR)),
      start: WEDNESDAY_NOON,
      end: WEDNESDAY_NOON + 2 * HOUR,
    });
    expect(timedWindowAt(WEDNESDAY_NOON + 2 * HOUR, schedule)).toBeUndefined();
    expect(nextTimedWindowAt(WEDNESDAY_NOON + HOUR, schedule)).toBe(WEDNESDAY_NOON + 4 * HOUR);
    expect(nextTimedWindowAt(WEDNESDAY_NOON + 3 * HOUR, schedule)).toBe(WEDNESDAY_NOON + 4 * HOUR);
  });

  it("hand everyone the same quest for the window, and nothing between windows", () => {
    const bob = playerId("00000000-0000-4000-8000-00000000000b");
    const mine = refreshQuests(openQuestBook(WEDNESDAY_NOON), alice, WEDNESDAY_NOON + 30 * 60_000, timedRules);
    const theirs = refreshQuests(openQuestBook(WEDNESDAY_NOON), bob, WEDNESDAY_NOON + 90 * 60_000, timedRules);

    expect(mine.book.latest.timed).toMatchObject({ startedAt: WEDNESDAY_NOON, expiresAt: WEDNESDAY_NOON + 2 * HOUR });
    expect(theirs.book.latest.timed?.templateId).toBe(mine.book.latest.timed?.templateId);
    const between = refreshQuests(mine.book, alice, WEDNESDAY_NOON + 3 * HOUR, timedRules).book;
    expect(currentQuests(between, WEDNESDAY_NOON + 3 * HOUR).map((quest) => quest.slot)).toEqual([]);
  });

  it("count only what happens inside the window, and keep a finished one on show until it ends", () => {
    const start = refreshQuests(openQuestBook(WEDNESDAY_NOON), alice, WEDNESDAY_NOON, timedRules).book;
    const activities = [10, 20, 30, 40, 50].map((minutes) =>
      minutes % 20 === 10 ? raid(WEDNESDAY_NOON + minutes * 60_000) : war(WEDNESDAY_NOON + minutes * 60_000),
    );
    activities.push(war(WEDNESDAY_NOON + 55 * 60_000));
    const { book, completed } = play(start, activities, timedRules);

    expect(completed).toEqual(["timed:1"]);
    expect(currentQuests(book, WEDNESDAY_NOON + HOUR).map((quest) => [quest.slot, quest.completedAt !== null])).toEqual(
      [["timed", true]],
    );
    expect(currentQuests(book, WEDNESDAY_NOON + 2 * HOUR)).toEqual([]);

    const later = play(book, [raid(WEDNESDAY_NOON + 3 * HOUR), raid(WEDNESDAY_NOON + 4 * HOUR + 1)], timedRules);
    expect(later.book.latest.timed).toMatchObject({ sequence: 2, startedAt: WEDNESDAY_NOON + 4 * HOUR });
    expect(later.book.latest.timed?.goals.map((goal) => goal.progress)).toEqual([
      later.book.latest.timed?.templateId === "timed.a" ? 1 : 0,
    ]);
    expect(later.book.latest.timed?.templateId).not.toBe(book.latest.timed?.templateId);
  });

  it("never give a window the quest the window before had", () => {
    for (let index = 1; index < 200; index += 1) {
      expect(timedTemplateFor(timedRules, index)?.id).not.toBe(timedTemplateFor(timedRules, index - 1)?.id);
    }
  });

  it("take the third slot in the default rules, which hand out no repeatable", () => {
    const launched = Date.UTC(2026, 10, 25, 12);
    const { book } = refreshQuests(openQuestBook(launched), alice, launched, DEFAULT_RULES.quests);

    expect(currentQuests(book, launched).map((quest) => quest.slot)).toEqual(["daily", "weekly", "timed"]);
    expect(book.latest.timed?.reward).toEqual({ leaf: 500, xp: 250 });
    expect(DEFAULT_RULES.quests.templates.some((template) => template.slot === "repeatable")).toBe(false);
  });

  it("leave a repeatable unfinished once the rules hand none out, however it was handed out", () => {
    const dropped = {
      ...openQuestBook(WEDNESDAY_NOON),
      latest: {
        repeatable: {
          slot: "repeatable" as const,
          sequence: 4,
          templateId: "repeatable",
          goals: [{ objective: { type: "raids" as const, count: 2 }, progress: 1 }],
          reward: { leaf: 50, xp: 25 },
          startedAt: WEDNESDAY_NOON,
          expiresAt: null,
          completedAt: null,
        },
      },
    };

    const { book, completed } = play(dropped, [raid(WEDNESDAY_NOON + 60_000)], timedRules);
    expect(completed).toEqual([]);
    expect(book.latest.repeatable).toMatchObject({ sequence: 4, expiresAt: WEDNESDAY_NOON });
    expect(currentQuests(book, WEDNESDAY_NOON + HOUR).map((quest) => quest.slot)).toEqual(["timed"]);
    expect(currentQuests(book, WEDNESDAY_NOON - 1).some((quest) => quest.slot === "repeatable")).toBe(false);
  });

  it("open no window before the first, even for an activity reported late", () => {
    const launch = {
      ...timedRules,
      timed: { everyMs: 4 * HOUR, openMs: 2 * HOUR, firstAt: WEDNESDAY_NOON + 4 * HOUR },
    };
    const early = refreshQuests(openQuestBook(WEDNESDAY_NOON), alice, WEDNESDAY_NOON + 3 * HOUR, launch).book;
    const { book, completed } = play(
      early,
      [raid(WEDNESDAY_NOON + 10 * 60_000), raid(WEDNESDAY_NOON + 20 * 60_000)],
      launch,
    );

    expect(completed).toEqual([]);
    expect(book.latest.timed).toBeUndefined();
    expect(timedWindowAt(WEDNESDAY_NOON, launch.timed)).toBeUndefined();
    expect(nextTimedWindowAt(WEDNESDAY_NOON - 8 * HOUR, launch.timed)).toBe(WEDNESDAY_NOON + 4 * HOUR);
    const unaligned = { ...launch.timed, firstAt: WEDNESDAY_NOON + 5 * HOUR };
    expect(nextTimedWindowAt(WEDNESDAY_NOON + 3 * HOUR, unaligned)).toBe(WEDNESDAY_NOON + 8 * HOUR);
    expect(refreshQuests(book, alice, WEDNESDAY_NOON + 4 * HOUR, launch).book.latest.timed).toMatchObject({
      startedAt: WEDNESDAY_NOON + 4 * HOUR,
    });
  });
});

describe("dailies", () => {
  it("finishes the daily and hands out no other until the next day", () => {
    const first = play(openQuestBook(WEDNESDAY_NOON), [raid(WEDNESDAY_NOON), raid(WEDNESDAY_NOON + HOUR)]);

    expect(first.completed).toContain("daily:1");
    expect(first.book.dailyCharges).toBe(0);
    expect(first.book.latest.daily).toMatchObject({ sequence: 1, completedAt: WEDNESDAY_NOON + HOUR });

    const sameDay = refreshQuests(first.book, alice, WEDNESDAY_NOON + 2 * HOUR, rules);
    expect(sameDay.written).toEqual([]);

    const nextDay = refreshQuests(first.book, alice, WEDNESDAY_NOON + DAY_MS, rules);
    expect(nextDay.book.latest.daily).toMatchObject({
      sequence: 2,
      goals: [{ progress: 0 }],
      startedAt: MONDAY + 3 * DAY_MS,
    });
  });

  it("banks a daily for each day away, up to the cap", () => {
    const { book } = refreshQuests(openQuestBook(MONDAY), alice, MONDAY + 2 * DAY_MS, rules);
    expect(book.dailyCharges).toBe(3);

    const muchLater = refreshQuests(book, alice, MONDAY + 30 * DAY_MS, rules);
    expect(muchLater.book.dailyCharges).toBe(3);
  });

  it("lets a returning player finish banked dailies back to back", () => {
    const { book } = refreshQuests(openQuestBook(MONDAY), alice, WEDNESDAY_NOON, rules);
    const raids = [0, 1, 2, 3, 4, 5, 6].map((minute) => raid(WEDNESDAY_NOON + minute * 60_000));

    const result = play(book, raids);

    const dailies = result.completed.filter((key) => key.startsWith("daily"));
    expect(dailies).toEqual(["daily:1", "daily:2", "daily:3"]);
    expect(result.book.dailyCharges).toBe(0);
  });

  it("does not count the raid that finishes a daily toward the next one", () => {
    const { book } = refreshQuests(openQuestBook(MONDAY), alice, WEDNESDAY_NOON, rules);

    const result = play(book, [raid(WEDNESDAY_NOON), raid(WEDNESDAY_NOON + 1)]);

    expect(result.book.latest.daily).toMatchObject({
      sequence: 2,
      goals: [{ progress: 0 }],
      startedAt: WEDNESDAY_NOON + 1,
    });
  });
});

describe("the weekly", () => {
  const threeRaids = [raid(WEDNESDAY_NOON), raid(WEDNESDAY_NOON + 1), raid(WEDNESDAY_NOON + 2)];

  it("is finished once and not replaced until the next week", () => {
    const done = play(openQuestBook(WEDNESDAY_NOON), threeRaids);
    expect(done.completed).toContain("weekly:1");

    const more = play(done.book, [raid(WEDNESDAY_NOON + DAY_MS)]);
    expect(more.book.latest.weekly).toMatchObject({ sequence: 1, goals: [{ progress: 3 }] });

    const nextWeek = refreshQuests(more.book, alice, MONDAY + WEEK_MS, rules);
    expect(nextWeek.book.latest.weekly).toMatchObject({
      sequence: 2,
      goals: [{ progress: 0 }],
      startedAt: MONDAY + WEEK_MS,
      expiresAt: MONDAY + 2 * WEEK_MS,
    });
  });

  it("expires unfinished, and a raid in the new week counts toward the new one", () => {
    const partial = play(openQuestBook(WEDNESDAY_NOON), [raid(WEDNESDAY_NOON)]);

    const nextWeek = play(partial.book, [raid(MONDAY + WEEK_MS + HOUR)]);

    expect(nextWeek.completed).not.toContain("weekly:1");
    expect(nextWeek.book.latest.weekly).toMatchObject({ sequence: 2, goals: [{ progress: 1 }] });
  });
});

describe("the repeatable", () => {
  it("unlocks the next one as soon as it is finished", () => {
    const raids = [0, 1, 2, 3].map((offset) => raid(WEDNESDAY_NOON + offset));

    const result = play(openQuestBook(WEDNESDAY_NOON), raids);

    expect(result.completed.filter((key) => key.startsWith("repeatable"))).toEqual(["repeatable:1", "repeatable:2"]);
    expect(result.book.latest.repeatable).toMatchObject({ sequence: 3, goals: [{ progress: 0 }] });
  });
});

/** One free reroll a slot a day, then 100 Leaf, for dailies and weeklies. */
const REROLLS: RerollRules = { slots: ["daily", "weekly"], freePerDay: 1, leaf: 100 };

/** Two dailies and two weeklies to swap between. */
const rerollRules: QuestRules = {
  dailyChargeCap: 3,
  templates: [
    { id: "daily.raids", slot: "daily", objectives: [{ type: "raids", count: 2 }], reward: { leaf: 200, xp: 100 } },
    { id: "daily.wars", slot: "daily", objectives: [{ type: "wars", count: 6 }], reward: { leaf: 200, xp: 100 } },
    { id: "weekly.raids", slot: "weekly", objectives: [{ type: "raids", count: 3 }], reward: { leaf: 800, xp: 400 } },
    { id: "weekly.wars", slot: "weekly", objectives: [{ type: "wars", count: 9 }], reward: { leaf: 800, xp: 400 } },
  ],
  reroll: REROLLS,
};

/** The progress of every goal of a slot's latest quest. */
function goalProgress(book: QuestBook, slot: QuestSlot): number[] | undefined {
  return book.latest[slot]?.goals.map((goal) => goal.progress);
}

/** Alice on Wednesday at noon, after a raid and a war, so every quest has some progress. */
function started() {
  const fresh = refreshQuests(openQuestBook(WEDNESDAY_NOON), alice, WEDNESDAY_NOON, rerollRules).book;
  return play(fresh, [raid(WEDNESDAY_NOON + 1), war(WEDNESDAY_NOON + 2)], rerollRules).book;
}

describe("rerolling", () => {
  it("swaps the daily for another that counts from the reroll, on the same banked daily", () => {
    const book = started();
    const daily = book.latest.daily;
    if (daily === undefined) throw new Error("no daily");
    const at = WEDNESDAY_NOON + HOUR;

    const step = rerollQuest(book, alice, "daily", 1, at, 0, rerollRules);

    if (step.status !== "rerolled") throw new Error(`refused: ${step.reason}`);
    expect(step.cost).toBe(0);
    expect(step.replaced).toEqual({ ...daily, expiresAt: at });
    expect(daily.goals.some((goal) => goal.progress === 1)).toBe(true);
    expect(step.quest).toMatchObject({ slot: "daily", sequence: 2, startedAt: at, expiresAt: null, completedAt: null });
    expect(step.quest.templateId).not.toBe(step.replaced.templateId);
    expect(goalProgress(step.book, "daily")).toEqual([0]);
    expect(step.book.dailyCharges).toBe(book.dailyCharges);
    expect(step.written).toEqual([step.replaced, step.quest]);
    expect(step.completed).toEqual([]);
    expect(currentQuests(step.book, at).find((quest) => quest.slot === "daily")).toEqual(step.quest);
  });

  it("keeps the weekly's end, and counts only what happens after the reroll", () => {
    const at = WEDNESDAY_NOON + HOUR;
    const step = rerollQuest(started(), alice, "weekly", 1, at, 0, rerollRules);
    if (step.status !== "rerolled") throw new Error(`refused: ${step.reason}`);
    expect(step.quest).toMatchObject({ sequence: 2, startedAt: at, expiresAt: MONDAY + WEEK_MS });

    // A raid and a war from before the reroll, reported late, count toward neither weekly.
    const late = play(step.book, [raid(at - 60_000), war(at - 60_000)], rerollRules).book;
    expect(goalProgress(late, "weekly")).toEqual([0]);
    expect(late.latest.weekly?.sequence).toBe(2);

    const after = play(late, [raid(at + 60_000), war(at + 60_000)], rerollRules).book;
    expect(goalProgress(after, "weekly")).toEqual([1]);
  });

  it("is free the first time a slot is rerolled each day, and costs Leaf after", () => {
    const book = started();

    const second = rerollQuest(book, alice, "daily", 1, WEDNESDAY_NOON + HOUR, 1, rerollRules);
    expect(second).toMatchObject({ status: "rerolled", cost: 100 });

    const daily = book.latest.daily;
    if (daily === undefined) throw new Error("no daily");
    expect(rerollCost(daily, 0, rerollRules)).toBe(0);
    expect(rerollCost(daily, 1, rerollRules)).toBe(100);
    expect(rerollCost(daily, 5, rerollRules)).toBe(100);
  });

  it("refuses a quest that is no longer the one in its slot, so a request sent twice swaps once", () => {
    const at = WEDNESDAY_NOON + HOUR;
    const once = rerollQuest(started(), alice, "daily", 1, at, 0, rerollRules);
    if (once.status !== "rerolled") throw new Error(`refused: ${once.reason}`);

    expect(rerollQuest(once.book, alice, "daily", 1, at + 1, 1, rerollRules)).toEqual({
      status: "refused",
      reason: "not_current",
    });
    expect(rerollQuest(once.book, alice, "daily", 7, at + 1, 1, rerollRules)).toMatchObject({ reason: "not_current" });
  });

  it("refuses a daily when none is banked", () => {
    const done = play(openQuestBook(WEDNESDAY_NOON), [raid(WEDNESDAY_NOON), raid(WEDNESDAY_NOON + 1)], {
      ...rerollRules,
      templates: rerollRules.templates.filter((template) => template.id !== "daily.wars"),
    }).book;
    expect(done.dailyCharges).toBe(0);

    expect(rerollQuest(done, alice, "daily", 1, WEDNESDAY_NOON + HOUR, 0, rerollRules)).toMatchObject({
      reason: "not_current",
    });
  });

  it("refuses a finished weekly, which would otherwise pay twice", () => {
    const fresh = refreshQuests(openQuestBook(WEDNESDAY_NOON), alice, WEDNESDAY_NOON, rerollRules).book;
    const isRaids = fresh.latest.weekly?.templateId === "weekly.raids";
    const activities = Array.from({ length: isRaids ? 3 : 9 }, (_, index) =>
      isRaids ? raid(WEDNESDAY_NOON + index + 1) : war(WEDNESDAY_NOON + index + 1),
    );
    const { book, completed } = play(fresh, activities, rerollRules);
    expect(completed).toContain("weekly:1");

    expect(rerollQuest(book, alice, "weekly", 1, WEDNESDAY_NOON + HOUR, 0, rerollRules)).toEqual({
      status: "refused",
      reason: "not_rerollable",
    });
  });

  it("refuses a slot the rules don't allow, a slot with nothing else to swap to, and rules without rerolls", () => {
    const timed = { ...timedRules, reroll: REROLLS };
    const open = refreshQuests(openQuestBook(WEDNESDAY_NOON), alice, WEDNESDAY_NOON, timed).book;
    expect(rerollQuest(open, alice, "timed", 1, WEDNESDAY_NOON + 1, 0, timed)).toMatchObject({
      reason: "not_rerollable",
    });

    const single = { ...rules, reroll: REROLLS };
    const alone = refreshQuests(openQuestBook(WEDNESDAY_NOON), alice, WEDNESDAY_NOON, single).book;
    expect(rerollQuest(alone, alice, "daily", 1, WEDNESDAY_NOON + 1, 0, single)).toMatchObject({
      reason: "not_rerollable",
    });

    const { reroll: _, ...noRerolls } = rerollRules;
    expect(rerollQuest(started(), alice, "daily", 1, WEDNESDAY_NOON + 1, 0, noRerolls)).toMatchObject({
      reason: "not_rerollable",
    });
  });

  it("brings the book up to the reroll first, so a daily banked overnight is the one swapped", () => {
    const tomorrow = WEDNESDAY_NOON + DAY_MS;
    const done = play(openQuestBook(WEDNESDAY_NOON), [raid(WEDNESDAY_NOON), raid(WEDNESDAY_NOON + 1)], {
      ...rerollRules,
      templates: rerollRules.templates.filter((template) => template.id !== "daily.wars"),
    }).book;

    const step = rerollQuest(done, alice, "daily", 2, tomorrow, 0, rerollRules);

    expect(step).toMatchObject({
      status: "rerolled",
      replaced: { sequence: 2, startedAt: MONDAY + 3 * DAY_MS, expiresAt: tomorrow },
      quest: { sequence: 3, startedAt: tomorrow },
    });
  });

  it("changes only the slot rerolled, so last week's weekly still takes Sunday's raids counted late", () => {
    const sunday = MONDAY + WEEK_MS - HOUR;
    const lastWeek = refreshQuests(openQuestBook(sunday), alice, sunday, rerollRules).book;
    const monday = MONDAY + WEEK_MS + 10 * 60_000;

    const step = rerollQuest(lastWeek, alice, "daily", 1, monday, 0, rerollRules);

    if (step.status !== "rerolled") throw new Error(`refused: ${step.reason}`);
    expect(step.book.latest.weekly).toEqual(lastWeek.latest.weekly);
    expect(step.written.map((quest) => `${quest.slot}:${quest.sequence}`)).toEqual(["daily:1", "daily:2"]);
    const late = play(step.book, [raid(sunday + 1), war(sunday + 2)], rerollRules).book;
    expect(late.latest.weekly?.sequence).toBe(1);
    expect(goalProgress(late, "weekly")).toEqual([1]);
  });

  it("leaves the banked dailies as they were when another slot is rerolled", () => {
    const yesterday = WEDNESDAY_NOON - DAY_MS;
    const book = refreshQuests(openQuestBook(yesterday), alice, yesterday, rerollRules).book;

    const step = rerollQuest(book, alice, "weekly", 1, WEDNESDAY_NOON, 0, rerollRules);

    expect(step).toMatchObject({
      status: "rerolled",
      book: { dailyCharges: 1, dailyChargedDay: book.dailyChargedDay },
    });
    expect(rerollQuest(book, alice, "daily", 1, WEDNESDAY_NOON, 0, rerollRules)).toMatchObject({
      book: { dailyCharges: 2 },
    });
  });

  it("lets members reroll dailies and weeklies, once a day each for free and then for 100 Leaf", () => {
    const at = Date.UTC(2026, 10, 25, 12);
    const { book } = refreshQuests(openQuestBook(at), alice, at, DEFAULT_RULES.quests);
    const costs = currentQuests(book, at).map((quest) => [
      quest.slot,
      rerollCost(quest, 0, DEFAULT_RULES.quests),
      rerollCost(quest, 1, DEFAULT_RULES.quests),
    ]);

    expect(costs).toEqual([
      ["daily", 0, 100],
      ["weekly", 0, 100],
      ["timed", null, null],
    ]);
  });
});

describe("what a player sees", () => {
  it("shows the quest in progress for each slot", () => {
    const { book } = refreshQuests(openQuestBook(WEDNESDAY_NOON), alice, WEDNESDAY_NOON, rules);

    expect(currentQuests(book, WEDNESDAY_NOON).map((quest) => quest.slot)).toEqual(["daily", "weekly", "repeatable"]);
  });

  it("keeps a finished weekly on show until its week ends, and drops a finished daily", () => {
    const raids = [0, 1, 2].map((offset) => raid(WEDNESDAY_NOON + offset));
    const { book } = play(openQuestBook(WEDNESDAY_NOON), raids);

    const seen = currentQuests(book, WEDNESDAY_NOON + HOUR);
    expect(seen.map((quest) => [quest.slot, quest.completedAt !== null])).toEqual([
      ["weekly", true],
      ["repeatable", false],
    ]);
    expect(currentQuests(book, MONDAY + WEEK_MS).map((quest) => quest.slot)).toEqual(["repeatable"]);
  });

  it("says when the next daily arrives, unless the bank is full", () => {
    const fresh = openQuestBook(WEDNESDAY_NOON);
    expect(nextDailyChargeAt(fresh, rules)).toBe(MONDAY + 3 * DAY_MS);

    const full = refreshQuests(fresh, alice, WEDNESDAY_NOON + 5 * DAY_MS, rules).book;
    expect(nextDailyChargeAt(full, rules)).toBeNull();
  });
});

describe("pickTemplate", () => {
  it("always makes the same choice for the same player and sequence", () => {
    const first = pickTemplate(DEFAULT_RULES.quests, "daily", alice, 7, undefined);

    expect(pickTemplate(DEFAULT_RULES.quests, "daily", alice, 7, undefined)).toEqual(first);
    expect(first?.slot).toBe("daily");
  });

  it("never repeats the template the player just had", () => {
    for (let sequence = 1; sequence <= 50; sequence += 1) {
      const previous = pickTemplate(DEFAULT_RULES.quests, "daily", alice, sequence, undefined);
      const next = pickTemplate(DEFAULT_RULES.quests, "daily", alice, sequence + 1, previous?.id);
      expect(next?.id).not.toBe(previous?.id);
    }
  });

  it("repeats when the slot has a single template", () => {
    expect(pickTemplate(rules, "repeatable", alice, 2, "repeatable")?.id).toBe("repeatable");
  });
});

describe("calendar and wording", () => {
  it("starts weeks on Monday at midnight UTC", () => {
    expect(utcWeekStart(MONDAY)).toBe(MONDAY);
    expect(utcWeekStart(MONDAY - 1)).toBe(MONDAY - WEEK_MS);
    expect(utcWeekStart(WEDNESDAY_NOON)).toBe(MONDAY);
    expect(new Date(MONDAY).getUTCDay()).toBe(1);
  });

  it("words objectives the way players say them", () => {
    expect(objectiveTitle({ type: "raids", raid: "nol", count: 3 })).toBe("Complete 3 NOL raids");
    expect(objectiveTitle({ type: "raids", count: 8 })).toBe("Complete 8 raids");
    expect(objectiveTitle({ type: "raids", count: 1 })).toBe("Complete 1 raid");
    expect(objectiveTitle({ type: "wars", count: 2 })).toBe("Take part in 2 wars");
    expect(objectiveTitle({ type: "season_rating", amount: 1000 })).toBe("Earn 1,000 season rating");
  });

  it("words a quest with two ways as one sentence", () => {
    expect(questTitle([NOL_RAIDS, NINE_WARS])).toBe("Complete 3 NOL raids or 9 wars");
    expect(
      questTitle([
        { type: "wars", count: 2 },
        { type: "raids", count: 1 },
      ]),
    ).toBe("Take part in 2 wars or 1 raid");
    expect(questTitle([{ type: "season_rating", amount: 1000 }])).toBe("Earn 1,000 season rating");
  });
});

describe("levelForXp", () => {
  const levels = { firstLevelXp: 1000, xpGrowthPerLevel: 250, firstLevelLeaf: 100, leafGrowthPerLevel: 25 };

  it("starts everyone at level 1", () => {
    expect(levelForXp(0, levels)).toEqual({ level: 1, xpIntoLevel: 0, xpForNextLevel: 1000 });
    expect(levelForXp(999, levels)).toEqual({ level: 1, xpIntoLevel: 999, xpForNextLevel: 1000 });
  });

  it("needs a fixed amount more XP for each further level", () => {
    expect(levelForXp(1000, levels)).toEqual({ level: 2, xpIntoLevel: 0, xpForNextLevel: 1250 });
    expect(levelForXp(2249, levels)).toEqual({ level: 2, xpIntoLevel: 1249, xpForNextLevel: 1250 });
    expect(levelForXp(2250, levels)).toEqual({ level: 3, xpIntoLevel: 0, xpForNextLevel: 1500 });
  });
});

describe("leafForLevel", () => {
  const levels = { firstLevelXp: 1000, xpGrowthPerLevel: 250, firstLevelLeaf: 100, leafGrowthPerLevel: 25 };

  it("pays nothing for the level everyone starts at", () => {
    expect(leafForLevel(1, levels)).toBe(0);
    expect(leafForLevel(0, levels)).toBe(0);
    expect(leafForLevel(2.5, levels)).toBe(0);
  });

  it("pays a fixed amount more for each further level", () => {
    expect(leafForLevel(2, levels)).toBe(100);
    expect(leafForLevel(3, levels)).toBe(125);
    expect(leafForLevel(10, levels)).toBe(300);
  });

  it("pays a tenth of the XP each level took, as the guild's rules are set", () => {
    for (let level = 2; level <= 40; level += 1) {
      const took = DEFAULT_RULES.levels.firstLevelXp + (level - 2) * DEFAULT_RULES.levels.xpGrowthPerLevel;
      expect(leafForLevel(level, DEFAULT_RULES.levels)).toBe(took / 10);
    }
  });
});
