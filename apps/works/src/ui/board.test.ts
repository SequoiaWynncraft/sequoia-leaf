import { expect, test } from "bun:test";

import { isRecord } from "@sequoia-leaf/kit/net.ts";

import { readBoard } from "./board.ts";

const GAME: unknown = await Bun.file(new URL("../../../../contracts/leaf-game-v1.json", import.meta.url)).json();

test("the board reads what Leaf really answers, and nothing from what makes no sense", () => {
  const answer = isRecord(GAME) ? GAME["GET /v1/game/play/{game}/standings"] : null;
  const board = readBoard(isRecord(answer) ? answer.body : null);
  expect(board?.top.map((r) => [r.place, r.name, r.guest, r.score, r.story, r.you])).toEqual([
    [1, "Bob", false, 5120, 7, false],
    [2, "Alice", false, 1840, 3, true],
    [3, "Visitor", true, 960, 2, false],
  ]);
  expect(board?.you).toEqual({ place: 2, score: 1840, story: 3 });
  expect(readBoard({ top: [{ place: 1 }], you: null })).toBeNull();
});
