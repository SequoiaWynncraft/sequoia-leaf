/**
 * The ways to play at the table, as the front page offers them: one table of modes, each in a
 * category. The page draws whatever the table holds. A mode whose Set out is not wired yet (`setOut`
 * null) is in the table and not shown, and a category with nothing shown is not shown either.
 *
 * Each mode has a board: rows of a rank, a name and the number that ranks them. `listed` keeps the
 * member's own row in view, under the list when it is below it.
 *
 * The trails play in the table's run in hand; the Wilds and the Deep Woods in its endless run, beside
 * it (`endless.ts` has what they need besides).
 */
import { whole } from "@sequoia-leaf/core";
import type { Board as Standings } from "@sequoia-leaf/kit/person.ts";
import {
  type Almanac,
  ENDLESS,
  type EndlessWay,
  type RaidCommand,
  ROOM_COUNT,
  type RunView,
  TRAIL_COUNT,
  trailCleared,
  trailOpen,
  TRAILS,
  unfought,
  type Week,
} from "@sequoia-leaf/raid";

import type { Glyph } from "../art/icons.ts";
import { type DepthBoard, depthBoard, type Span, WAY_NAMES } from "./endless.ts";

/** What the table is read against: Leaf's copy, and what is chosen on the page. */
export interface At {
  readonly run: RunView | null;
  readonly almanac: Almanac;
  /** The trail chosen: Leaf's pick, or one not open yet that the member is looking at. */
  readonly trail: number;
  /** Whether the member's own figures are chosen. */
  readonly own: boolean;
  /** The guild's raid board as Leaf last gave it (`GET /v1/game/play/raid/standings`), or null before it is read. */
  readonly standings: Standings | null;
  /** The endless run laid out beside the run in hand, if one is. */
  readonly endless: RunView | null;
  /** This week's deepest rooms won in each endless way, as Leaf keeps them. */
  readonly week: Week;
  /** The endless boards as Leaf last gave them (`GET /v1/game/raid/depths/{way}/{span}`), by way and span: `wilds:ever`. */
  readonly depths: ReadonlyMap<string, DepthBoard>;
  /** Which of the Wilds' boards is chosen. */
  readonly span: Span;
  /** The member's record at the live tables (`GET /v1/game/sittings/record`), once read. */
  readonly tables?: TablesRecord | null;
}

/** A member's live tables: finished, won, and finished in the first four. */
export interface TablesRecord {
  readonly played: number;
  readonly won: number;
  readonly four: number;
}

export type CategoryId = "normal" | "endless" | "versus";
export interface Category {
  readonly id: CategoryId;
  readonly name: string;
  readonly icon: Glyph;
}
export const CATEGORIES: readonly Category[] = [
  { id: "normal", name: "Normal", icon: "door" },
  { id: "endless", name: "Endless", icon: "flame" },
  { id: "versus", name: "Versus", icon: "swords" },
];

/** One line of a board: a rank (none for a list of records), a name, and the number that ranks it. */
export interface BoardRow {
  readonly place: number | null;
  readonly name: string;
  readonly value: string;
  /** The member's own row: lit. */
  readonly you: boolean;
}
/** A board: titled with what it ranks; the member's own row, when it is not among the rows. */
export interface Board {
  readonly title: string;
  readonly rows: readonly BoardRow[];
  readonly you: BoardRow | null;
}

export type ModeId = "trails" | "endless" | "deep" | "live";
/** What setting out sends Leaf: a trail's run, or an endless run. */
export type SetOut = Extract<RaidCommand, { do: "start" | "endless" }>;
export interface Mode {
  readonly id: ModeId;
  readonly category: CategoryId;
  readonly name: string;
  /** What the mode is, in one sentence. */
  readonly text: string;
  /** Why the member cannot set out on it now, or null when they can. */
  readonly closed: (at: At) => string | null;
  /** What Set out sends Leaf; null until the mode is wired, and until then the page does not show it. */
  readonly setOut: ((at: At) => SetOut) | null;
  /** The live tables' card (`live/tables.ts`): tables to open and sit at, not Set out. Shown though it has no Set out. */
  readonly tables?: true;
  /** Its run laid out, if one is. */
  readonly run: (at: At) => RunView | null;
  readonly board: (at: At) => Board;
  /** What setting out on it would end besides its own run, said under the button: for an endless way, a run of the other. */
  readonly ends?: (at: At) => string | null;
}

