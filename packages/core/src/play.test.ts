import { describe, expect, it } from "bun:test";

import { COMMAND_ID, GAME_IDS, gameId, isRefused, playPath } from "./play.ts";

describe("the games Leaf plays", () => {
  it("are the raid, the Works and the town, known by name and nothing else", () => {
    expect(GAME_IDS).toEqual(["raid", "works", "town"]);
    expect(gameId("raid")).toBe("raid");
    expect(gameId("Raid")).toBeUndefined();
    expect(gameId("saves")).toBeUndefined();
    expect(playPath("raid")).toBe("/v1/game/play/raid");
  });

  it("tells a refusal from a command done", () => {
    expect(isRefused({ refused: "not_enough_acorns" })).toBe(true);
    expect(isRefused({ state: 1, notes: [] })).toBe(false);
  });

  it("takes a short id of plain characters for a command", () => {
    expect(COMMAND_ID.test("c-1700000000000-12")).toBe(true);
    expect(COMMAND_ID.test("")).toBe(false);
    expect(COMMAND_ID.test("a".repeat(65))).toBe(false);
    expect(COMMAND_ID.test("no spaces")).toBe(false);
  });
});
