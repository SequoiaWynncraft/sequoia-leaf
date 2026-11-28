/**
 * How deep the endless runs go, as the table keeps it: the deepest room won in each way, ever (the
 * almanac's `deepest`) and this week (the table's `Week`), and apart from them the same with the
 * member's own figures (`Apart`); what a won room leaves with Leaf (`Done.keep`) for the boards and,
 * in the Deep Woods, to hold the room, each in its way's lanes (`lanes`); and what an endless run is
 * paid for. A week starts on Monday at 00:00 UTC, on Leaf's clock.
 */
import { type Kept, utcWeekStart } from "@sequoia-leaf/core";

import { ENDLESS_WAYS, type EndlessWay, isEndlessWay } from "./content/endless.ts";
import { isHeld } from "./endless.ts";
import { keptBoard } from "./foe.ts";
import { type Recorded, totalsOf } from "./record.ts";
import type { Fought, Run, RunSummary } from "./run.ts";
import { counts, courseOf, lanes } from "./way.ts";

/** The deepest room won in each endless way, counting from 1; 0 for none. */
export type Depths = Record<EndlessWay, number>;
export const noDepths = (): Depths => ({ wilds: 0, deep: 0 });

/** The deepest rooms won this week, and the week: the moment it started. */
export interface Week {
  at: number;
  deepest: Depths;
}

/** The week as it stands at `now`: as kept while it is still that week, and with nothing won once a new one starts. */
export function weekAt(week: Week, now: number): Week {
  const at = utcWeekStart(now);
  return week.at >= at ? week : { at, deepest: noDepths() };
}

const whole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const field = (v: unknown, key: string): unknown =>
  typeof v === "object" && v !== null ? Object.entries(v).find(([k]) => k === key)?.[1] : undefined;
/** Depths from plain data. What does not read (or was kept before there were endless runs) is none. */
export function readDepths(v: unknown): Depths {
  const out = noDepths();
  for (const way of ENDLESS_WAYS) {
    const room = field(v, way);
    if (whole(room)) out[way] = room;
  }
  return out;
}
/** A week from plain data. What does not read (or was kept before there were endless runs) is a week long gone. */
export function readWeek(v: unknown): Week {
  const at = field(v, "at");
  return { at: whole(at) ? at : 0, deepest: readDepths(field(v, "deepest")) };
}

/** The deepest rooms won with the member's own figures, kept apart from everyone's figures': ever, and this week. */
export interface Apart {
  deepest: Depths;
  week: Week;
}
export const noApart = (): Apart => ({ deepest: noDepths(), week: readWeek(undefined) });
/** What is kept apart, from plain data. What does not read (or was kept before anything was) is none. */
export const readApart = (v: unknown): Apart => ({
  deepest: readDepths(field(v, "deepest")),
  week: readWeek(field(v, "week")),
});

/** A depth as it is left for a board. */
export interface Deepest {
  room: number;
}

/**
 * What an endless run's fight leaves, once decided: nothing unless it is won. A room won deeper
 * than ever or than this week (in `ever` and `week`: the record of the run's pool) is written into
 * them, and left for that board; a room held (`isHeld`) is held by the board that won it. Each is
 * left in the run's way's lanes (`lanes`). A guest's deepest are written down, and nothing is left.
 */
export function reached(
  s: { readonly ever: Depths; readonly week: Week },
  run: Pick<Run, "room" | "way">,
  { setup, outcome }: Fought,
  guest: boolean,
): Kept[] {
  const course = run.way.course.id;
  if (!counts(run.way).deepest || !isEndlessWay(course) || outcome.result !== "win") return [];
  const lane = lanes(run.way);
  const deepest: Deepest = { room: run.room + 1 };
  const kept: Kept[] = [];
  const held = isHeld(run, run.room) ? lane.held(run.room) : null;
  if (held !== null) kept.push({ slot: held, data: keptBoard(setup), held: true });
  const ever = lane.depth("ever");
  if (ever !== null && deepest.room > s.ever[course]) {
    s.ever[course] = deepest.room;
    kept.push({ slot: ever, data: deepest });
  }
  const week = lane.depth("week");
  if (week !== null && deepest.room > s.week.deepest[course]) {
    s.week.deepest[course] = deepest.room;
    kept.push({ slot: week, data: deepest });
  }
  return guest ? [] : kept;
}

/**
 * What a run is paid for (`payout`): its summary, but a run whose course goes on past the rooms
 * that pay, having won the last of them, is paid as a run of fifteen rooms that won, though it went
 * on. Its rooms and bosses are counted only to there (`summariseRun`).
 */
export function paidFor(run: Recorded, summary: RunSummary): RunSummary {
  const { last, paysThrough } = courseOf(run.way);
  const won = totalsOf(run).cleared.includes(paysThrough - 1);
  return last >= paysThrough && won ? { ...summary, ending: "won" } : summary;
}
