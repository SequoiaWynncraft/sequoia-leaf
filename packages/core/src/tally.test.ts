import { describe, expect, it } from "bun:test";

import { LOGGED } from "./logged.ts";
import {
  ACT_EVERY_MS,
  rankTally,
  scoreOf,
  talliedActs,
  talliedFrom,
  TALLY_BOARDS,
  TALLY_GROUPS,
  tallyBoard,
  tallyPath,
} from "./tally.ts";

describe("the Tally's boards", () => {
  it("each have an id of their own, a group, a name and one line saying what they count", () => {
    expect(new Set(TALLY_BOARDS.map((b) => b.id)).size).toBe(TALLY_BOARDS.length);
    for (const b of TALLY_BOARDS) {
      expect(TALLY_GROUPS).toContain(b.group);
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.counts).toMatch(/^[A-Z].*\.$/);
    }
  });

  it("are listed group by group, in the groups' order", () => {
    const groups = TALLY_BOARDS.map((b) => TALLY_GROUPS.indexOf(b.group));
    expect(groups).toEqual(groups.toSorted((a, b) => a - b));
  });

  it("are found by id, and are read at a path for each span", () => {
    expect(tallyBoard("raids")?.name).toBe("Guild raids");
    expect(tallyBoard("raid-nol")?.name).toBe("Orphion's Nexus of Light");
    expect(tallyBoard("pulls")).toBeUndefined();
    expect(tallyPath("raid-nol", "week")).toBe("/v1/game/tally/raid-nol/week");
  });

  it("count nothing Leaf or Coins can buy", () => {
    const words = TALLY_BOARDS.map((b) => `${b.name} ${b.counts}`.toLowerCase()).join(" ");
    for (const bought of ["pull", "spent", "balance", "bought", "set out", "pieces"]) {
      expect(words).not.toContain(bought);
    }
  });
});

describe("what the games log", () => {
  it("adds to the counter of each thing the Tally counts, and to nothing else", () => {
    expect(
      talliedFrom([
        { kind: LOGGED.raidStarted, data: { trail: 0 } },
        { kind: LOGGED.raidRoom, data: { won: true } },
        { kind: LOGGED.raidRoom, data: { won: false } },
        { kind: LOGGED.raidEnded, data: { ended: "lost" } },
        { kind: LOGGED.raidEnded, data: { ended: "won" } },
        { kind: LOGGED.worksOrder, data: { order: 3 } },
        { kind: LOGGED.worksPlot, data: { price: 40 } },
        { kind: LOGGED.townCrab, data: {} },
        { kind: LOGGED.townGreeted, data: { by: "pipwick" } },
        { kind: LOGGED.townBought, data: { price: 8 } },
      ]),
    ).toEqual(["raid_rooms", "raid_rooms", "raid_wins", "works_orders", "crab", "greeted"]);
  });
});

describe("an act in a live room", () => {
  it("counts a wave, and a touch on anything, with a log on the fire and the roll besides", () => {
    expect(talliedActs("emote", "wave")).toEqual(["waves"]);
    expect(talliedActs("emote", "cheer")).toEqual([]);
    expect(talliedActs("touch", "post:174,100")).toEqual(["taps"]);
    expect(talliedActs("touch", "fire:256,211")).toEqual(["taps", "logs"]);
    expect(talliedActs("touch", "roll")).toEqual(["taps", "rolls"]);
    expect(talliedActs("dance", "fire")).toEqual([]);
  });

  it("counts one at a time for each counter, far apart enough that a script gains nothing in a minute", () => {
    for (const ms of Object.values(ACT_EVERY_MS)) expect(ms).toBeGreaterThanOrEqual(5_000);
  });
});

describe("a board's places", () => {
  it("go highest first, a tie sharing a place, and whoever reached it first going first within it", () => {
    const ranked = rankTally("count", [
      { playerId: "a", value: 4, at: 30 },
      { playerId: "b", value: 9, at: 50 },
      { playerId: "c", value: 4, at: 10 },
      { playerId: "d", value: 0, at: 5 },
      { playerId: "e", value: 1, at: 5 },
    ]);
    expect(ranked).toEqual([
      { playerId: "b", place: 1, score: 9 },
      { playerId: "c", place: 2, score: 4 },
      { playerId: "a", place: 2, score: 4 },
      { playerId: "e", place: 4, score: 1 },
    ]);
  });

  it("are by level for XP, more XP first within a level, and by whole seconds for a time", () => {
    expect([scoreOf("level", 0), scoreOf("level", 999), scoreOf("level", 1000)]).toEqual([0, 1, 2]);
    expect(scoreOf("time", 59_999)).toBe(59);
    expect(
      rankTally("level", [
        { playerId: "a", value: 1100, at: 1 },
        { playerId: "b", value: 1900, at: 2 },
        { playerId: "c", value: 300, at: 0 },
      ]),
    ).toEqual([
      { playerId: "b", place: 1, score: 2 },
      { playerId: "a", place: 1, score: 2 },
      { playerId: "c", place: 3, score: 1 },
    ]);
    expect(rankTally("time", [{ playerId: "a", value: 900, at: 1 }])).toEqual([]);
  });
});
