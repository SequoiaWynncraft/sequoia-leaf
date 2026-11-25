import { afterEach, describe, expect, test } from "bun:test";

import { isRecord } from "@sequoia-leaf/kit/net.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";
import { type Standin, standin } from "@sequoia-leaf/kit/standin.ts";

import { kindLine, noteWhen, openingTab, questBoard, readNews, redrawn, SEEN, unread } from "./board.ts";
import type { Quest } from "./guild.ts";
import { readQuests } from "./live.ts";
import { NOTES } from "./notes.ts";

/** The member's quests as Leaf really sends them, from the contract its own tests write. */
const contract: unknown = await Bun.file(new URL("../../../contracts/leaf-api-v1.json", import.meta.url)).json();
const route = isRecord(contract) ? contract["GET /v1/me/quests"] : null;
const QUESTS = readQuests(isRecord(route) ? route.body : null);

/** A board over whatever quests are fresh, counting how often it is drawn whole and brought up to date. */
function aBoard(first: readonly Quest[]) {
  let fresh = first;
  const counts = { drawn: 0, updated: 0 };
  const refresh = redrawn(
    () => fresh.map((q) => q.id),
    () => {
      counts.drawn++;
      return () => {
        counts.updated++;
      };
    },
  );
  return {
    counts,
    /** Fresh quests arrive, and the board is brought up to date, as it is every moment it is open. */
    arrive(quests: readonly Quest[]): void {
      fresh = quests;
      refresh();
    },
  };
}

describe("the quest board keeps in step with the quests", () => {
  test("the same quests, moved on, are brought up to date in place", () => {
    expect(QUESTS.length).toBeGreaterThan(2);
    const board = aBoard(QUESTS);
    expect(board.counts).toEqual({ drawn: 1, updated: 0 });
    board.arrive(QUESTS);
    board.arrive(
      QUESTS.map((q) => ({ ...q, goals: q.goals.map((g) => ({ ...g, have: Math.min(g.need, g.have + 1) })) })),
    );
    // In another order, they are still the same quests.
    board.arrive(QUESTS.toReversed());
    expect(board.counts).toEqual({ drawn: 1, updated: 3 });
  });

  test("a quest gone from them, or swapped for another, draws the board again whole", () => {
    const [gone, ...rest] = QUESTS;
    if (!gone) throw new Error("no quests in the contract");
    const board = aBoard(QUESTS);
    // It expired.
    board.arrive(rest);
    expect(board.counts).toEqual({ drawn: 2, updated: 1 });
    // From another page, one was swapped for another in its slot: as many as before, but not the same.
    board.arrive([...rest.slice(1), { ...gone, id: `${gone.id}:swapped`, title: "Take part in 3 wars" }]);
    expect(board.counts).toEqual({ drawn: 3, updated: 2 });
    board.arrive([
      ...rest.slice(1),
      { ...gone, id: `${gone.id}:swapped`, goals: [{ have: 1, need: 3, unit: "wars" }] },
    ]);
    expect(board.counts).toEqual({ drawn: 3, updated: 3 });
  });
});

describe("what a quest's note says it is", () => {
  // A Wednesday.
  const now = Date.parse("2026-11-25T12:40:00Z");

  test("each kind by Leaf's and the mod's name, with no time for one that does not end at a set time", () => {
    expect(kindLine({ slot: "daily", ends: null }, now, "UTC")).toBe("Daily");
    expect(kindLine({ slot: "repeatable", ends: null }, now, "UTC")).toBe("Endless");
  });

  test("when it ends, in the reader's own time: the hour today, the day at midnight, both otherwise", () => {
    const weekly = QUESTS.find((q) => q.slot === "weekly");
    if (!weekly) throw new Error("no weekly in the contract");
    // Monday 00:00 UTC.
    expect(kindLine(weekly, now, "UTC")).toBe("Weekly · Until Monday");
    expect(kindLine(weekly, now, "Europe/Stockholm")).toBe("Weekly · Until Monday 01:00");
    expect(kindLine(weekly, now, "America/New_York")).toBe("Weekly · Until Sunday 19:00");
    const timed = { slot: "timed", ends: Date.parse("2026-11-25T14:00:00Z") };
    expect(kindLine(timed, now, "UTC")).toBe("Timed · Until 14:00");
    expect(kindLine(timed, now, "Europe/Stockholm")).toBe("Timed · Until 15:00");
    // 23:30 on Wednesday in Tokyo, for a window that closes at 01:00 there.
    const late = { slot: "timed", ends: Date.parse("2026-11-25T16:00:00Z") };
    expect(kindLine(late, Date.parse("2026-11-25T14:30:00Z"), "Asia/Tokyo")).toBe("Timed · Until Thursday 01:00");
  });
});

