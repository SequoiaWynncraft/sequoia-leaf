/**
 * The ways to play at the table, as the front page offers them: one table of modes, each in a
 * category. The page draws whatever the table holds. A mode whose Set out is not wired yet (`setOut`
 * null) is in the table and not shown, and a category with nothing shown is not shown either.
 *
 * Each mode has a board: rows of a rank, a name and the number that ranks them. `listed` keeps the
 * member's own row in view, under the list when it is below it.
 */
import { whole } from "@sequoia-leaf/core";
import type { Board as Standings } from "@sequoia-leaf/kit/person.ts";
import {
  type Almanac,
  type RaidCommand,
  ROOM_COUNT,
  type RunView,
  TRAIL_COUNT,
  trailCleared,
  trailOpen,
  TRAILS,
  unfought,
} from "@sequoia-leaf/raid";

import type { Glyph } from "../art/icons.ts";

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
export interface Mode {
  readonly id: ModeId;
  readonly category: CategoryId;
  readonly name: string;
  /** What the mode is, in one sentence. */
  readonly text: string;
  /** Why the member cannot set out on it now, or null when they can. */
  readonly closed: (at: At) => string | null;
  /** What Set out sends Leaf; null until the mode is wired, and until then the page does not show it. */
  readonly setOut: ((at: At) => Extract<RaidCommand, { do: "start" }>) | null;
  /** Its run laid out, if one is. */
  readonly run: (at: At) => RunView | null;
  readonly board: (at: At) => Board;
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

/** A mode the page cannot set out on yet: its words and what its board will rank, and nothing else. */
const later = (m: Pick<Mode, "id" | "category" | "name" | "text">, ranks: string): Mode => ({
  ...m,
  closed: () => null,
  setOut: null,
  run: () => null,
  board: () => ({ title: ranks, rows: [], you: null }),
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

export const MODES: readonly Mode[] = [
  THE_TRAILS,
  later(
    {
      id: "endless",
      category: "endless",
      name: "Endless",
      text: "Rooms without end, alone, until your health runs out.",
    },
    "Furthest room",
  ),
  later(
    {
      id: "deep",
      category: "endless",
      name: "The Deep Woods",
      text: "Rooms held by guildmates' boards, new each week. See how deep you get.",
    },
    "Deepest this week",
  ),
  later(
    { id: "live", category: "versus", name: "Live tables", text: "8 members at one table, against each other." },
    "Tables won",
  ),
];

/** The modes shown: those the page can set out on. */
export const shownModes = (modes: readonly Mode[]): Mode[] => modes.filter((m) => m.setOut !== null);
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
  if (!run) return { button: "setOut", anew: false, off: why !== null, line: why };
  if (unfought(run)) return { button: "carryOn", anew: false, off: false, line: null };
  return { button: "carryOn", anew: true, off: why !== null, line: why ?? ENDS_THE_RUN };
}

/** The rows a board shows: its first `most`, and the member's own row under them when it is not among them. */
export function listed(board: Board, most: number): { top: readonly BoardRow[]; under: BoardRow | null } {
  const top = board.rows.slice(0, most);
  return { top, under: top.some((r) => r.you) ? null : (board.rows.find((r) => r.you) ?? board.you) };
}
