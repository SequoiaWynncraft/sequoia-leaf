import { describe, expect, test } from "bun:test";

import { isRecord } from "./net.ts";
import { duration, type GameStats, numbersOf, readBoard, readPerson } from "./person.ts";

/** What Leaf's game routes really answer, from the contract its own tests write. */
const GAME: unknown = await Bun.file(new URL("../../../contracts/leaf-game-v1.json", import.meta.url)).json();
const answer =
  isRecord(GAME) && isRecord(GAME["GET /v1/game/people/{player}"]) ? GAME["GET /v1/game/people/{player}"].body : null;

/** Two games as a page says them. */
const WORKS: GameStats = {
  name: "The Works",
  numbers: (p) => [
    { label: "Coins", value: String(p.score) },
    { label: "Place", value: `#${p.place}` },
  ],
};
const RAID: GameStats = { name: "The Little Raid", numbers: (p) => [{ label: "Runs", value: String(p.also.runs) }] };
const STATS = { works: WORKS, raid: RAID };

describe("a person's card", () => {
  test("shows time AFK only from a minute, and time played from a second", () => {
    const g = { placed: null, spent: 0 };
    expect(
      numbersOf({ name: "Wrenly", games: { works: { ...g, played: 1, afk: 59 } }, played: 1, afk: 59 }, STATS),
    ).toEqual({
      stats: [
        { label: "Time played", value: "under 1 min" },
        "The Works",
        { label: "Time played", value: "under 1 min" },
      ],
    });
  });

  test("shows the time played and AFK in all, then each game in the page's order, its name over its numbers and its times, from what Leaf answers", () => {
    const said = readPerson(answer);
    expect(said).toEqual({
      name: "Alice",
      games: {
        pulls: { placed: null, played: 60, afk: 0, spent: 0 },
        raid: { placed: { place: 1, score: 0, also: { runs: 0, room: 0 } }, played: 0, afk: 0, spent: 0 },
        town: { placed: { place: 1, score: 10, also: { greeted: 0, sightings: 0 } }, played: 180, afk: 120, spent: 25 },
        works: { placed: { place: 2, score: 1840, also: { tier: 1 } }, played: 0, afk: 0, spent: 0 },
      },
      played: 240,
      afk: 120,
    });
    const TOWN: GameStats = {
      name: "Camp",
      numbers: (p, spent) => [
        { label: "Things set out", value: String(p.score) },
        { label: "Coins spent", value: String(spent) },
      ],
    };
    const PULLS: GameStats = { name: "Pulls", numbers: () => [{ label: "Pulled", value: "0" }] };
    expect(said && numbersOf(said, { ...STATS, town: TOWN, pulls: PULLS })).toEqual({
      stats: [
        { label: "Time played", value: "4 min" },
        { label: "Time AFK", value: "2 min" },
        "The Works",
        { label: "Coins", value: "1840" },
        { label: "Place", value: "#2" },
        "The Little Raid",
        { label: "Runs", value: "0" },
        "Camp",
        { label: "Things set out", value: "10" },
        { label: "Coins spent", value: "25" },
        { label: "Time played", value: "3 min" },
        { label: "Time AFK", value: "2 min" },
        // Played, with no standing: its time alone.
        "Pulls",
        { label: "Time played", value: "1 min" },
      ],
    });
    // A game the page does not say is left out, but counts in all.
    expect(said && numbersOf(said, { raid: RAID })).toEqual({
      stats: [
        { label: "Time played", value: "4 min" },
        { label: "Time AFK", value: "2 min" },
        "The Little Raid",
        { label: "Runs", value: "0" },
      ],
    });
  });

  test("says so of somebody who has played nothing, and reads nothing from an answer that makes no sense", () => {
    expect(numbersOf({ name: "Wrenly", games: {}, played: 0, afk: 0 }, STATS)).toEqual({
      blocks: [{ body: "Has not played yet." }],
    });
    const works = { place: 1, score: 1, also: {}, played: 5, afk: 0, spent: 0 };
    expect(readPerson({ name: "Wrenly", games: { works }, played: 5, afk: 0 })).not.toBeNull();
    for (const games of [
      { works: { ...works, score: "lots" } },
      { works: { ...works, played: -1 } },
      { works: { ...works, afk: undefined } },
      { works: { ...works, spent: 1.5 } },
      { works: {} },
    ]) {
      expect(readPerson({ name: "Wrenly", games, played: 5, afk: 0 })).toBeNull();
    }
    expect(readPerson({ name: "Wrenly", games: { works }, afk: 0 })).toBeNull();
    expect(readPerson({ name: "Wrenly", games: { works }, played: 5 })).toBeNull();
    expect(readPerson({ code: "no_such_player" })).toBeNull();
  });
});

test("a time played is written in minutes under an hour, hours and minutes under 100 hours, and hours from there", () => {
  const MIN = 60;
  const HOUR = 60 * MIN;
  expect(
    [
      0,
      59,
      MIN,
      42 * MIN + 59,
      HOUR - 1,
      HOUR,
      3 * HOUR,
      3 * HOUR + 20 * MIN,
      100 * HOUR - 1,
      100 * HOUR,
      132 * HOUR + 59 * MIN,
      1320 * HOUR,
    ].map(duration),
  ).toEqual([
    "under 1 min",
    "under 1 min",
    "1 min",
    "42 min",
    "59 min",
    "1 h",
    "3 h",
    "3 h 20 min",
    "99 h 59 min",
    "100 h",
    "132 h",
    "1,320 h",
  ]);
});

test("a board reads what Leaf really answers, and nothing from what makes no sense", () => {
  const standings = isRecord(GAME) ? GAME["GET /v1/game/play/{game}/standings"] : null;
  const board = readBoard(isRecord(standings) ? standings.body : null);
  expect(board?.top.map((r) => [r.place, r.name, r.guest, r.score, r.also.tier, r.you])).toEqual([
    [1, "Bob", false, 5120, 2, false],
    [2, "Alice", false, 1840, 1, true],
    [3, "Visitor", true, 960, 1, false],
  ]);
  expect(board?.you).toEqual({ place: 2, score: 1840, also: { tier: 1 } });
  expect(readBoard({ top: [{ place: 1 }], you: null })).toBeNull();
});
