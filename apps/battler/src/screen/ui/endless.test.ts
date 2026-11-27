import { describe, expect, test } from "bun:test";

import { LEGACY_ERA, newAlmanac, type RoomRecord, startRun, wayOn } from "@sequoia-leaf/raid";

import { askToBeMet, chairsSaid, readDepthBoard, takenNews } from "./endless.ts";

const WEEK = Date.parse("2026-11-23T00:00:00Z");
/** A room of the Deep Woods (from 0) taken from the member, as their events give it. */
const taken = (id: number, room: number, by: string, at = "2026-11-26T12:00:00Z"): unknown => ({
  id,
  type: "held_taken",
  created_at: at,
  data: { game: "raid", slot: `deep:${room}`, by: { id: `id-${by}`, username: by } },
});
const other = (id: number): unknown => ({ id, type: "leaf_earned", created_at: "2026-11-26T12:00:00Z", data: {} });

describe("the line saying a room was taken", () => {
  test("a line for each room taken this week, by whoever took it last, in order of rooms", () => {
    const body = { events: [taken(4, 25, "Fernwick"), other(5), taken(6, 21, "Moss"), taken(7, 25, "Quill")] };
    expect(takenNews(body, WEEK, 0)).toEqual({
      newest: 7,
      lines: ["Room 22 was taken from you by Moss.", "Room 26 was taken from you by Quill."],
    });
  });

  test("is said once: read again from the newest looked at, the same events say nothing, and a new one is said", () => {
    const first = { events: [taken(4, 21, "Fernwick"), other(5)] };
    const once = takenNews(first, WEEK, 0);
    expect(once.lines).toEqual(["Room 22 was taken from you by Fernwick."]);
    expect(takenNews(first, WEEK, once.newest)).toEqual({ newest: 5, lines: [] });
    expect(takenNews({ events: [other(8)] }, WEEK, once.newest)).toEqual({ newest: 8, lines: [] });
    expect(takenNews({ events: [taken(9, 30, "Moss")] }, WEEK, 8).lines).toEqual([
      "Room 31 was taken from you by Moss.",
    ]);
  });

  test("a room taken before this week began, or anything else, says nothing", () => {
    const body = {
      events: [
        taken(1, 21, "Fernwick", "2026-11-22T23:59:00Z"),
        { id: 2, type: "held_taken", created_at: "2026-11-26T12:00:00Z", data: { game: "works", slot: "deep:21" } },
        { id: 3, type: "held_taken", created_at: "2026-11-26T12:00:00Z", data: { game: "raid", slot: "spar:1" } },
      ],
    };
    expect(takenNews(body, WEEK, 0)).toEqual({ newest: 3, lines: [] });
    expect(takenNews(null, WEEK, 6)).toEqual({ newest: 6, lines: [] });
  });
});

describe("an endless board from Leaf", () => {
  test("reads its rows and the member's own place; anything else is no board", () => {
    const body = {
      top: [{ place: 1, id: "a", name: "Fernwick", room: 31, at: "x", you: false }],
      you: { place: 4, room: 20, at: "x" },
    };
    expect(readDepthBoard(body)).toEqual({
      top: [{ place: 1, name: "Fernwick", room: 31, you: false }],
      you: { place: 4, room: 20 },
    });
    expect(readDepthBoard({ top: [], you: null })).toEqual({ top: [], you: null });
    expect(readDepthBoard({ top: [{ place: 1, name: 3, room: 31 }], you: null })).toBeNull();
    expect(readDepthBoard({ rooms: [] })).toBeNull();
  });
});

describe("the Deep Woods' card", () => {
  test("says the member's board and name can be met there until they have set out there", () => {
    const almanac = newAlmanac();
    expect(askToBeMet(almanac, null)).toBe(true);
    expect(askToBeMet(almanac, startRun(1, { era: LEGACY_ERA, way: wayOn({ id: "wilds" }) }))).toBe(true);
    expect(askToBeMet(almanac, startRun(1, { era: LEGACY_ERA, way: wayOn({ id: "deep" }) }))).toBe(false);
    almanac.deepest.deep = 3;
    expect(askToBeMet(almanac, null)).toBe(false);
  });
});

const boss = (room: number): RoomRecord => ({ room, kind: "boss", result: "win", standing: [3, 0], boss: null });
describe("an endless run's chairs", () => {
  test("are said on the level's card once a boss past room 15 has been beaten", () => {
    const run = startRun(1, { era: LEGACY_ERA, way: wayOn({ id: "wilds" }) });
    expect(chairsSaid(run)).toEqual([]);
    expect(chairsSaid({ ...run, record: [boss(4), boss(19)] })).toEqual([
      "Bosses beaten after room 15: 1 more figure than your level, 3 at most.",
    ]);
    expect(chairsSaid({ ...run, record: [boss(19), boss(24)] })[0]).toContain("2 more figures");
  });
});
