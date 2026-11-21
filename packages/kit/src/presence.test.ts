import { describe, expect, test } from "bun:test";

import { isRecord } from "./net.ts";
import { readPresent } from "./presence.ts";

/** What Leaf's game routes really answer, from the contract its own tests write. */
const GAME: unknown = await Bun.file(new URL("../../../contracts/leaf-game-v1.json", import.meta.url)).json();

describe("who is here", () => {
  test("reads what Leaf really answers", () => {
    const r = isRecord(GAME) ? GAME["PUT /v1/game/presence"] : null;
    expect(readPresent(isRecord(r) ? r.body : null)).toEqual([
      { id: "10000000-0000-0000-0000-000000000001", name: "Alice", place: "town", rank: null },
    ]);
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
    ).toEqual([{ id: "a", name: "Alice", place: "works", rank: "chief" }]);
    expect(readPresent(null)).toEqual([]);
  });
});
