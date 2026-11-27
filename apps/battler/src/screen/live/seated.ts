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

const L: {
  line: Line | null;
  /** The seat's run as it set out for the fight it is in: what the room paid is told against it. */
  before: RunView | null;
} = { line: null, before: null };
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

/** Sends a command shown already; should Leaf turn it down, its view is already the line's, and the member hears why. */
async function sent(line: Line, command: SittingCommand): Promise<void> {
  const answer = await line.send(command, (view) => {
    const redone = predict(view, command);
    return redone && "view" in redone ? redone.view : view;
  });
  if ("refused" in answer) answered(line, answer);
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
    const guess = predict(line.view, command);
    if (!guess) return null;
    if ("refused" in guess) {
      const why = words(guess);
      refuse(why);
      return { ok: false, why };
    }
    void sent(line, command);
    S.run = shownRun(line.view);
    tellNotes(guess.notes);
    changed();
    return { ok: true, notes: guess.notes };
  },
  ask(command, waiting) {
    if (heldOff(command)) return Promise.resolve(null);
    if (isPlanning(command)) return asked(command, waiting);
    const why = "At a live table the clock sets out.";
    refuse(why);
    return Promise.resolve({ ok: false, why });
  },
};

/** Takes the figure at a place in the carousel's ring (`waiting`, its button, shows Leaf is answering). */
export async function takeFromRing(offer: number, waiting: Element | null = null): Promise<Did | null> {
  if (hold.asking()) return null;
  return asked({ do: "pick", offer }, waiting);
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
  line.onGone((why) => {
    if (L.line !== line) return;
    for (const fn of goneHearers) fn(why);
    doneWithTable();
  });
}
