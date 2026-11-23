import { describe, expect, test } from "bun:test";

import { DAY_MS } from "./quests.ts";
import {
  activityReport,
  away,
  deviceForWidth,
  GAME_AT,
  joinsSession,
  ODD_RULES,
  oddities,
  playing,
  readDevice,
  silentSince,
  VISIT_RULES,
  visitSeconds,
} from "./visits.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Wednesday 25 November 2026, 00:00 UTC. */
const DAY0 = Date.UTC(2026, 10, 25);

describe("devices", () => {
  test("a page under 700 CSS pixels wide is a phone's, any other a desktop's", () => {
    expect([deviceForWidth(390), deviceForWidth(699), deviceForWidth(700), deviceForWidth(1440)]).toEqual([
      "phone",
      "phone",
      "desktop",
      "desktop",
    ]);
    expect([readDevice("phone"), readDevice("desktop"), readDevice("tablet"), readDevice(undefined)]).toEqual([
      "phone",
      "desktop",
      null,
      null,
    ]);
  });
});

describe("visits and sessions", () => {
  test("a visit lasts its whole seconds, and never less than none", () => {
    expect([visitSeconds(0, 59_999), visitSeconds(1000, 61_000), visitSeconds(5000, 1000)]).toEqual([59, 60, 0]);
  });

  test("a visit begun less than five minutes after the last session ended joins it; at five it begins another", () => {
    const ended = DAY0 + HOUR;
    expect(joinsSession(ended, ended + 5 * MINUTE - 1)).toBe(true);
    expect(joinsSession(ended, ended + 5 * MINUTE)).toBe(false);
    // One of its visits is still open.
    expect(joinsSession(null, ended + DAY_MS)).toBe(true);
    expect(VISIT_RULES.sessionGapMs).toBe(5 * MINUTE);
  });

  test("an open visit goes silent 90 seconds after it was last heard of", () => {
    expect([silentSince(0, 89_999), silentSince(0, 90_000)]).toEqual([false, true]);
  });

  test("time is played from less than five minutes after the player last did something, or after it; AFK from five, or never having", () => {
    const did = 10 * MINUTE;
    expect([did - MINUTE, did, did + 5 * MINUTE - 1, did + 5 * MINUTE].map((from) => playing(from, did))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(playing(did, null)).toBe(false);
  });

  test("a player is away from five minutes after they last did something, as their time is counted AFK, or never having", () => {
    const did = 10 * MINUTE;
    expect([did, did + 5 * MINUTE - 1, did + 5 * MINUTE].map((now) => away(did, now))).toEqual([false, false, true]);
    expect(away(null, did)).toBe(true);
  });

  test("the town, the camps and the Grove are the town's game, the table the raid's", () => {
    expect(GAME_AT).toEqual({ town: "town", camp: "town", grove: "town", works: "works", table: "raid" });
  });
});

/** `n` sessions a player began ten minutes apart from the start of a day. */
const sessions = (playerId: string, n: number, day: number) =>
  Array.from({ length: n }, (_, k) => ({ playerId, startedAt: day + k * 10 * MINUTE }));

describe("out of the ordinary", () => {
  const none = { coins: [], sessions: [], visits: [], commands: [], from: DAY0, now: DAY0 + 2 * DAY_MS };

  test("Coins that rose more than 5,000 in an hour, the most each day, from the hour's first entry", () => {
    const odd = oddities({
      ...none,
      coins: [
        // Alice: 5,200 between 10:00 and 10:59, though she spent some of it.
        { playerId: "alice", at: DAY0 + 10 * HOUR, amount: 3000 },
        { playerId: "alice", at: DAY0 + 10 * HOUR + 20 * MINUTE, amount: -800 },
        { playerId: "alice", at: DAY0 + 10 * HOUR + 59 * MINUTE, amount: 3000 },
        // An hour after her last, so in an hour of its own.
        { playerId: "alice", at: DAY0 + 11 * HOUR + 59 * MINUTE, amount: 3000 },
        // Bob: exactly 5,000, which is not more.
        { playerId: "bob", at: DAY0 + 12 * HOUR, amount: 2500 },
        { playerId: "bob", at: DAY0 + 12 * HOUR + 30 * MINUTE, amount: 2500 },
        // Carol: 6,000 over an hour and a minute, never 5,000 in one.
        { playerId: "carol", at: DAY0 + 14 * HOUR, amount: 3000 },
        { playerId: "carol", at: DAY0 + 15 * HOUR + MINUTE, amount: 3000 },
      ],
    });

    expect(odd).toEqual([{ playerId: "alice", kind: "coins_in_an_hour", at: DAY0 + 10 * HOUR, value: 5200 }]);
  });

  test("more than 20 sessions begun in one UTC day", () => {
    const odd = oddities({
      ...none,
      sessions: [...sessions("alice", 21, DAY0), ...sessions("bob", 20, DAY0), ...sessions("carol", 25, DAY0 - DAY_MS)],
    });

    expect(odd).toEqual([{ playerId: "alice", kind: "sessions_in_a_day", at: DAY0, value: 21 }]);
  });

  test("a visit longer than 12 hours, ended or still open", () => {
    const now = DAY0 + 2 * DAY_MS;
    const odd = oddities({
      ...none,
      visits: [
        { playerId: "alice", place: "town", enteredAt: DAY0, leftAt: DAY0 + 12 * HOUR + 1000 },
        { playerId: "bob", place: "camp", enteredAt: DAY0, leftAt: DAY0 + 12 * HOUR },
        { playerId: "carol", place: "works", enteredAt: now - 13 * HOUR, leftAt: null },
      ],
    });

    expect(odd).toEqual([
      { playerId: "carol", kind: "long_visit", at: now - 13 * HOUR, value: 13 * 3600 },
      { playerId: "alice", kind: "long_visit", at: DAY0, value: 12 * 3600 + 1 },
    ]);
  });

  test("more commands refused than done in a day", () => {
    const odd = oddities({
      ...none,
      commands: [
        { playerId: "alice", day: DAY0, done: 3, refused: 4 },
        { playerId: "bob", day: DAY0, done: 4, refused: 4 },
        { playerId: "carol", day: DAY0 - DAY_MS, done: 0, refused: 9 },
      ],
    });

    expect(odd).toEqual([{ playerId: "alice", kind: "refused_in_a_day", at: DAY0, value: 4 }]);
    expect(ODD_RULES).toEqual({ coinsInAnHour: 5000, sessionsInADay: 20, visitMs: 12 * HOUR });
  });
});

describe("the report", () => {
  const now = DAY0 + DAY_MS + 10 * HOUR;
  const report = activityReport({
    now,
    from: DAY0,
    visits: [
      // Alice, across midnight: an hour on the first day and two on the second, then at the Works now.
      { playerId: "alice", place: "town", enteredAt: DAY0 + 23 * HOUR, leftAt: DAY0 + DAY_MS + 2 * HOUR },
      { playerId: "alice", place: "works", enteredAt: now - 30 * MINUTE, leftAt: null },
      // Bob came before the period: only his time in it counts.
      { playerId: "bob", place: "camp", enteredAt: DAY0 - HOUR, leftAt: DAY0 + HOUR },
    ],
    sessions: [
      { playerId: "alice", startedAt: DAY0 + 23 * HOUR },
      { playerId: "alice", startedAt: now - 30 * MINUTE },
      { playerId: "bob", startedAt: DAY0 - HOUR },
    ],
    seen: [
      {
        playerId: "alice",
        name: "Alice",
        guest: false,
        firstSeenAt: DAY0 + 23 * HOUR,
        lastSeenAt: now,
        secondsTotal: 3 * 3600,
      },
      {
        playerId: "bob",
        name: "Bob",
        guest: true,
        firstSeenAt: DAY0 - 5 * DAY_MS,
        lastSeenAt: DAY0 + HOUR,
        secondsTotal: 9000,
      },
    ],
    done: Array.from({ length: 7 }, (_, k) => ({
      playerId: "alice",
      at: DAY0 + k * MINUTE,
      game: "raid",
      kind: "raid_room",
      data: { room: k },
    })),
    raid: [
      { playerId: "alice", at: DAY0 + 1, game: "raid", kind: "raid_started", data: { trail: "moss" } },
      { playerId: "alice", at: DAY0 + 2, game: "raid", kind: "raid_room", data: { won: true } },
      { playerId: "alice", at: DAY0 + 3, game: "raid", kind: "raid_room", data: { won: true } },
      { playerId: "alice", at: DAY0 + 4, game: "raid", kind: "raid_room", data: { won: false } },
      { playerId: "alice", at: DAY0 + 5, game: "raid", kind: "raid_ended", data: { ended: "lost" } },
      // A room won after the run ended, and one of a run begun before the period, count for none.
      { playerId: "alice", at: DAY0 + 6, game: "raid", kind: "raid_room", data: { won: true } },
      { playerId: "bob", at: DAY0 + 7, game: "raid", kind: "raid_room", data: { won: true } },
      { playerId: "bob", at: DAY0 + 8, game: "raid", kind: "raid_started", data: {} },
      { playerId: "bob", at: DAY0 + 9, game: "raid", kind: "raid_room", data: "nonsense" },
    ],
    works: [
      { playerId: "alice", firstAt: DAY0 + HOUR, storyOrders: 3 },
      { playerId: "bob", firstAt: DAY0 - DAY_MS, storyOrders: 3 },
      { playerId: "carol", firstAt: DAY0 + HOUR, storyOrders: 0 },
    ],
    coins: [],
    commands: [],
  });

  test("says who is where now, and each player's time in the period, most first", () => {
    expect(report.here).toEqual([
      { playerId: "alice", name: "Alice", guest: false, place: "works", since: now - 30 * MINUTE },
    ]);
    expect(report.players.map((p) => ({ ...p, done: p.done.map((d) => d.at) }))).toEqual([
      {
        playerId: "alice",
        name: "Alice",
        guest: false,
        firstSeenAt: DAY0 + 23 * HOUR,
        lastSeenAt: now,
        secondsTotal: 3 * 3600 + 30 * 60,
        sessions: 2,
        seconds: 3 * 3600 + 30 * 60,
        places: { town: 3 * 3600, works: 30 * 60 },
        // The last five, newest first.
        done: [6, 5, 4, 3, 2].map((k) => DAY0 + k * MINUTE),
      },
      {
        playerId: "bob",
        name: "Bob",
        guest: true,
        firstSeenAt: DAY0 - 5 * DAY_MS,
        lastSeenAt: DAY0 + HOUR,
        secondsTotal: 9000,
        sessions: 1,
        seconds: 3600,
        places: { camp: 3600 },
        done: [],
      },
    ]);
  });

  test("totals each UTC day, splitting a visit at midnight", () => {
    expect(report.days).toEqual([
      { day: DAY0, players: 2, newPlayers: 1, sessions: 1, hours: 2, places: { camp: 1, town: 1 } },
      { day: DAY0 + DAY_MS, players: 1, newPlayers: 0, sessions: 1, hours: 2.5, places: { town: 2, works: 0.5 } },
    ]);
  });

  test("counts the raid runs begun and the rooms each won, and the Works' story orders by player", () => {
    expect(report.raid).toEqual({
      began: 2,
      byRoomsWon: [
        { roomsWon: 0, runs: 1 },
        { roomsWon: 2, runs: 1 },
      ],
    });
    expect(report.works).toEqual({
      began: 2,
      byStoryOrders: [
        { storyOrders: 0, players: 1 },
        { storyOrders: 3, players: 2 },
      ],
    });
  });
});
