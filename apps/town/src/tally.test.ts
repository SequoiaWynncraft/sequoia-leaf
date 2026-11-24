import { describe, expect, jest, test } from "bun:test";

import { isRecord } from "@sequoia-leaf/kit/net.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";

import { laidOut, readBoard, rising, scoreText } from "./tally.ts";

const GAME: unknown = await Bun.file(new URL("../../../contracts/leaf-game-v1.json", import.meta.url)).json();
const answer = (name: string): unknown => (isRecord(GAME) && isRecord(GAME[name]) ? GAME[name].body : null);
/** Somebody at a place on a board. */
const row = (place: number, you = false) => ({
  place,
  id: `p${place}`,
  name: `P${place}`,
  guest: false,
  score: 20 - place,
  you,
});

describe("a board of the Tally", () => {
  test("reads as Leaf sends it, for the week and for all time", () => {
    const week = readBoard(answer("GET /v1/game/tally/{board}/{period}"));
    expect(week?.period).toBe("week");
    expect(week?.from).toBe("2026-11-23T00:00:00.000Z");
    expect(week?.top.map((r) => [r.place, r.name, r.score, r.you])).toEqual([
      [1, "Alice", 9, true],
      [2, "Bob", 2, false],
    ]);
    const all = readBoard(answer("GET /v1/game/tally/{board}/{period}, all time"));
    expect(all).toMatchObject({ board: "level", period: "all", from: null, you: { place: 1, score: 13 } });
  });

  test("is nothing when it makes no sense", () => {
    expect(readBoard(answer("GET /v1/game/tally/{board}/{period}, no such board"))).toBeNull();
    expect(readBoard({ board: "raids", period: "day", from: null, top: [], you: null })).toBeNull();
    expect(readBoard({ board: "raids", period: "all", from: null, top: [{ place: 1 }], you: null })).toBeNull();
  });

  test("writes its score as its kind of number", () => {
    expect(scoreText("count", 12_480)).toBe("12,480");
    expect(scoreText("leaf", 3000)).toBe("3,000");
    expect(scoreText("time", 3 * 3600 + 20 * 60)).toBe("3 h 20 min");
    expect(scoreText("level", 14)).toBe("Level 14");
  });

  test("puts three on the podium, the rest under it, and the member's place at the foot only when off the top", () => {
    const top = [row(1), row(2), row(2), row(4), row(5)];
    const off = laidOut({ board: "raids", period: "all", from: null, top, you: { place: 14, score: 2 } });
    expect(off.podium.map((r) => r.place)).toEqual([1, 2, 2]);
    expect(off.rest.map((r) => r.place)).toEqual([4, 5]);
    expect(off.own).toEqual({ place: 14, score: 2 });
    const on = laidOut({
      board: "raids",
      period: "all",
      from: null,
      top: [row(1), row(2, true)],
      you: { place: 2, score: 18 },
    });
    expect(on.own).toBeNull();
    expect(on.rest).toEqual([]);
  });
});

describe("a board rising", () => {
  test("sounds its notes while it stays, and none once another board is drawn in its place or the panel shuts", () => {
    jest.useFakeTimers();
    try {
      const life = scope();
      const heard: string[] = [];
      const podium = rising(life);
      const note = (word: string) => () => void heard.push(word);
      podium.rise([
        [140, note("third")],
        [300, note("second")],
        [480, note("first")],
      ]);
      jest.advanceTimersByTime(200);
      // Another board is chosen before the first one's second and first have landed.
      podium.rise([[480, note("other first")]]);
      jest.advanceTimersByTime(1000);
      expect(heard).toEqual(["third", "other first"]);
      podium.rise([[140, note("again")]]);
      podium.still();
      podium.rise([[140, note("last")]]);
      life.close();
      jest.advanceTimersByTime(1000);
      expect(heard).toEqual(["third", "other first"]);
    } finally {
      jest.useRealTimers();
    }
  });
});
