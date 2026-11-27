/**
 * The member's seat at a live table, as far as Leaf goes: the line to their sitting (`line.ts`), the
 * run the shared table is shown of it, and their commands to it. Nothing here draws; `seat.ts`
 * draws the table for the seat and hears the sitting change (`onSeatView`).
 *
 * One place decides whether Leaf's answer to a command is for the seat the member is at now
 * (`ours`): the line is still theirs and they are at its table. Only such an answer touches the
 * shared table, says why it was refused, or plays its notes; an answer that comes after the member
 * stepped back to the front page is the line's alone (its view takes it), and the solo raid never
 * hears of it.
 */
import { waitingLook } from "@sequoia-leaf/kit/play.ts";
import { type FightResult, foughtOf, isPlanning, type RunView } from "@sequoia-leaf/raid";
import type { SittingCommand } from "@sequoia-leaf/raid/sitting/commands.ts";
import { sideOf } from "@sequoia-leaf/raid/sitting/sitting.ts";
import { predict, type SeatView, type SittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { OWN } from "../sides.ts";
import { changed, type Did, go, heldOff, hold, LIVE, refuse, S, type Seated, tellNotes } from "../state.ts";
import type { Answer, Gone, Line } from "./line.ts";
import { CLOSED_UNSTARTED, closedUnstarted, NOT_SEATED, paidLines, refusalWords, seatedAt } from "./reads.ts";

/** What the member has said and wants Leaf to show: ready (or not) in a room's planning, and a room's fight watched. */
interface Wanted {
  ready: { room: number; on: boolean } | null;
  watched: number | null;
}
const L: {
  line: Line | null;
  /** The seat's run as it set out for the fight it is in: what the room paid is told against it. */
  before: RunView | null;
  wanted: Wanted;
} = { line: null, before: null, wanted: { ready: null, watched: null } };
const viewHearers: ((view: SittingView, was: SittingView) => void)[] = [];
const goneHearers: ((why: Gone) => void)[] = [];
const doneHearers: ((why: string | null) => void)[] = [];

/** The line to the member's sitting, if they are at one. */
export const liveLine = (): Line | null => L.line;
/** The sitting as the page has it, if the member is at one. */
export const liveView = (): SittingView | null => L.line?.view ?? null;
/** Whether the member is looking at their live table. */
export const atLiveTable = (): boolean => LIVE.seat === SEAT;
/** The member's seat at a sitting, if they have one (none before it starts). */
export const mineOf = (view: SittingView): SeatView | null =>
  view.you === null ? null : (view.seats[view.you] ?? null);

/** Hears the member's sitting change: as it is now, and as it was. */
export const onSeatView = (fn: (view: SittingView, was: SittingView) => void): void => void viewHearers.push(fn);
/** Hears that Leaf no longer has the sitting, or the member is signed out. */
export const onLineGone = (fn: (why: Gone) => void): void => void goneHearers.push(fn);
/** Hears that the member is done with a sitting, and why when the page says so. */
export const onDone = (fn: (why: string | null) => void): void => void doneHearers.push(fn);

/**
 * The run the shared table is shown: the seat's own, but with no pick up while the carousel stands
 * (the first figure is taken from the ring), and, for a seat that is out or a table that is over, at
 * planning with nothing to pick, so that its board stays on the table to watch from.
 */
export function shownRun(view: SittingView): RunView | null {
  const run = view.run;
  if (!run) return null;
  if (mineOf(view)?.place != null || run.stage.phase === "over") return { ...run, stage: { phase: "plan", picks: [] } };
  // The ring stands alone on the far half: whoever waits in the next room comes after it.
  if (view.stage.at === "carousel" && run.stage.phase === "plan")
    return { ...run, stage: { phase: "plan", picks: [] }, foe: { ...run.foe, who: "", figures: [] } };
  return run;
}

/** A refusal in words: Leaf's own sentence, or the rules' for the code. */
const words = (a: { refused: string; why?: string }): string => refusalWords(a.refused, a.why);

/** Whether Leaf's answer on a line is for the seat the member is at now: the line is still theirs, and they are at its table. */
const ours = (line: Line): boolean => L.line === line && atLiveTable();

/** Takes Leaf's answer to a command into the shared table, when it is ours; else it was the line's alone, and nothing hears it. */
function answered(line: Line, answer: Answer): Did | null {
  if (!ours(line)) return null;
  S.run = shownRun(line.view);
  if ("refused" in answer) {
    const why = words(answer);
    refuse(why);
    changed();
    return { ok: false, why };
  }
  tellNotes(answer.notes);
  changed();
  return { ok: true, notes: answer.notes };
}

/**
 * Sends a command shown already; should Leaf turn it down, its view is already the line's, and the
 * member hears why (unless `quiet`: one the page sent by itself).
 */
async function sent(line: Line, command: SittingCommand, quiet = false): Promise<void> {
  const answer = await line.send(command, (view) => {
    const redone = predict(view, command);
    return redone && "view" in redone ? redone.view : view;
  });
  if (!("refused" in answer)) return;
  if (!quiet) answered(line, answer);
  else if (ours(line)) {
    S.run = shownRun(line.view);
    changed();
  }
}

/**
 * Shows a command at once as Leaf will do it, and sends it: the run the table shows, what happened,
 * and the table drawn again. A command the rules turn down is said so (unless `quiet`) and not sent.
 */
function shownNow(line: Line, command: SittingCommand, quiet = false): Did | null {
  const guess = predict(line.view, command);
  if (!guess) return null;
  if ("refused" in guess) {
    const why = words(guess);
    if (!quiet) refuse(why);
    return { ok: false, why };
  }
  const was = line.view;
  void sent(line, command, quiet);
  // The shared table is the seat's only while the member is at it (a want sent again from the front page is not).
  if (ours(line)) {
    S.run = shownRun(line.view);
    tellNotes(guess.notes);
  }
  // The sitting's own moves change what the live table shows round the board: it hears them as it hears Leaf.
  if (isPlanning(command)) changed();
  else for (const fn of viewHearers) fn(line.view, was);
  return { ok: true, notes: guess.notes };
}

/** Sends a command only Leaf can answer, holding the table until it does. */
async function asked(command: SittingCommand, waiting: Element | null): Promise<Did | null> {
  const line = L.line;
  if (!line) return null;
  return answered(line, await hold.until(false, waitingLook(waiting, line.send(command))));
}

const SEAT: Seated = {
  run: () => (L.line ? shownRun(L.line.view) : null),
  table: () => ({ run: L.line ? shownRun(L.line.view) : null, runs: S.runs }),
  doNow(command) {
    const line = L.line;
    if (!line || heldOff(command) || !isPlanning(command)) return null;
    return shownNow(line, command);
  },
  ask(command, waiting) {
    if (heldOff(command)) return Promise.resolve(null);
    if (isPlanning(command)) return asked(command, waiting);
    const why = "At a live table the clock sets out.";
    refuse(why);
    return Promise.resolve({ ok: false, why });
  },
};

/** Takes the figure at a place in the carousel's ring: shown at once, as Leaf will take it; Leaf's answer wins. */
export function takeFromRing(offer: number): Did | null {
  const line = L.line;
  return line && atLiveTable() ? shownNow(line, { do: "pick", offer }) : null;
}

/** Ready to fight, or not after all: wanted until Leaf shows it, or the room's planning is over (`resendWanted`). */
export function readyUp(on: boolean): Did | null {
  const line = L.line;
  if (!line || !atLiveTable()) return null;
  L.wanted.ready = { room: line.view.room, on };
  return shownNow(line, { do: "ready", on, room: line.view.room });
}

/**
 * The member's fight has been watched, or skipped: said by the page itself, so a late one turned down
 * is not said; wanted until Leaf shows it, or the room's fights are over.
 */
export function watchedFight(): Did | null {
  const line = L.line;
  if (!line || !atLiveTable()) return null;
  L.wanted.watched = line.view.room;
  return shownNow(line, { do: "watched", room: line.view.room }, true);
}

/**
 * With each read that lands: what the member wants that Leaf does not show (a command turned down, or
 * lost, or an older Leaf's that did not know it) is sent again, by itself; once the room's stage is
 * over it is wanted no more. Both commands may be sent any number of times.
 */
function resendWanted(line: Line): void {
  const { view } = line;
  const { ready, watched } = L.wanted;
  if (ready && !(view.stage.at === "plan" && view.room === ready.room)) L.wanted.ready = null;
  if (watched !== null && !(view.stage.at === "fight" && view.room === watched)) L.wanted.watched = null;
  const you = view.you;
  if (line.waiting() || you === null) return;
  const want = L.wanted;
  // Sent as the member's own press is, so the seat is drawn again with it at once.
  if (want.ready && view.stage.at === "plan" && view.stage.ready.includes(you) !== want.ready.on)
    shownNow(line, { do: "ready", on: want.ready.on, room: want.ready.room }, true);
  if (want.watched !== null && view.stage.at === "fight" && !view.stage.done.includes(you))
    shownNow(line, { do: "watched", room: want.watched }, true);
}

/** The seat's run, if it is in a fight at the table now. */
function fighting(view: SittingView): RunView | null {
  const run = view.stage.at === "fight" && mineOf(view)?.place === null ? view.run : null;
  return run && foughtOf(run) ? run : null;
}

/**
 * Sits the member down at their seat: their commands go to it, and its fights are drawn from its
 * side. Coming in during a fight, the run as it set out is kept, so that what the room paid is told
 * when the table goes on. False with no seat.
 */
export function sitAt(): boolean {
  const view = L.line?.view;
  const mine = view ? mineOf(view) : null;
  if (!view || !mine) return false;
  OWN.side = (setup) => sideOf(setup, mine.who);
  LIVE.seat = SEAT;
  L.before = fighting(view);
  return true;
}

/** A fight of the seat's is being played: its run as it set out is kept, to tell what the room paid. */
export function fightBegins(view: SittingView): void {
  L.before = fighting(view);
}

/** What the room paid, once the table has gone on from the fight the seat set out for (how it went, then the lines); null with no fight kept. */
export function paidFor(view: SittingView): { result: FightResult | null; lines: string[] } | null {
  const before = L.before;
  L.before = null;
  if (!before || !view.run) return null;
  const result = foughtOf(before)?.outcome.result ?? null;
  return { result, lines: paidLines(result, before, view.run) };
}

/** Back to the front page from the live table (from wherever the screen is: a fight's end too). */
export function stepBack(): void {
  if (!atLiveTable()) return;
  go({ e: "sit", run: null, runs: S.runs });
}

/** Done with the sitting (`why`, said on the front page): its line is put away, and the member is at the front page. */
export function doneWithTable(why: string | null = null): void {
  stepBack();
  L.line?.close();
  L.line = null;
  L.before = null;
  L.wanted = { ready: null, watched: null };
  for (const fn of doneHearers) fn(why);
}

/**
 * Takes up a sitting Leaf has shown the page, as the member's. Whenever Leaf's view shows them
 * without a seat there, whatever the reason (they left in another tab; the table closed before it
 * started), the page lets the sitting go and says why.
 */
export function takeUp(line: Line): void {
  if (L.line) doneWithTable();
  L.line = line;
  L.before = null;
  const seen = { view: line.view };
  line.onView((view) => {
    if (L.line !== line) return;
    const was = seen.view;
    seen.view = view;
    // Leaf shows the member without a seat (left in another tab, or the table closed unstarted): the page lets it go.
    if (!seatedAt(view, line.player)) return doneWithTable(closedUnstarted(view, was) ? CLOSED_UNSTARTED : NOT_SEATED);
    for (const fn of viewHearers) fn(view, was);
  });
  line.onRead(() => {
    if (L.line === line) resendWanted(line);
  });
  line.onGone((why) => {
    if (L.line !== line) return;
    for (const fn of goneHearers) fn(why);
    doneWithTable();
  });
}
