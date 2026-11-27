/**
 * How deep the endless runs go, as the table keeps it: the deepest room won in each way, ever (the
 * almanac's `deepest`) and this week (the table's `Week`); what a won room leaves with Leaf
 * (`Done.keep`) for the boards and, in the Deep Woods, to hold the room; and what an endless run is
 * paid for. A week starts on Monday at 00:00 UTC, on Leaf's clock.
 */
import { type Kept, utcWeekStart } from "@sequoia-leaf/core";

import { ENDLESS_WAYS, type EndlessWay } from "./content/endless.ts";
import { ROOM_COUNT } from "./content/rooms.ts";
import { heldSlot, isHeld } from "./endless.ts";
import type { Fought, Run, RunSummary, RunView } from "./run.ts";

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

/** Where a member's deepest room in an endless way is left for its boards: ever, and this week. */
export const depthSlot = (way: EndlessWay, span: "ever" | "week"): string => `depth:${way}:${span}`;
/** A depth as it is left for a board. */
export interface Deepest {
  room: number;
}

/**
 * What an endless run's fight leaves, once decided: nothing unless it is won. A room won deeper
 * than ever or than this week is written into `ever` and `week`, and left for that board; a room
 * held in the Deep Woods (`isHeld`) is held by the board that won it (`heldSlot`). A guest's
 * deepest are written down, and nothing is left.
 */
export function reached(
  s: { readonly ever: Depths; readonly week: Week },
  run: Pick<Run, "room" | "endless">,
  { setup, outcome }: Fought,
  guest: boolean,
): Kept[] {
  const way = run.endless;
  if (way === null || outcome.result !== "win") return [];
  const deepest: Deepest = { room: run.room + 1 };
  const kept: Kept[] = [];
  if (isHeld(run, run.room)) {
    kept.push({ slot: heldSlot(run.room), data: setup.sides[0], held: true });
  }
  if (deepest.room > s.ever[way]) {
    s.ever[way] = deepest.room;
    kept.push({ slot: depthSlot(way, "ever"), data: deepest });
  }
  if (deepest.room > s.week.deepest[way]) {
    s.week.deepest[way] = deepest.room;
    kept.push({ slot: depthSlot(way, "week"), data: deepest });
  }
  return guest ? [] : kept;
}

/**
 * What a run is paid for (`payout`): its summary, but an endless run that won the fifteenth room is
 * paid as a run of fifteen rooms that won, though it went on. Its rooms and bosses are counted only
 * to the fifteenth (`summariseRun`).
 */
export function paidFor(run: Pick<RunView, "endless" | "record">, summary: RunSummary): RunSummary {
  const won = run.record.some((r) => r.room === ROOM_COUNT - 1 && r.result === "win");
  return run.endless && won ? { ...summary, ending: "won" } : summary;
}