/** Why a trail cannot be set out on yet, or null when it can. */
export const trailClosed = (almanac: Almanac, trail: number): string | null =>
  trailOpen(almanac, trail) ? null : `Clear ${TRAILS[trail - 1]?.name ?? "the one before"} first.`;

/** The member's own records from the almanac: the furthest room on each trail, and how many are cleared. */
export const records = (a: Almanac): Board => ({
  title: "Your records",
  rows: [
    ...TRAILS.map((t, i) => {
      const best = a.best[i] ?? 0;
      return { place: null, name: t.name, value: best > 0 ? `Room ${best}` : "-", you: false };
    }),
    {
      place: null,
      name: "Trails cleared",
      value: `${TRAILS.filter((_, i) => trailCleared(a, i)).length} of ${TRAIL_COUNT}`,
      you: false,
    },
  ],
  you: null,
});

/** The guild's raid board: everyone by bosses beaten, the member's own place under it when they are not among the top. */
export const guildBoard = (s: Standings): Board => ({
  title: "Bosses beaten",
  rows: s.top.map((r) => ({ place: r.place, name: r.name, value: whole(r.score), you: r.you })),
  you: s.you ? { place: s.you.place, name: "You", value: whole(s.you.score), you: true } : null,
});

/** The raid of fifteen rooms on a trail: the mode chosen until the member chooses another. */
export const THE_TRAILS: Mode = {
  id: "trails",
  category: "normal",
  name: "The trails",
  text: `${ROOM_COUNT} rooms on one of ${TRAIL_COUNT} trails, each harder than the one before and paying more.`,
  closed: (at) => trailClosed(at.almanac, at.trail),
  setOut: (at) => (at.own ? { do: "start", trail: at.trail, own: true } : { do: "start", trail: at.trail }),
  run: (at) => (at.run && at.run.stage.phase !== "over" ? at.run : null),
  // The guild's board once Leaf has given one with anybody on it; the member's own records until then.
  board: (at) => (at.standings && at.standings.top.length > 0 ? guildBoard(at.standings) : records(at.almanac)),
};

/** The endless run laid out, if it set out the given way. */
const endlessOn = (at: At, way: EndlessWay): RunView | null => (at.endless?.endless === way ? at.endless : null);
/** The other way's endless run, whose place a new run takes: why not while it has fought no room, and what it ends once it has. */
function otherWay(at: At, way: EndlessWay): { closed: string | null; ends: string | null } {
  const other = at.endless && at.endless.endless !== way ? at.endless : null;
  if (!other?.endless) return { closed: null, ends: null };
  const name = WAY_NAMES[other.endless];
  return unfought(other)
    ? { closed: `Your raid in ${name} has not fought a room yet.`, ends: null }
    : { closed: null, ends: `A new raid ends your raid in ${name}.` };
}
/** An endless way as a mode: its words, setting out on it, its run, and its board (the Wilds' of the span chosen). */
const endlessMode = (id: ModeId, way: EndlessWay, text: string, title: string): Mode => ({
  id,
  category: "endless",
  name: WAY_NAMES[way],
  text,
  closed: (at) => otherWay(at, way).closed,
  setOut: () => ({ do: "endless", way }),
  run: (at) => endlessOn(at, way),
  board: (at) => {
    const span: Span = way === "deep" ? "week" : at.span;
    const own = span === "week" ? at.week.deepest[way] : at.almanac.deepest[way];
    return depthBoard(title, at.depths.get(`${way}:${span}`) ?? null, own);
  },
  ends: (at) => otherWay(at, way).ends,
});

