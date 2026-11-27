/**
 * Telling pages a sitting moved on, so that they read it then rather than ask on a timer (core's
 * `Nudge`). Whenever a write moves a sitting's `rev`, each member at it before or after the write
 * whose view of it moved is told its id and new `rev`, on their own connection (`LivePlayers`): every
 * one of them when what they are all shown moved (someone sits or leaves, a start, a pick from the
 * carousel, a lock, a stage, a level bought, a place, the end, a new one); only the members whose
 * own run moved when nothing else did (a member's planning, whose board nobody sees until the lock).
 * When the write changes the list of open sittings, everybody in the room of the open tables is told
 * that (`SITTINGS_ROOM`). Nothing of the sitting travels: each page reads it, and sees what its
 * reading shows it. Told after the write is kept, never before, so that a page reading at once finds
 * it; and in the sitting's lane, so that the words for one sitting go in the order of its `rev`.
 */
import { type Nudge, SITTINGS_ROOM } from "@sequoia-leaf/core";
import type { Sitting } from "@sequoia-leaf/raid/sitting/sitting.ts";
import { sittingView } from "@sequoia-leaf/raid/sitting/view.ts";
import { Effect } from "effect";

import { LivePlayers } from "../live/players.ts";
import { Watchers } from "../live/watchers.ts";

/** Every member at a sitting: sat at an open one; with a seat at one started or over, still in or out. */
export function membersAt(t: Sitting): string[] {
  if (t.stage.at === "open") return t.stage.sat.map((m) => m.id);
  return t.seats.flatMap((seat) => (seat.who.is === "member" ? [seat.who.id] : []));
}

/**
 * What every member at a sitting is shown of it alike, from a view of it (`sittingView`, or one as it
 * came off the wire): all of it but the viewer's own seat and run, and every seat's table as it stands
 * now, which moves with each member's planning. Only that changing tells every member; a table to
 * scout is read by the page scouting it.
 */
export function sharedText(view: unknown): string {
  const plain = typeof view === "object" && view !== null ? { ...view, you: null, run: null } : null;
  return JSON.stringify(plain, (key: string, value: unknown) => (key === "table" ? undefined : value));
}
const sharedView = (t: Sitting): string => sharedText(sittingView(t, null));

/** Each member's own run at a sitting, by their Leaf id. */
function runsAt(t: Sitting): Map<string, string> {
  const runs = new Map<string, string>();
  for (const seat of t.seats) if (seat.who.is === "member") runs.set(seat.who.id, JSON.stringify(seat.run));
  return runs;
}

/**
 * Who is told of a write, from how the sitting stood before it (null: a new one) to after: every
 * member at it either way when what they are all shown moved; else each member whose own run moved.
 */
export function toldOf(before: Sitting | null, after: Sitting): Set<string> {
  if (before === null || sharedView(before) !== sharedView(after))
    return new Set([...(before === null ? [] : membersAt(before)), ...membersAt(after)]);
  const was = runsAt(before);
  return new Set([...runsAt(after)].flatMap(([id, run]) => (was.get(id) === run ? [] : [id])));
}

/** Whether a write changes the list of open sittings: one that was open, or is now. */
export const listMoved = (before: Sitting | null, after: Sitting): boolean =>
  before?.stage.at === "open" || after.stage.at === "open";

const said = (nudge: Nudge): string => JSON.stringify(nudge);

/** Tells of a sitting kept at `rev`, written from `before` to `after`: its members, and the open tables' room if the list changed. */
export type TellSitting = (id: string, rev: number, before: Sitting | null, after: Sitting) => void;

/** Telling of sittings, through Live's players and its rooms' watchers. */
export const sittingsTold: Effect.Effect<TellSitting, never, LivePlayers | Watchers> = Effect.gen(function* () {
  const players = yield* LivePlayers;
  const watchers = yield* Watchers;
  return (id, rev, before, after) => {
    players.tell(toldOf(before, after), said({ t: "sitting", id, rev }));
    if (listMoved(before, after)) watchers.tell(SITTINGS_ROOM, said({ t: "sittings" }));
  };
});
