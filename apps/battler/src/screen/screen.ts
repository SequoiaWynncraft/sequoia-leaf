/**
 * What the table is showing, as one value, and the one function that moves it on (`step`). Leaf's
 * run says where the member is; the screen says what they are looking at: the front page, planning
 * a room (and whether the last fight's sheet is up), a fight being played, what a fight paid being
 * counted out, or how a run ended.
 *
 * A fight on screen is a playback of its own (`Playback`): which fight it is (the run's number at
 * the table, its room, its seed), the fight Leaf decided, and the run's numbers as it set out. It
 * plays to its end whatever Leaf's run does meanwhile; then the takings are asked for, and should
 * another page have taken them already, the table goes on as Leaf has it.
 */
import {
  type BossId,
  type Fought,
  foughtOf,
  isBossId,
  type News,
  type Payout,
  playsAsKept,
  type RaidNote,
  resolveFight,
  type RunSummary,
  type RunView,
} from "@sequoia-leaf/raid";

import { acrossOf, decided } from "./sides.ts";

/** How a finished run came out, for the page at the end. */
export interface Ended {
  run: RunView;
  summary: RunSummary;
  paid: Payout;
  news: News[];
}

/** The numbers the table shows that the takings count out. */
export interface Counts {
  acorns: number;
  resolve: number;
  xp: number;
  level: number;
}

/** A fight on screen: which it is, as Leaf decided it, whether these rules play it so, and the run as it set out. */
export interface Playback {
  /** The run's number at the table, the room, and the fight's seed. */
  key: string;
  fought: Fought;
  /** Whether these rules play the setup to the outcome Leaf kept: if not, it is not shown, only its end. */
  kept: boolean;
  room: number;
  boss: BossId | null;
  before: Counts;
  /** The run's last fight watched again: when it is over the room is planned again, and nothing is taken. */
  again?: true;
}

/** What a room paid, as it is counted out. */
export interface Takings {
  /** Leaf's notes for settling the room; null while Leaf answers. */
  notes: readonly RaidNote[] | null;
  /** How many of the notes have been counted out, and how many acorns have landed in the purse. */
  counted: number;
  landed: number;
  /** Everything has been counted. */
  done: boolean;
}

export type Screen =
  | { at: "front" }
  | { at: "plan"; looking: boolean }
  | { at: "fight"; play: Playback }
  | { at: "after"; play: Playback; takings: Takings }
  | { at: "over"; ended: Ended };
export type At = Screen["at"];

/** Leaf's run as the page has it, and the number of runs begun at the table. */
export interface Table {
  run: RunView | null;
  runs: number;
}

export type Event =
  /** To the front page. A fight and its takings are seen to the end first. */
  | { e: "front" }
  /** Sits down to the table as Leaf has it: the run planned, or its fight played. */
  | ({ e: "sit" } & Table)
  /** Leaf's run is not the one the page was showing (another page of the member's played on). */
  | ({ e: "leaf" } & Table)
  /** The fight on screen has been played to its end (or skipped to it). */
  | { e: "played"; key: string }
  /** Leaf has settled the room: what it paid. */
  | { e: "taken"; notes: readonly RaidNote[] }
  /** Leaf would not settle the room: another page had. */
  | ({ e: "elsewhere" } & Table)
  /** The takings counted out up to a note; an acorn landed in the purse; all of it counted. */
  | { e: "count"; upTo: number }
  | { e: "landed" }
  | { e: "counted" }
  /** "Carry on" from a fight's sheet. */
  | ({ e: "carry" } & Table)
  /** The run has ended (walked home from). */
  | { e: "ended"; ended: Ended }
  /** Opens the last fight's sheet while planning, or puts it away. */
  | { e: "look" }
  /** Plays the run's last fight again (`Run.last`), from planning or the front page. */
  | ({ e: "watch" } & Table);

const counts = (run: RunView): Counts => ({ acorns: run.acorns, resolve: run.resolve, xp: run.xp, level: run.level });

/** The fight Leaf's run is in, as a playback. */
export function playbackOf(run: RunView, fought: Fought, runs: number): Playback {
  return {
    key: `${runs}:${run.room}:${fought.setup.seed}`,
    fought,
    kept: playsAsKept({ ...fought, outcome: decided(fought.setup, fought.outcome) }),
    room: run.room,
    boss: run.foe.figures.map((p) => p.kind).find(isBossId) ?? null,
    before: counts(run),
  };
}

/**
 * Whether a run's last fight can be watched again now: it has fought a room, and it is planning one.
 * A run in a fight Leaf has decided (picked up again after a reload) plays that fight instead.
 */
export const watchable = (run: Pick<RunView, "last" | "record" | "stage">): boolean =>
  run.stage.phase === "plan" && run.last !== null && run.record.length > 0;