/** The endless run with regulars in every sparring room: how deep a member gets, ever and this week. */
export const THE_WILDS: Mode = endlessMode(
  "endless",
  "wilds",
  "Rooms without end, until your health runs out. Your raid on a trail is kept as it is.",
  "Deepest room",
);
/** The endless run whose sparring rooms from room 16 are held by the members who last won them this week. */
export const THE_DEEP_WOODS: Mode = endlessMode(
  "deep",
  "deep",
  `Rooms without end. From room ${ENDLESS.heldFrom + 1}, each sparring room is held by the last member to win it this week, and you meet their board. Win it, and your board holds it.`,
  "Deepest this week",
);

/** The member's record at the live tables, as the Versus card's board: dashes until Leaf has said. */
export const tablesBoard = (r: TablesRecord | null): Board => ({
  title: "Your tables",
  rows: [
    { place: null, name: "Played", value: r ? whole(r.played) : "-", you: false },
    { place: null, name: "Won", value: r ? whole(r.won) : "-", you: false },
    { place: null, name: "In the first four", value: r ? whole(r.four) : "-", you: false },
  ],
  you: null,
});

/** Eight at one table on Leaf's clock (`live/`), regulars in the empty seats. */
export const LIVE_TABLES: Mode = {
  id: "live",
  category: "versus",
  name: "Live tables",
  text: "Up to 8 at one table, each on their own board. Regulars sit in the empty seats.",
  closed: () => null,
  setOut: null,
  tables: true,
  run: () => null,
  board: (at) => tablesBoard(at.tables ?? null),
};

export const MODES: readonly Mode[] = [THE_TRAILS, THE_WILDS, THE_DEEP_WOODS, LIVE_TABLES];

/** The runs laid out, each with the mode it is of: the run in hand, then the endless run. */
export const laidOut = (at: At): { mode: Mode; run: RunView }[] =>
  MODES.flatMap((mode) => {
    const run = mode.run(at);
    return run ? [{ mode, run }] : [];
  });

/** The modes shown: those the page can set out on, and the live tables. */
export const shownModes = (modes: readonly Mode[]): Mode[] =>
  modes.filter((m) => m.setOut !== null || m.tables === true);
/** The categories shown: those with a mode shown. */
export const shownCategories = (modes: readonly Mode[]): Category[] =>
  CATEGORIES.filter((c) => shownModes(modes).some((m) => m.category === c.id));

/** What a new raid does to the one laid out, said under the button. */
export const ENDS_THE_RUN = "A new raid ends the one you are on.";

/** The foot of a mode's card: its big button, whether "New raid" is beside it, whether they are closed, and the line under them. */
export interface Foot {
  readonly button: "setOut" | "carryOn";
  readonly anew: boolean;
  readonly off: boolean;
  readonly line: string | null;
}
/**
 * Set out; or, with a run of the mode laid out, Carry on, and beside it New raid once the run has
 * fought a room (until then it is the one set out on). Setting out on a mode that is closed is off,
 * and the line says why.
 */
export function footOf(mode: Mode, at: At): Foot {
  const run = mode.run(at);
  const why = mode.closed(at);
  if (!run) return { button: "setOut", anew: false, off: why !== null, line: why ?? mode.ends?.(at) ?? null };
  if (unfought(run)) return { button: "carryOn", anew: false, off: false, line: null };
  return { button: "carryOn", anew: true, off: why !== null, line: why ?? ENDS_THE_RUN };
}

/** The rows a board shows: its first `most`, and the member's own row under them when it is not among them. */
export function listed(board: Board, most: number): { top: readonly BoardRow[]; under: BoardRow | null } {
  const top = board.rows.slice(0, most);
  return { top, under: top.some((r) => r.you) ? null : (board.rows.find((r) => r.you) ?? board.you) };
}
