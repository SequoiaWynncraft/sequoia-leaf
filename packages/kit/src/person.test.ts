import { describe, expect, test } from "bun:test";

import { isRecord } from "./net.ts";
import { type GameStats, numbersOf, readBoard, readPerson } from "./person.ts";

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
  test("shows each game they stand in, in the page's order, its name over its numbers, from what Leaf answers", () => {
    const said = readPerson(answer);
    expect(said).toEqual({
      name: "Alice",
      games: {
        raid: { place: 1, score: 0, also: { runs: 0, room: 0 } },
        town: { place: 1, score: 10, also: { greeted: 0, sightings: 0 } },
        works: { place: 2, score: 1840, also: { story: 3 } },
      },
    });
    const games = said?.games;
    expect(games && numbersOf(games, STATS)).toEqual({
      stats: [
        "The Works",
        { label: "Coins", value: "1840" },
        { label: "Place", value: "#2" },
        "The Little Raid",
        { label: "Runs", value: "0" },
      ],
    });
    // A game the page does not say is left out.
    expect(games && numbersOf(games, { raid: RAID })).toEqual({
      stats: ["The Little Raid", { label: "Runs", value: "0" }],
    });
  });

  test("says so of somebody who has played nothing, and reads nothing from an answer that makes no sense", () => {
    expect(numbersOf({}, STATS)).toEqual({ blocks: [{ body: "Has not played yet." }] });
    expect(readPerson({ name: "Wrenly", games: { works: { place: 1, score: "lots", also: {} } } })).toBeNull();
    expect(readPerson({ code: "no_such_player" })).toBeNull();
  });
});

test("a board reads what Leaf really answers, and nothing from what makes no sense", () => {
  const standings = isRecord(GAME) ? GAME["GET /v1/game/play/{game}/standings"] : null;
  const board = readBoard(isRecord(standings) ? standings.body : null);
  expect(board?.top.map((r) => [r.place, r.name, r.guest, r.score, r.also.story, r.you])).toEqual([
    [1, "Bob", false, 5120, 7, false],
    [2, "Alice", false, 1840, 3, true],
    [3, "Visitor", true, 960, 2, false],
  ]);
  expect(board?.you).toEqual({ place: 2, score: 1840, also: { story: 3 } });
  expect(readBoard({ top: [{ place: 1 }], you: null })).toBeNull();
});
