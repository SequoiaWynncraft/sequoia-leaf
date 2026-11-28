import { describe, expect, test } from "bun:test";

import { Pinned } from "@sequoia-leaf/core/review/pins.ts";
import { Schema } from "effect";

import { Own } from "../src/play/store.ts";

/**
 * Each game's stored standings (`review/.../stored/standing-*.json`, written by the game's writer
 * cases, `@sequoia-leaf/core/review/pins.ts`) read as Leaf reads a standing back off its board's row
 * (`Own`): its score as the score column holds it, and what is shown beside it as the JSON stored.
 */
const GAMES = [
  ["works", new URL("../../../packages/factory/review/golden/", import.meta.url)],
  ["town", new URL("../../../packages/town/review/pins/", import.meta.url)],
  ["pulls", new URL("../../../packages/pulls/review/pins/", import.meta.url)],
] as const;

describe("every game's stored standing", () => {
  const rows = GAMES.flatMap(([game, dir]) =>
    new Pinned(dir).rows("standing").map((r) => [`${game}: ${r.path}`, r.row] as const),
  );
  test("is kept for each game", () => {
    expect(GAMES.map(([game]) => rows.some(([name]) => name.startsWith(`${game}:`)))).toEqual([true, true, true]);
  });
  test.each(rows)("%s reads as the board reads a standing", (_, row) => {
    const stood: { score: unknown; also: unknown } = JSON.parse(row.text);
    // The row as the board's query gives it: a place, the score column, and `also` as stored.
    const read = Schema.decodeUnknownSync(Own)({ place: 1, score: stood.score, also: JSON.stringify(stood.also) });
    const { place, ...standing } = read;
    expect(place).toBe(1);
    expect(row.read).toEqual(standing);
  });
});
