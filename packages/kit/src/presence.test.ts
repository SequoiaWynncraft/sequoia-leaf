import { describe, expect, test } from "bun:test";

import { isRecord } from "./net.ts";
import { readPresent, readResting } from "./presence.ts";

/** What Leaf's game routes really answer, from the contract its own tests write. */
const GAME: unknown = await Bun.file(new URL("../../../contracts/leaf-game-v1.json", import.meta.url)).json();

describe("who is here", () => {
  test("reads what Leaf really answers: who is here, and who is resting", () => {
    const r = isRecord(GAME) ? GAME["PUT /v1/game/presence"] : null;
    expect(readPresent(isRecord(r) ? r.body : null)).toEqual([
      { id: "10000000-0000-0000-0000-000000000001", name: "Alice", place: "town", rank: null, guest: false },
      { id: "10000000-0000-0000-0000-000000000003", name: "Visitor", place: "town", rank: null, guest: true },
    ]);
    expect(readResting(isRecord(r) ? r.body : null)).toEqual([
      {
        id: "10000000-0000-0000-0000-000000000002",
        name: "Bob",
        place: "works",
        seen: Date.UTC(2026, 10, 25, 12, 40),
        guest: false,
      },
    ]);
  });

  test("leaves out anybody resting who makes no sense", () => {
    expect(
      readResting({
        resting: [
          { id: "a", username: "Alice", place: "table", seen_at: "2026-11-25T10:00:00.000Z" },
          { id: "b", username: "Bob", place: "town", seen_at: "yesterday-ish" },
          { id: "c", username: "Cleo", place: "the moon", seen_at: "2026-11-25T10:00:00.000Z" },
          { id: "d", username: "Dan", place: "town" },
        ],
      }),
    ).toEqual([{ id: "a", name: "Alice", place: "table", seen: Date.UTC(2026, 10, 25, 10), guest: false }]);
    expect(readResting({ present: [] })).toEqual([]);
  });

  test("leaves out anybody who makes no sense", () => {
    expect(
      readPresent({
        present: [
          { id: "a", username: "Alice", place: "works", rank: "chief" },
          { id: "b", username: "Bob", place: "the moon" },
          { id: 3, username: "Cleo", place: "town" },
          "nobody",
        ],
      }),
    ).toEqual([{ id: "a", name: "Alice", place: "works", rank: "chief", guest: false }]);
    expect(readPresent(null)).toEqual([]);
  });
});
