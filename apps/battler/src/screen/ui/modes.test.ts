import { describe, expect, test } from "bun:test";

import { type Almanac, newAlmanac, type RoomRecord, type RunView, startRun } from "@sequoia-leaf/raid";

import {
  type At,
  type Board,
  type BoardRow,
  ENDS_THE_RUN,
  footOf,
  guildBoard,
  listed,
  type Mode,
  MODES,
  records,
  shownCategories,
  shownModes,
  THE_TRAILS,
} from "./modes.ts";

const at = (over: Partial<At> = {}): At => ({
  run: null,
  almanac: newAlmanac(),
  trail: 0,
  own: false,
  standings: null,
  ...over,
});
/** A run laid out, before its first room is fought or (`fought`) after it. */
function laidOut(fought: boolean): RunView {
  const run = startRun(3);
  const won: RoomRecord = { room: 0, kind: "trouble", result: "win", standing: [3, 0], boss: null };
  return { ...run, record: fought ? [won] : [] };
}
/** An almanac with the first trail cleared and room 15 reached on it, and room 4 on the second. */
function walked(): Almanac {
  const a = newAlmanac();
  a.bosses[0] = ["bigcrab"];
  a.best[0] = 15;
  a.best[1] = 4;
  return a;
}

describe("the mode table", () => {
  test("a mode whose Set out is not wired is not shown: today only the trails are", () => {
    expect(MODES.map((m) => m.id)).toEqual(["trails", "endless", "deep", "live"]);
    expect(shownModes(MODES).map((m) => m.id)).toEqual(["trails"]);
  });

  test("a category with nothing shown is not shown", () => {
    expect(shownCategories(MODES).map((c) => c.id)).toEqual(["normal"]);
    const wired: Mode[] = MODES.map((m) => (m.id === "deep" ? { ...m, setOut: THE_TRAILS.setOut } : m));
    expect(shownCategories(wired).map((c) => c.id)).toEqual(["normal", "endless"]);
    expect(shownModes(wired).map((m) => m.id)).toEqual(["trails", "deep"]);
  });

  test("Set out sends the trail chosen, with the member's own figures when they are chosen", () => {
    expect(THE_TRAILS.setOut?.(at({ trail: 0 }))).toEqual({ do: "start", trail: 0 });
    expect(THE_TRAILS.setOut?.(at({ trail: 1, own: true }))).toEqual({ do: "start", trail: 1, own: true });
  });
});

describe("the button a mode shows", () => {
  test("with no run laid out: Set out, and nothing under it", () => {
    expect(footOf(THE_TRAILS, at())).toEqual({ button: "setOut", anew: false, off: false, line: null });
  });

  test("a trail not open yet: Set out closed, and why under it", () => {
    expect(footOf(THE_TRAILS, at({ trail: 1 }))).toEqual({
      button: "setOut",
      anew: false,
      off: true,
      line: "Clear The Easy Way first.",
    });
    expect(footOf(THE_TRAILS, at({ trail: 1, almanac: walked() })).off).toBe(false);
  });

  test("a run laid out that has fought no room: only Carry on, as it is the one set out on", () => {
    expect(footOf(THE_TRAILS, at({ run: laidOut(false) }))).toEqual({
      button: "carryOn",
      anew: false,
      off: false,
      line: null,
    });
  });

  test("a run laid out that has fought a room: Carry on, New raid beside it, and what a new raid ends", () => {
    expect(footOf(THE_TRAILS, at({ run: laidOut(true) }))).toEqual({
      button: "carryOn",
      anew: true,
      off: false,
      line: ENDS_THE_RUN,
    });
    expect(footOf(THE_TRAILS, at({ run: laidOut(true), trail: 2 }))).toMatchObject({ anew: true, off: true });
  });

  test("a mode not wired has no run, and its board ranks nobody yet", () => {
    const endless = MODES.find((m) => m.id === "endless");
    expect(endless?.run(at({ run: laidOut(true) }))).toBeNull();
    expect(endless?.board(at())).toEqual({ title: "Furthest room", rows: [], you: null });
  });
});

const row = (place: number, you = false): BoardRow => ({ place, name: `M${place}`, value: String(100 - place), you });
const board = (rows: BoardRow[], you: BoardRow | null = null): Board => ({ title: "Furthest room", rows, you });

describe("a board", () => {
  test("the member's own row among the first is lit where it is, and not shown again under them", () => {
    const { top, under } = listed(board([row(1), row(2, true), row(3)]), 10);
    expect(top.map((r) => r.you)).toEqual([false, true, false]);
    expect(under).toBeNull();
  });

  test("below the rows listed, the member's own row is shown under them", () => {
    const rows = [row(1), row(2), row(3), row(4, true)];
    expect(listed(board(rows), 3)).toEqual({ top: rows.slice(0, 3), under: row(4, true) });
    const theirs = row(40, true);
    expect(listed(board(rows.slice(0, 3), theirs), 3).under).toEqual(theirs);
  });

  test("a member with no standing has no row under the list", () => {
    expect(listed(board([row(1), row(2)]), 10).under).toBeNull();
  });

  test("the trails' board is the member's own records: the furthest room on each trail, and how many are cleared", () => {
    expect(records(walked())).toEqual({
      title: "Your records",
      rows: [
        { place: null, name: "The Easy Way", value: "Room 15", you: false },
        { place: null, name: "The Brambly Way", value: "Room 4", you: false },
        { place: null, name: "The Long Way Round", value: "-", you: false },
        { place: null, name: "Trails cleared", value: "1 of 3", you: false },
      ],
      you: null,
    });
  });
});

describe("the trails' board", () => {
  test("is the guild's by bosses beaten once Leaf has given one with anybody on it, else the member's own records", () => {
    expect(THE_TRAILS.board(at()).title).toBe("Your records");
    expect(THE_TRAILS.board(at({ standings: { top: [], you: null } })).title).toBe("Your records");
    const standings = {
      top: [
        { place: 1, score: 12, also: {}, id: "a", name: "Fernwick", guest: false, you: false },
        { place: 2, score: 9, also: {}, id: "b", name: "Quillfeather", guest: false, you: true },
      ],
      you: { place: 2, score: 9, also: {} },
    };
    const guild = THE_TRAILS.board(at({ standings }));
    expect(guild.title).toBe("Bosses beaten");
    expect(guild.rows.map((r) => [r.place, r.name, r.value, r.you])).toEqual([
      [1, "Fernwick", "12", false],
      [2, "Quillfeather", "9", true],
    ]);
    expect(guildBoard({ top: [], you: { place: 40, score: 1, also: {} } }).you).toEqual({
      place: 40,
      name: "You",
      value: "1",
      you: true,
    });
  });
});
