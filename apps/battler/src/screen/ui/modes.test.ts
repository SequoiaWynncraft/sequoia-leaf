import { describe, expect, test } from "bun:test";

import {
  type Almanac,
  type EndlessWay,
  LEGACY_ERA,
  newAlmanac,
  type RoomRecord,
  type RunView,
  startOf,
  startRun,
  wayOn,
} from "@sequoia-leaf/raid";

import { endlessWhere } from "./endless.ts";
import {
  type At,
  type Board,
  type BoardRow,
  ENDS_THE_RUN,
  footOf,
  guildBoard,
  laidOut as runsLaidOut,
  listed,
  LIVE_TABLES,
  type Mode,
  MODES,
  records,
  shownCategories,
  shownModes,
  tablesBoard,
  THE_DEEP_WOODS,
  THE_TRAILS,
  THE_WILDS,
} from "./modes.ts";

const at = (over: Partial<At> = {}): At => ({
  run: null,
  endless: null,
  almanac: newAlmanac(),
  trail: 0,
  own: false,
  standings: null,
  week: { at: 0, deepest: { wilds: 0, deep: 0 } },
  apart: { deepest: { wilds: 0, deep: 0 }, week: { at: 0, deepest: { wilds: 0, deep: 0 } } },
  depths: new Map(),
  span: "ever",
  ...over,
});
/** What a mode's Set out sends Leaf off the wire, at a moment of the page. */
const sent = (mode: Mode, here: At): ReturnType<typeof startOf> | null => {
  const way = mode.setOut?.(here);
  return way ? startOf(way) : null;
};
const WON: RoomRecord = { room: 0, kind: "trouble", result: "win", standing: [3, 0], boss: null };
/** A run laid out, before its first room is fought or (`fought`) after it. */
function laidOut(fought: boolean): RunView {
  const run = startRun(3, { era: LEGACY_ERA });
  return { ...run, record: fought ? [WON] : [] };
}
/** An endless run laid out one way, in a room (from 0), having fought its rooms before it or (`room` 0) none. */
function endless(way: EndlessWay, room = 0): RunView {
  const run = startRun(3, { era: LEGACY_ERA, way: wayOn({ id: way }) });
  return { ...run, room, record: Array.from({ length: room }, (_, i) => ({ ...WON, room: i })) };
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
  test("every mode is shown: the trails, the Wilds and the Deep Woods, and the live tables with no Set out of their own", () => {
    expect(MODES.map((m) => m.id)).toEqual(["trails", "endless", "deep", "live"]);
    expect(shownModes(MODES).map((m) => m.name)).toEqual(["The trails", "The Wilds", "The Deep Woods", "Live tables"]);
  });

  test("a category with nothing shown is not shown", () => {
    expect(shownCategories(MODES).map((c) => c.id)).toEqual(["normal", "endless", "versus"]);
    const wired: Mode[] = MODES.filter((m) => m.category !== "endless");
    expect(shownCategories(wired).map((c) => c.id)).toEqual(["normal", "versus"]);
  });

  test("Set out sends the trail chosen, with the member's own figures when they are chosen", () => {
    expect(sent(THE_TRAILS, at({ trail: 0 }))).toEqual({ do: "start", trail: 0 });
    expect(sent(THE_TRAILS, at({ trail: 1, own: true }))).toEqual({ do: "start", trail: 1, own: true });
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
});

describe("the endless ways", () => {
  test("Set out sends an endless run of the way, whatever trail is chosen, with the figures chosen", () => {
    expect(sent(THE_WILDS, at({ trail: 2 }))).toEqual({ do: "start", course: "wilds" });
    expect(sent(THE_WILDS, at({ trail: 2, own: true }))).toEqual({ do: "start", course: "wilds", own: true });
    expect(sent(THE_DEEP_WOODS, at())).toEqual({ do: "start", course: "deep" });
    expect(sent(THE_DEEP_WOODS, at({ own: true }))).toEqual({ do: "start", course: "deep", own: true });
  });

  test("with the member's own figures chosen, the board is theirs: headed so, Leaf's board of them, the member's deepest kept apart", () => {
    const fair = { top: [{ place: 1, name: "Fernwick", room: 31, you: false }], you: null };
    const own = { top: [{ place: 1, name: "Quillfeather", room: 19, you: false }], you: null };
    const depths = new Map([
      ["wilds:ever", fair],
      ["own.wilds:ever", own],
      ["deep:week", fair],
      ["own.deep:week", own],
    ]);
    const apart = { deepest: { wilds: 12, deep: 9 }, week: { at: 0, deepest: { wilds: 7, deep: 4 } } };
    const almanac = newAlmanac();
    almanac.deepest = { wilds: 30, deep: 20 };
    const mine = at({ own: true, depths, apart, almanac });
    expect(THE_WILDS.board(mine)).toEqual({
      title: "Deepest room",
      figures: "Your figures",
      rows: [{ place: 1, name: "Quillfeather", value: "Room 19", you: false }],
      you: { place: null, name: "You", value: "Room 12", you: true },
    });
    expect(THE_DEEP_WOODS.board(mine)).toMatchObject({
      title: "Deepest this week",
      figures: "Your figures",
      you: { value: "Room 4" },
    });
    expect(THE_WILDS.board({ ...mine, own: false })).toMatchObject({
      title: "Deepest room",
      figures: "All figures",
      rows: [{ name: "Fernwick" }],
      you: { value: "Room 30" },
    });
  });

  test("each has the endless run as its run when it set out that way, and the trails keep the run in hand", () => {
    const deep = endless("deep", 3);
    const both = at({ run: laidOut(true), endless: deep });
    expect(THE_DEEP_WOODS.run(both)).toBe(deep);
    expect(THE_WILDS.run(both)).toBeNull();
    expect(THE_TRAILS.run(both)).toBe(both.run);
    expect(footOf(THE_DEEP_WOODS, both)).toEqual({ button: "carryOn", anew: true, off: false, line: ENDS_THE_RUN });
  });

  test("setting out one way while a run of the other is laid out: not before it has fought a room, and then it says what it ends", () => {
    expect(footOf(THE_WILDS, at({ endless: endless("deep") }))).toEqual({
      button: "setOut",
      anew: false,
      off: true,
      line: "Your raid in The Deep Woods has not fought a room yet.",
    });
    expect(footOf(THE_WILDS, at({ endless: endless("deep", 2) }))).toEqual({
      button: "setOut",
      anew: false,
      off: false,
      line: "A new raid ends your raid in The Deep Woods.",
    });
    // The run in hand is never touched by an endless run, nor the endless run by a trail's.
    expect(footOf(THE_WILDS, at({ run: laidOut(true) })).line).toBeNull();
    expect(footOf(THE_TRAILS, at({ endless: endless("wilds", 2) })).line).toBeNull();
  });

  test("their boards are Leaf's, the member's own lit and under the list; until Leaf gives one, the member's own deepest", () => {
    const board = {
      top: [
        { place: 1, name: "Fernwick", room: 31, you: false },
        { place: 2, name: "Quillfeather", room: 23, you: true },
      ],
      you: { place: 2, room: 23 },
    };
    const shown = THE_WILDS.board(at({ depths: new Map([["wilds:ever", board]]) }));
    expect(shown.title).toBe("Deepest room");
    expect(shown.rows.map((r) => [r.place, r.name, r.value, r.you])).toEqual([
      [1, "Fernwick", "Room 31", false],
      [2, "Quillfeather", "Room 23", true],
    ]);
    expect(listed(shown, 1).under).toEqual({ place: 2, name: "Quillfeather", value: "Room 23", you: true });
    // This week's board is another, and before Leaf has given it, the week's deepest the table keeps.
    const week = at({
      depths: new Map([["wilds:ever", board]]),
      span: "week",
      week: { at: 0, deepest: { wilds: 18, deep: 0 } },
    });
    expect(THE_WILDS.board(week)).toEqual({
      title: "Deepest room",
      figures: "All figures",
      rows: [],
      you: { place: null, name: "You", value: "Room 18", you: true },
    });
    // The Deep Woods' board is this week's, whichever of the Wilds' is chosen.
    const deep = THE_DEEP_WOODS.board(at({ depths: new Map([["deep:week", board]]), span: "ever" }));
    expect([deep.title, deep.rows.length]).toEqual(["Deepest this week", 2]);
    expect(THE_DEEP_WOODS.board(at())).toEqual({
      title: "Deepest this week",
      figures: "All figures",
      rows: [],
      you: null,
    });
  });
});

describe("the strip along the top", () => {
  test("both runs laid out are on it, each with its mode: the run in hand, then the endless run", () => {
    const deep = endless("deep", 22);
    const both = runsLaidOut(at({ run: laidOut(true), endless: deep }));
    expect(both.map(({ mode, run }) => [mode.name, run.way.course.id])).toEqual([
      ["The trails", "trail"],
      ["The Deep Woods", "deep"],
    ]);
    expect(endlessWhere(deep)).toBe(`Room 23. Health ${deep.resolve}.`);
    expect(runsLaidOut(at({ endless: endless("wilds") })).map(({ mode }) => mode.name)).toEqual(["The Wilds"]);
    expect(runsLaidOut(at())).toEqual([]);
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

describe("the live tables (Versus)", () => {
  test("are in Versus, shown with no Set out of their own, and set out on nothing of the solo table's", () => {
    expect(LIVE_TABLES.category).toBe("versus");
    expect(LIVE_TABLES.setOut).toBeNull();
    expect(shownModes([LIVE_TABLES])).toEqual([LIVE_TABLES]);
    expect(LIVE_TABLES.run(at({ run: laidOut(true) }))).toBeNull();
  });

  test("their board is the member's record: played, won, in the first four; dashes until Leaf has said", () => {
    expect(LIVE_TABLES.board(at())).toEqual(tablesBoard(null));
    expect(tablesBoard(null).rows.map((r) => [r.name, r.value])).toEqual([
      ["Played", "-"],
      ["Won", "-"],
      ["In the first four", "-"],
    ]);
    const record = LIVE_TABLES.board(at({ tables: { played: 1204, won: 3, four: 41 } }));
    expect(record.title).toBe("Your tables");
    expect(record.rows.map((r) => r.value)).toEqual(["1,204", "3", "41"]);
  });
});
