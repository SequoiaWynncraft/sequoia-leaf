/**
 * What the table is doing right now: the run in progress, the almanac, the member's prefs, and
 * which part of a room is on. Every change to the run goes through `act`, which keeps it in the
 * browser at once and tells whoever is listening what happened, so the screen can show it.
 */
import { earn } from "@sequoia-leaf/kit/purse.ts";

import {
  type Almanac,
  loadAlmanac,
  loadRun,
  newAlmanac,
  type News,
  type Note,
  type Payout,
  payout,
  recordRun,
  type Refused,
  type Run,
  type RunSummary,
  saveAlmanac,
  saveRun,
  startRun,
  summariseRun,
} from "../game/index.ts";
import { keep, KEYS, loadPrefs, type Prefs, read, savePrefs } from "./keep.ts";

/** Which part of the game is on screen: the front page, planning a room, the fight, what it paid, the end. */
export type Mode = "front" | "plan" | "fight" | "after" | "over";

/** How a finished run came out, for the page at the end. */
export interface Ended {
  run: Run;
  summary: RunSummary;
  paid: Payout;
  news: News[];
}

export const S: {
  run: Run | null;
  almanac: Almanac;
  prefs: Prefs;
  mode: Mode;
  ended: Ended | null;
} = {
  run: null,
  almanac: newAlmanac(),
  prefs: loadPrefs(null),
  mode: "front",
  ended: null,
};

type NotesHeard = (notes: readonly Note[]) => void;
const noteHearers: NotesHeard[] = [];
const changeHearers: (() => void)[] = [];
const refusalHearers: ((why: string) => void)[] = [];

/** Hears what every action did, in order. */
export const onNotes = (fn: NotesHeard): void => void noteHearers.push(fn);
/** Hears that something on the table changed and the interface should be drawn again. */
export const onChange = (fn: () => void): void => void changeHearers.push(fn);
/** Hears why an action was turned down, to say so. */
export const onRefused = (fn: (why: string) => void): void => void refusalHearers.push(fn);

export function changed(): void {
  for (const fn of changeHearers) fn();
}
export function tellNotes(notes: readonly Note[]): void {
  for (const fn of noteHearers) fn(notes);
}
export function refuse(why: string): void {
  for (const fn of refusalHearers) fn(why);
}

/** Reads everything kept in the browser. A kept run that makes no sense, or is already over, is let go. */
export function wake(): void {
  S.prefs = loadPrefs(read(KEYS.prefs));
  S.almanac = loadAlmanac(read(KEYS.almanac) ?? "") ?? newAlmanac();
  const kept = read(KEYS.run);
  const loaded = kept ? loadRun(kept) : null;
  S.run = loaded?.ok && loaded.run.phase !== "over" ? loaded.run : null;
  if (kept && !S.run) keep(KEYS.run, null);
}

export function saveNow(): void {
  if (S.run && S.run.phase !== "over") keep(KEYS.run, saveRun(S.run));
  keep(KEYS.prefs, savePrefs(S.prefs));
}
export function prefsChanged(): void {
  keep(KEYS.prefs, savePrefs(S.prefs));
  changed();
}

/** Starts a new run on a trail, letting go of any run in progress. */
export function begin(seed: number, trail: number): Run {
  const run = startRun(seed, { trail });
  S.run = run;
  S.ended = null;
  S.prefs.trail = run.trail;
  S.mode = "plan";
  saveNow();
  return run;
}

/**
 * The run is over: works out what it amounted to, pays the Coins into the member's purse, writes
 * the almanac, and lets the kept run go. Happens once, the moment the run ends.
 */
function finish(run: Run): void {
  const summary = summariseRun(run);
  const paid = payout(summary);
  const recorded = recordRun(S.almanac, summary);
  S.almanac = recorded.almanac;
  keep(KEYS.almanac, saveAlmanac(S.almanac));
  keep(KEYS.run, null);
  earn(paid.coins, "The Little Raid");
  S.ended = { run, summary, paid, news: recorded.news };
}

/**
 * Does something to the run. What happened is kept at once and told to the screen; a refusal is
 * told too, in the rules' own words.
 */
export function act<T extends { ok: true; notes: Note[] } | Refused>(action: (run: Run) => T): T | null {
  const run = S.run;
  if (!run) return null;
  const was = run.phase;
  const done = action(run);
  if (!done.ok) {
    refuse(done.why);
    return done;
  }
  if (run.phase === "over" && was !== "over") finish(run);
  else saveNow();
  tellNotes(done.notes);
  changed();
  return done;
}
