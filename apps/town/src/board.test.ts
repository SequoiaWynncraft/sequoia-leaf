import { afterEach, describe, expect, test } from "bun:test";

import { isRecord } from "@sequoia-leaf/kit/net.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";
import { press, type Standin, standin } from "@sequoia-leaf/kit/standin.ts";

import {
  kindLine,
  noteWhen,
  openingTab,
  type QuestBoard,
  questBoard,
  readNews,
  redrawn,
  SEEN,
  unread,
} from "./board.ts";
import type { Quest } from "./guild.ts";
import { readQuests } from "./live.ts";
import { newestAt, type Note, noteAt, NOTES, notesAt } from "./notes.ts";

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

/** Everything a note says on the board: its title, its lines and its full notes. */
const noteWords = (n: Note): string[] =>
  [n.title, ...n.lines].concat((n.more ?? []).flatMap((p) => [p.head].concat(p.points)));

/** The 150 notes of `apps/town/src/notes.json`, in its order, newest first, before each had a file of its own. */
const BEFORE_FILES = `
up-the-tree penguin-month groot-night works-tier-6-still works-tier-5-wire works-outer-land works-assembler
versus-tracker works-quiet-line works-reach works-tier-5-research raid-item-tools versus-smooth
pages-survive-deploys names-wrap raid-front-steady works-belt-feel gaz-on-the-stall works-you-walk
raid-endless-past-400 raid-own-endless raid-zone-hint wilds-rule-icons raid-crab-numbers raid-graid raid-groot
kit-one-tip raid-wilds-rules raid-seat-forge raid-live-tables raid-endless raid-gaz-body raid-end-clearly
raid-menu raid-gaz-balance raid-spar-variety raid-gaz-look raid-second-place raid-looks-steady raid-card-hover
raid-sell-items-back raid-fight-show raid-figure-mechanics raid-gaz-sage raid-steady-table raid-items-easy
raid-fight-behaviour raid-member-figure raid-own raid-met-boards camp-member-stands works-building-tweaks
blueprint-codes fell-redwoods paid-requests-extra le-for-leaf page-drift bosses-once-camp-pets
works-whole-yard-plan works-orders-and-power works-corner-stays works-undo works-top-two-rows card-rows-spacing
works-letter-ink works-per-minute works-pointer discord-sign-in works-phone stump-log-first letter-works-coins
camp-here rebind-keys works-orders-handed works-card-move items-per-minute works-folds background-frames
keyboards cat-purr settings-menu works-ways-in camp-live camp-visits town-no-walking-ghosts works-sorter-sides
tally-board works-long-works kit-reach works-clearer raid-clearer town-clearer works-steady-2 town-live-once
works-steady late-raids town-ways leaf-turns raid-fixes tally town-presence works-visit-live
works-splitter-grades works-recipe works-tier-3 works-gate works-tiers grove-quiet figures-town-look grove-hold
pull-characters storage grove-full-screen banner-1-open one-town-2 works-away one-town works-smoother
touches-seen the-grove board-rerolls time-played nobody-inside timber-and-shingle gate-card splitter-ways
works-area works-orders-list seen-in-town nothing-stuck belt-colours treasury-requests taps-land fire-seen
one-face visit-camps stand-apart works-splitters camp-follows-you new-look visit-yards works-plain-words
top-yards works-follows-you seen-lately-everyone lit-on-phones works-words raid-follows-you tap-to-leave
quick-return
`;

/** A moment of Leaf's clock after every note is out. */
const LATER = Math.max(...NOTES.map(noteAt)) + 1;