describe("the board's news", () => {
  let world: Standin | null = null;
  afterEach(() => {
    world?.done();
    world = null;
  });

  test("every note has an id of its own, a real moment or day, newest first, one or two lines, and full notes that say something", () => {
    const ids = NOTES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const ats = NOTES.map((n) => n.at);
    for (const at of ats) {
      expect(at).toMatch(/^\d{4}-\d\d-\d\d(T\d\d:\d\dZ)?$/);
      expect(Number.isNaN(new Date(at).getTime())).toBe(false);
    }
    // A note with only its day is older than every note of that day with a time, and sorts so.
    expect(ats).toEqual(ats.toSorted().toReversed());
    for (const n of NOTES) expect([1, 2]).toContain(n.lines.length);
    // Full notes, where a note has them: each part a heading and something under it, and no empty words.
    for (const n of NOTES)
      for (const p of n.more ?? []) {
        expect(p.head.trim()).not.toBe("");
        expect(p.points.length).toBeGreaterThan(0);
        for (const point of p.points) expect(point.trim()).not.toBe("");
      }
    expect(NOTES.some((n) => n.more !== undefined)).toBe(true);
    expect(noteWhen("2026-11-22T19:09Z", "Europe/Stockholm")).toBe("22 Nov, 20:09");
    expect(noteWhen("2026-11-22T23:30Z", "Europe/Stockholm")).toBe("23 Nov, 00:30");
    expect(noteWhen("2026-11-22T05:05Z", "UTC")).toBe("22 Nov, 05:05");
    expect(noteWhen("2026-11-22")).toBe("22 Nov");
    expect(noteWhen("2027-01-05")).toBe("5 Jan");
  });

  test("news is unread, and the board opens on it, until the newest note is opened", () => {
    world = standin({});
    expect(unread()).toBe(true);
    expect(openingTab()).toBe("News");
    readNews();
    expect(world.store.getItem(SEEN)).toBe(NOTES[0]?.id ?? "");
    expect(unread()).toBe(false);
    expect(openingTab()).toBe("Quests");
  });

  test("a note newer than the one last opened is unread again", () => {
    world = standin({});
    world.store.setItem(SEEN, NOTES[1]?.id ?? "");
    expect(unread()).toBe(true);
    world.store.setItem(SEEN, NOTES[0]?.id ?? "");
    expect(unread()).toBe(false);
  });
});

const redraw = (): void => undefined;

describe("a paid reroll on the board", () => {
  const paid = { ...(QUESTS[0] ?? { id: "q" }), reroll: 100 };

  test("goes on its second press while Quests stays on show; a free one goes at once", () => {
    const board = questBoard(scope());
    board.show("Quests");
    expect(board.reroll(paid, redraw)).toBe(false);
    expect(board.reroll(paid, redraw)).toBe(true);
    expect(board.reroll({ ...paid, reroll: 0 }, redraw)).toBe(true);
    expect(board.reroll({ ...paid, reroll: null }, redraw)).toBe(false);
  });

  test("pressed once, then News read and Quests shown again, only asks", () => {
    const board = questBoard(scope());
    board.show("Quests");
    expect(board.reroll(paid, redraw)).toBe(false);
    board.show("News");
    board.show("Quests");
    expect(board.reroll(paid, redraw)).toBe(false);
    expect(board.reroll(paid, redraw)).toBe(true);
  });

  test("pressed once, then its price changes, only asks; and the board put away ends it", () => {
    const life = scope();
    const board = questBoard(life);
    board.show("Quests");
    expect(board.reroll(paid, redraw)).toBe(false);
    expect(board.reroll({ ...paid, reroll: 200 }, redraw)).toBe(false);
    life.close();
    expect(board.reroll({ ...paid, reroll: 200 }, redraw)).toBe(false);
  });
});
