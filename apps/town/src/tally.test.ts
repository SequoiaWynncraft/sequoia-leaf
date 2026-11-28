import { describe, expect, jest, test } from "bun:test";

import type { TallyBoard } from "@sequoia-leaf/core";
import { isRecord } from "@sequoia-leaf/kit/net.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";

import { gameContract } from "../../../contracts/game.ts";
import {
  type Answer,
  type Board,
  laidOut,
  readBoard,
  scoreText,
  tallyBoards,
  type TallyPage,
  weeklyReset,
} from "./tally.ts";

const GAME: unknown = gameContract();
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

const RAIDS: TallyBoard = { id: "raids", group: "guild", name: "Guild raids", unit: "count", week: true };
const LEVEL: TallyBoard = { id: "level", group: "guild", name: "SEQ level", unit: "level", week: false };
const boardOf = (id: string): Board => ({ board: id, period: "all", from: null, top: [row(1)], you: null });

/** The panel's boards over a page that writes down what it draws and the notes it plays, and holds each ask until answered. */
function panel() {
  const life = scope();
  const drawn: string[] = [];
  const heard: string[] = [];
  const waiting = new Map<string, (b: Board | null) => void>();
  const page: TallyPage = {
    ask: (path) => new Promise((resolve) => waiting.set(path, resolve)),
    draw(shown) {
      drawn.push(shown.at === "board" ? `${shown.of.id}${shown.rise ? " rising" : ""}` : `${shown.of.id} ${shown.at}`);
      if (shown.at !== "board" || !shown.rise) return [];
      return [
        [140, () => heard.push(`${shown.of.id} third`)],
        [480, () => heard.push(`${shown.of.id} first`)],
      ];
    },
  };
  /** Leaf replies to what was asked at a path. */
  const reply = async (path: string, b: Board | null): Promise<void> => {
    waiting.get(path)?.(b);
    waiting.delete(path);
    await Promise.resolve();
  };
  return { life, drawn, heard, waiting, reply, boards: tallyBoards(life, new Map<string, Answer>(), page) };
}

describe("the board the panel shows", () => {
  test("a panel shut while Leaf is asked, and opened again, draws the board when its own answer comes", async () => {
    const answers = new Map<string, Answer>();
    const drawn: string[] = [];
    const asked: ((b: Board | null) => void)[] = [];
    const page: TallyPage = {
      ask: () => new Promise((resolve) => asked.push(resolve)),
      draw(shown) {
        drawn.push(`${shown.of.id} ${shown.at}`);
        return [];
      },
    };
    const shut = scope();
    tallyBoards(shut, answers, page).show(RAIDS, "week");
    shut.close();
    tallyBoards(scope(), answers, page).show(RAIDS, "week");
    // Leaf answers both, the shut panel's first, with the same board.
    const [shutAsked, openAsked] = asked;
    shutAsked?.(boardOf("raids"));
    await Promise.resolve();
    openAsked?.(boardOf("raids"));
    await Promise.resolve();
    expect(asked).toHaveLength(2);
    expect(drawn).toEqual(["raids asking", "raids asking", "raids board"]);
  });

  test("another board chosen shows as asked at once, and the one before plays and draws nothing more", async () => {
    jest.useFakeTimers();
    try {
      const { drawn, heard, waiting, reply, boards } = panel();
      boards.show(RAIDS, "week");
      expect(drawn).toEqual(["raids asking"]);
      await reply("/v1/game/tally/raids/week", boardOf("raids"));
      jest.advanceTimersByTime(200);
      expect([drawn, heard]).toEqual([["raids asking", "raids rising"], ["raids third"]]);
      // The Level board is chosen before the raids' first place has landed, and Leaf takes its time.
      boards.show(LEVEL, "all");
      expect(drawn.at(-1)).toBe("level asking");
      jest.advanceTimersByTime(1000);
      expect(heard).toEqual(["raids third"]);
      // Back to the raids while the Level is still asked for: kept, so shown at once, rising again.
      boards.show(RAIDS, "week");
      await reply("/v1/game/tally/level/all", boardOf("level"));
      jest.advanceTimersByTime(1000);
      expect(drawn.slice(2)).toEqual(["level asking", "raids rising"]);
      expect(heard).toEqual(["raids third", "raids third", "raids first"]);
      expect([...waiting.keys()]).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a board Leaf cannot read offers to ask again, shown as asked at once; the panel shut stops its notes", async () => {
    jest.useFakeTimers();
    try {
      const life = scope();
      const drawn: string[] = [];
      const heard: string[] = [];
      const offers: (() => void)[] = [];
      const boards = tallyBoards(life, new Map(), {
        ask: async (path) => (path.includes("level") ? null : boardOf("raids")),
        draw(shown) {
          drawn.push(`${shown.of.id} ${shown.at}`);
          if (shown.at === "unread") offers.push(shown.again);
          return shown.at === "board" ? [[140, () => heard.push("note")]] : [];
        },
      });
      boards.show(LEVEL, "all");
      await Promise.resolve();
      offers[0]?.();
      await Promise.resolve();
      boards.show(RAIDS, "week");
      await Promise.resolve();
      life.close();
      jest.advanceTimersByTime(1000);
      boards.redraw();
      expect(drawn).toEqual([
        "level asking",
        "level unread",
        "level asking",
        "level unread",
        "raids asking",
        "raids board",
      ]);
      expect(heard).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("the week of a board", () => {
  test("starts again on Monday at midnight UTC, told in the reader's own time", () => {
    // A Tuesday afternoon, UTC.
    const now = Date.UTC(2026, 10, 24, 15, 0);
    expect(weeklyReset(now, "UTC")).toBe("Weekly reset: Monday at 00:00");
    expect(weeklyReset(now, "Europe/Stockholm")).toBe("Weekly reset: Monday at 01:00");
    expect(weeklyReset(now, "America/New_York")).toBe("Weekly reset: Sunday at 19:00");
    expect(weeklyReset(now, "Asia/Kolkata")).toBe("Weekly reset: Monday at 05:30");
  });
});