describe("the board's news", () => {
  let world: Standin | null = null;
  afterEach(() => {
    world?.done();
    world = null;
  });

  test("every note has an id of its own, a real moment, newest first, one or two lines, and full notes that say something", () => {
    const ids = NOTES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const ats = NOTES.map((n) => n.at);
    for (const at of ats) {
      expect(at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/);
      expect(Number.isNaN(new Date(at).getTime())).toBe(false);
    }
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

  test("the notes written before they had a file each come out in the order the one file had them", () => {
    const before = BEFORE_FILES.split(/\s+/).filter((id) => id !== "");
    expect(before).toHaveLength(150);
    expect(NOTES.map((n) => n.id).filter((id) => before.includes(id))).toEqual(before);
    // The ten newest of them, as the News tab showed them then.
    expect(newestAt(LATER).map((n) => n.id)).toEqual(before.slice(0, 10));
  });

  test("the news calls Worm, Moth, Rock, Greg and Orphion Graid, and Groot only the Nest of the Grootslangs", () => {
    // The one note that says why names Groot as the Nest; the Groot Night banner is about the Nest
    // too, and a grooter is one who raids it.
    const said = NOTES.flatMap((n) =>
      noteWords(n)
        .map((w) => w.replace("Groot is the Nest of the Grootslangs", ""))
        .filter((w) => /groot(?!slang)(?! night)(?!er)/i.test(w))
        .map((w) => `${n.id}: ${w}`),
    );
    expect(said).toEqual([]);
    expect(NOTES.find((n) => n.id === "raid-graid")?.lines).toEqual([
      "The origin of Worm, Moth, Rock, Greg and Orphion is now called Graid: Groot is the Nest of the Grootslangs, not every guild raid.",
    ]);
  });

  test("news is unread, and the board opens on it, until the newest note is opened", () => {
    world = standin({});
    expect(unread(LATER)).toBe(true);
    expect(openingTab(LATER)).toBe("News");
    readNews(LATER);
    expect(world.store.getItem(SEEN)).toBe(NOTES[0]?.id ?? "");
    expect(unread(LATER)).toBe(false);
    expect(openingTab(LATER)).toBe("Quests");
  });

  test("a note newer than the one last opened is unread again", () => {
    world = standin({});
    world.store.setItem(SEEN, NOTES[1]?.id ?? "");
    expect(unread(LATER)).toBe(true);
    world.store.setItem(SEEN, NOTES[0]?.id ?? "");
    expect(unread(LATER)).toBe(false);
  });

  test("a note waits for its moment by Leaf's clock: not shown, not unread, not read until its `at`", () => {
    world = standin({});
    // Groot Night's note, merged ahead of the banner, which opens at midnight UTC on 8 December.
    const night = NOTES.find((n) => n.id === "groot-night");
    expect(night?.at).toBe("2026-12-08T00:00Z");
    const at = Date.UTC(2026, 11, 8);
    expect(notesAt(at - 1).map((n) => n.id)).not.toContain("groot-night");
    expect(notesAt(at)[0]?.id).toBe("groot-night");
    // Read a millisecond before, the news is read as it stood then; at the moment it is unread again.
    readNews(at - 1);
    expect(world.store.getItem(SEEN)).not.toBe("groot-night");
    expect([unread(at - 1), openingTab(at - 1)]).toEqual([false, "Quests"]);
    expect([unread(at), openingTab(at)]).toEqual([true, "News"]);
    // Every note out by a moment is every note whose `at` has come, newest first.
    for (const t of [at - 1, at, Date.UTC(2026, 10, 27, 14, 24)])
      expect(notesAt(t)).toEqual(NOTES.filter((n) => noteAt(n) <= t));
  });
});

const redraw = (): void => undefined;
/** A press on a quest's Reroll: whether it goes ahead. */
const rerolled = (board: QuestBoard, q: Pick<Quest, "id" | "reroll">, again: () => void): boolean => {
  press();
  return board.reroll(q, again);
};

describe("a paid reroll on the board", () => {
  const paid = { ...(QUESTS[0] ?? { id: "q" }), reroll: 100 };

  test("goes on its second press while Quests stays on show; a free one goes at once", () => {
    const board = questBoard(scope(), () => LATER);
    board.show("Quests");
    expect(rerolled(board, paid, redraw)).toBe(false);
    expect(rerolled(board, paid, redraw)).toBe(true);
    expect(rerolled(board, { ...paid, reroll: 0 }, redraw)).toBe(true);
    expect(rerolled(board, { ...paid, reroll: null }, redraw)).toBe(false);
  });

  test("pressed once, then News read and Quests shown again, only asks", () => {
    const board = questBoard(scope(), () => LATER);
    board.show("Quests");
    expect(rerolled(board, paid, redraw)).toBe(false);
    board.show("News");
    board.show("Quests");
    expect(rerolled(board, paid, redraw)).toBe(false);
    expect(rerolled(board, paid, redraw)).toBe(true);
  });

  test("pressed once, then its price changes, only asks; and the board put away ends it", () => {
    const life = scope();
    const board = questBoard(life, () => LATER);
    board.show("Quests");
    expect(rerolled(board, paid, redraw)).toBe(false);
    expect(rerolled(board, { ...paid, reroll: 200 }, redraw)).toBe(false);
    life.close();
    expect(rerolled(board, { ...paid, reroll: 200 }, redraw)).toBe(false);
  });
});