/** The run's last fight, to be watched again as it was fought; null for a run that has fought none, or is not planning. */
export function againOf(run: RunView, runs: number): Playback | null {
  const setup = run.last;
  const room = run.record.at(-1)?.room;
  if (!setup || room === undefined || !watchable(run)) return null;
  const fought: Fought = { setup, outcome: resolveFight(setup) };
  return {
    key: `again:${runs}:${run.record.length}`,
    fought,
    kept: true,
    room,
    boss:
      acrossOf(setup)
        .figures.map((p) => p.kind)
        .find(isBossId) ?? null,
    before: counts(run),
    again: true,
  };
}
/** The run as the table shows who is across: in a fight watched again, the room it was and whoever it was against. */
export const facing = (screen: Screen, run: RunView): RunView =>
  screen.at === "fight" && screen.play.again
    ? { ...run, room: screen.play.room, foe: acrossOf(screen.play.fought.setup) }
    : run;

/** The table as Leaf has it: its fight played, its room planned, or the front page for no run. */
function sat({ run, runs }: Table): Screen {
  if (!run || run.stage.phase === "over") return { at: "front" };
  const fought = foughtOf(run);
  return fought ? { at: "fight", play: playbackOf(run, fought, runs) } : { at: "plan", looking: false };
}

/** How the run ended, if the room's takings ended it. */
export function endedIn(notes: readonly RaidNote[]): Ended | null {
  for (const note of notes) {
    if (note.t === "ended") return { run: note.run, summary: note.summary, paid: note.paid, news: note.news };
  }
  return null;
}

/** The run that ended, while the screen still shows it: being counted out, or at the end. */
export function endedOf(screen: Screen): Ended | null {
  if (screen.at === "over") return screen.ended;
  return screen.at === "after" && screen.takings.notes ? endedIn(screen.takings.notes) : null;
}

/** The fight on screen played to its end: its takings asked for; a fight watched again goes back to planning. */
function playedOut(screen: Screen, key: string): Screen {
  if (screen.at !== "fight" || screen.play.key !== key) return screen;
  return screen.play.again
    ? { at: "plan", looking: false }
    : { at: "after", play: screen.play, takings: { notes: null, counted: 0, landed: 0, done: false } };
}
/** The takings counted out up to a note, an acorn landed, or all of it counted. */
function countedOut(screen: Screen, ev: Extract<Event, { e: "count" | "landed" | "counted" }>): Screen {
  if (screen.at !== "after" || !screen.takings.notes) return screen;
  const t = screen.takings;
  const takings =
    ev.e === "count"
      ? { ...t, counted: Math.max(t.counted, Math.min(ev.upTo, t.notes?.length ?? 0)) }
      : ev.e === "landed"
        ? { ...t, landed: t.landed + 1 }
        : { ...t, done: true };
  return { ...screen, takings };
}
/** The run's last fight played again, from planning or the front page, while the run is planning a room. */
function watched(screen: Screen, ev: Table): Screen {
  const play = ev.run && (screen.at === "plan" || screen.at === "front") ? againOf(ev.run, ev.runs) : null;
  return play ? { at: "fight", play } : screen;
}

/** Moves the screen on. Whatever does not apply where it is changes nothing. */
export function step(screen: Screen, ev: Event): Screen {
  switch (ev.e) {
    case "front":
      return screen.at === "fight" || screen.at === "after" ? screen : { at: "front" };
    case "sit":
      return sat(ev);
    case "leaf": {
      if (screen.at !== "plan") return screen;
      const now = sat(ev);
      return now.at === "plan" ? { at: "plan", looking: screen.looking && ev.run?.last != null } : now;
    }
    case "played":
      return playedOut(screen, ev.key);
    case "taken":
      return screen.at === "after" && screen.takings.notes === null
        ? { ...screen, takings: { ...screen.takings, notes: ev.notes } }
        : screen;
    case "elsewhere":
      return screen.at === "after" && screen.takings.notes === null ? sat(ev) : screen;
    case "count":
    case "landed":
    case "counted":
      return countedOut(screen, ev);
    case "carry": {
      if (screen.at !== "after" || !screen.takings.notes) return screen;
      const ended = endedIn(screen.takings.notes);
      return ended ? { at: "over", ended } : sat(ev);
    }
    case "ended":
      return { at: "over", ended: ev.ended };
    case "look":
      return screen.at === "plan" ? { at: "plan", looking: !screen.looking } : screen;
    case "watch":
      return watched(screen, ev);
  }
}

/**
 * The numbers the table shows: the run's own, but while a room's takings are counted out, each as
 * it was before the room paid until its line is counted, and the acorns as many as have landed.
 */
export function shownCounts(screen: Screen, run: RunView): Counts {
  const own = counts(run);
  if (screen.at === "fight") return screen.play.before;
  if (screen.at !== "after" || screen.takings.done) return own;
  const { before } = screen.play;
  const { notes, counted, landed } = screen.takings;
  const seen = (notes ?? []).slice(0, counted);
  const levels = (notes ?? []).some((n) => n.t === "level");
  const has = (t: RaidNote["t"]): boolean => seen.some((n) => n.t === t);
  return {
    acorns: Math.min(own.acorns, before.acorns + landed),
    resolve: has("resolve") ? own.resolve : before.resolve,
    xp: has("level") || (!levels && has("xp")) ? own.xp : before.xp,
    level: has("level") ? own.level : before.level,
  };
}
