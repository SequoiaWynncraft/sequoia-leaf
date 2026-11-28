import { describe, expect, test } from "bun:test";

import { Pinned } from "@sequoia-leaf/core/review/pins.ts";
import { Schema } from "effect";

import { StoodAlso } from "../src/play/store.ts";

/**
 * Each game's stored standings (`review/.../stored/standing-*.json`, written by the game's writer
 * cases, `@sequoia-leaf/core/review/pins.ts`) read as Leaf reads a standing back: its score a whole
 * number, and what is shown beside it as the board's own reader takes it from the stored JSON.
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
    expect(Number.isSafeInteger(stood.score)).toBe(true);
    const also = Schema.decodeUnknownSync(StoodAlso)(JSON.stringify(stood.also));
    expect(row.read).toEqual({ score: stood.score, also });
  });
});
