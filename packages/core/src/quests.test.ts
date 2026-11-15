import { describe, expect, it } from "bun:test";

import type { Activity, RaidKey } from "./activity.ts";
import { playerId } from "./player.ts";
import {
  applyActivityToQuests,
  currentQuests,
  DAY_MS,
  nextDailyChargeAt,
  openQuestBook,
  pickTemplate,
  type QuestBook,
  type QuestRules,
  type QuestSlot,
  questTitle,
  refreshQuests,
  utcWeekStart,
  WEEK_MS,
} from "./quests.ts";
import { DEFAULT_RULES, levelForXp } from "./rules.ts";

const alice = playerId("00000000-0000-4000-8000-00000000000a");
const HOUR = 60 * 60 * 1000;
/** Monday 2 November 2026, 00:00 UTC. */
const MONDAY = Date.UTC(2026, 10, 2);
const WEDNESDAY_NOON = MONDAY + 2 * DAY_MS + 12 * HOUR;

/** One template per slot, so every test knows which quest it will get. */
const rules: QuestRules = {
  dailyChargeCap: 3,
  templates: [
    { id: "daily", slot: "daily", objective: { type: "raids", count: 2 }, reward: { leaf: 200, xp: 100 } },
    { id: "weekly", slot: "weekly", objective: { type: "raids", count: 3 }, reward: { leaf: 800, xp: 400 } },
    { id: "repeatable", slot: "repeatable", objective: { type: "raids", count: 2 }, reward: { leaf: 50, xp: 25 } },
  ],
};

let nextId = 1;
function raid(occurredAt: number, key: RaidKey = "tna"): Activity {
  nextId += 1;
  return {
    kind: "raid",
    sourceKey: `raid:${nextId}:${alice}`,
    playerId: alice,
    occurredAt,
    seasonRating: 110,
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

function progress(book: QuestBook, slot: QuestSlot): number | undefined {
  return book.latest[slot]?.progress;
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
        { id: "nol", slot: "daily", objective: { type: "raids", raid: "nol", count: 3 }, reward: { leaf: 1, xp: 1 } },
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
      templates: [{ id: "wars", slot: "daily", objective: { type: "wars", count: 2 }, reward: { leaf: 1, xp: 1 } }],
    };

    const { completed } = play(
      openQuestBook(WEDNESDAY_NOON),
      [war(WEDNESDAY_NOON), raid(WEDNESDAY_NOON + 1), war(WEDNESDAY_NOON + 2)],
      wars,
    );

    expect(completed).toEqual(["daily:1"]);
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

describe("dailies", () => {
  it("finishes the daily and hands out no other until the next day", () => {
    const first = play(openQuestBook(WEDNESDAY_NOON), [raid(WEDNESDAY_NOON), raid(WEDNESDAY_NOON + HOUR)]);

    expect(first.completed).toContain("daily:1");
    expect(first.book.dailyCharges).toBe(0);
    expect(first.book.latest.daily).toMatchObject({ sequence: 1, completedAt: WEDNESDAY_NOON + HOUR });

    const sameDay = refreshQuests(first.book, alice, WEDNESDAY_NOON + 2 * HOUR, rules);
    expect(sameDay.written).toEqual([]);

    const nextDay = refreshQuests(first.book, alice, WEDNESDAY_NOON + DAY_MS, rules);
    expect(nextDay.book.latest.daily).toMatchObject({ sequence: 2, progress: 0, startedAt: MONDAY + 3 * DAY_MS });
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

    expect(result.book.latest.daily).toMatchObject({ sequence: 2, progress: 0, startedAt: WEDNESDAY_NOON + 1 });
  });
});

describe("the weekly", () => {
  const threeRaids = [raid(WEDNESDAY_NOON), raid(WEDNESDAY_NOON + 1), raid(WEDNESDAY_NOON + 2)];

  it("is finished once and not replaced until the next week", () => {
    const done = play(openQuestBook(WEDNESDAY_NOON), threeRaids);
    expect(done.completed).toContain("weekly:1");

    const more = play(done.book, [raid(WEDNESDAY_NOON + DAY_MS)]);
    expect(more.book.latest.weekly).toMatchObject({ sequence: 1, progress: 3 });

    const nextWeek = refreshQuests(more.book, alice, MONDAY + WEEK_MS, rules);
    expect(nextWeek.book.latest.weekly).toMatchObject({
      sequence: 2,
      progress: 0,
      startedAt: MONDAY + WEEK_MS,
      expiresAt: MONDAY + 2 * WEEK_MS,
    });
  });

  it("expires unfinished, and a raid in the new week counts toward the new one", () => {
    const partial = play(openQuestBook(WEDNESDAY_NOON), [raid(WEDNESDAY_NOON)]);

    const nextWeek = play(partial.book, [raid(MONDAY + WEEK_MS + HOUR)]);

    expect(nextWeek.completed).not.toContain("weekly:1");
    expect(nextWeek.book.latest.weekly).toMatchObject({ sequence: 2, progress: 1 });
  });
});

describe("the repeatable", () => {
  it("unlocks the next one as soon as it is finished", () => {
    const raids = [0, 1, 2, 3].map((offset) => raid(WEDNESDAY_NOON + offset));

    const result = play(openQuestBook(WEDNESDAY_NOON), raids);

    expect(result.completed.filter((key) => key.startsWith("repeatable"))).toEqual(["repeatable:1", "repeatable:2"]);
    expect(result.book.latest.repeatable).toMatchObject({ sequence: 3, progress: 0 });
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

  it("words quests the way players say them", () => {
    expect(questTitle({ type: "raids", raid: "nol", count: 3 })).toBe("Complete 3 NOL raids");
    expect(questTitle({ type: "raids", count: 8 })).toBe("Complete 8 raids");
    expect(questTitle({ type: "raids", count: 1 })).toBe("Complete 1 raid");
    expect(questTitle({ type: "wars", count: 2 })).toBe("Take part in 2 wars");
  });
});

describe("levelForXp", () => {
  const levels = { firstLevelXp: 1000, xpGrowthPerLevel: 250 };

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
