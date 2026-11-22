import { afterEach, describe, expect, test } from "bun:test";

import { isRecord } from "@sequoia-leaf/kit/net.ts";
import { type Standin, standin } from "@sequoia-leaf/kit/standin.ts";

import { openingTab, readNews, redrawn, SEEN, shortDay, unread } from "./board.ts";
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
    board.arrive(QUESTS.map((q) => ({ ...q, have: Math.min(q.need, q.have + 1) })));
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
    board.arrive([...rest.slice(1), { ...gone, id: `${gone.id}:swapped`, have: 1 }]);
    expect(board.counts).toEqual({ drawn: 3, updated: 3 });
  });
});

describe("the board's news", () => {
  let world: Standin | null = null;
  afterEach(() => {
    world?.done();
    world = null;
  });

  test("every note has an id of its own, a real day, newest first, and one or two lines", () => {
    const ids = NOTES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const days = NOTES.map((n) => n.day);
    for (const day of days) expect(new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10)).toBe(day);
    expect(days).toEqual(days.toSorted().toReversed());
    for (const n of NOTES) expect([1, 2]).toContain(n.lines.length);
    expect(shortDay("2026-11-22")).toBe("22 Nov");
    expect(shortDay("2027-01-05")).toBe("5 Jan");
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
