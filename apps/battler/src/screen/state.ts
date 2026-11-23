/**
 * What the table is doing right now. The table itself is Leaf's: the run in hand, the almanac, the
 * looks and the trail picked live on the guild's server, and the page holds a copy to draw from
 * (`S`), taken from Leaf's every answer. Everything the member does is a command to Leaf:
 *
 * - `doNow`, for what the shared rules can work out on the copy without Leaf (moving, benching,
 *   swapping, selling, handing over an item, holding the stall, buying, experience): shown at once,
 *   and sent;
 * - `ask`, for what only Leaf can say (rustling, the picks, the fight, the takings, setting out,
 *   walking home, the front page's choices): sent, and shown when Leaf answers, with the thing
 *   asked for in the kit's waiting look meanwhile.
 *
 * Whenever Leaf's state is not what the page was showing (another page of the member's acted, or
 * a guess was wrong, or something here was changed by hand), the page takes Leaf's and draws again.
 * Only the member's view settings stay in the browser (`keep.ts`).
 */
import { makeHold, openPlay, type Play, type Trouble, waitingLook } from "@sequoia-leaf/kit/play.ts";
import {
  type Almanac,
  type Looks,
  newAlmanac,
  newLooks,
  type News,
  type Payout,
  predict,
  type RaidCommand,
  type RaidNote,
  readNotes,
  readView,
  refusalText,
  type RunSummary,
  type RunView,
  type TableView,
} from "@sequoia-leaf/raid";

import { keepPrefs, newPrefs, type Prefs, readPrefs } from "./keep.ts";

/** Which part of the game is on screen: the front page, planning a room, the fight, what it paid, the end. */
export type Mode = "front" | "plan" | "fight" | "after" | "over";

/** How a finished run came out, for the page at the end. */
export interface Ended {
  run: RunView;
  summary: RunSummary;
  paid: Payout;
  news: News[];
}

export const S: {
  /** The run in hand, as the page's copy; after a run ends, that run until the next is set out on. */
  run: RunView | null;
  almanac: Almanac;
  looks: Looks;
  /** The trail picked to set out on next. */
  trail: number;
  /** Runs begun at this table. */
  runs: number;
  prefs: Prefs;
  mode: Mode;
  ended: Ended | null;
} = {
  run: null,
  almanac: newAlmanac(),
  looks: newLooks(),
  trail: 0,
  runs: 0,
  prefs: newPrefs(),
  mode: "front",
  ended: null,
};

/** What a command did: its notes, or the sentence it was turned down with. */
export type Did = { ok: true; notes: RaidNote[] } | { ok: false; why: string };

type NotesHeard = (notes: readonly RaidNote[]) => void;
const noteHearers: NotesHeard[] = [];
const changeHearers: (() => void)[] = [];
const refusalHearers: ((why: string) => void)[] = [];
const heldHearers: (() => void)[] = [];
const endHearers: ((ended: Ended) => void)[] = [];
const movedHearers: (() => void)[] = [];

/** Hears what every command did, in order. */
export const onNotes = (fn: NotesHeard): void => void noteHearers.push(fn);
/** Hears that something on the table changed and the interface should be drawn again. */
export const onChange = (fn: () => void): void => void changeHearers.push(fn);
/** Hears why a command was turned down, to say so. */
export const onRefused = (fn: (why: string) => void): void => void refusalHearers.push(fn);
/** Hears that a command was held off while Leaf answers another: nothing was done or sent. */
export const onHeld = (fn: () => void): void => void heldHearers.push(fn);
/** Hears that a run has ended: what it came to and what it paid. */
export const onEnded = (fn: (ended: Ended) => void): void => void endHearers.push(fn);
/** Hears that Leaf's table is not the one the page was showing: the page takes it and draws again. */
export const onMoved = (fn: () => void): void => void movedHearers.push(fn);

export function changed(): void {
  for (const fn of changeHearers) fn();
}
export function tellNotes(notes: readonly RaidNote[]): void {
  for (const fn of noteHearers) fn(notes);
}
export function refuse(why: string): void {
  for (const fn of refusalHearers) fn(why);
}

let table: Play<TableView, RaidCommand, RaidNote> | null = null;
/** The front page's choices, which leave every offer where it is. */
const STEADY: ReadonlySet<RaidCommand["do"]> = new Set(["trail", "look", "buyLook"]);
/**
 * Commands held off while Leaf answers one only it can answer (the kit's one rule): a command names
 * what it means by its place (an offer, a card, a figure's spot), and that answer may put something
 * else there (other offers, other cards). Nothing is queued: the table shows it is busy (`busy`),
 * and the member hears that it was not done.
 */
const hold = makeHold();
function heldOff(command: RaidCommand): boolean {
  if (!hold.held(STEADY.has(command.do))) return false;
  for (const fn of heldHearers) fn();
  return true;
}
/** Whether Leaf is answering a rustle, a pick, setting out or the takings: until it has, nothing more is done. */
export const busy = (): boolean => hold.held(true);

/** What the page shows, as text, to tell whether Leaf's answer changed it. */
const picture = (): string => JSON.stringify([S.run, S.almanac, S.looks, S.trail, S.runs]);

/** Takes Leaf's state (the copy, with what is still waiting on top) into what the page shows. */
function take(view: TableView): void {
  S.almanac = view.almanac;
  S.looks = view.looks;
  S.trail = view.trail;
  S.runs = view.runs;
  // A run that has ended stays on the table, for its last page, until the next one is set out on.
  S.run = view.run ?? S.ended?.run ?? null;
}

/** The table's state as Leaf gave it, for looking at from outside. */
export const leafView = (): TableView | null => table?.state ?? null;

/**
 * Opens the table from Leaf, for the member the page is signed in as (`player`). Says why it could
 * not: signed out, or no Leaf answering. After that, whatever stops the page sending (being signed
 * out) is told to `trouble`.
 */
export async function openTable(player: string, trouble: (why: Trouble) => void): Promise<Trouble | null> {
  S.prefs = readPrefs();
  const opened = await openPlay<TableView, RaidCommand, RaidNote>(
    "raid",
    { view: readView, notes: readNotes },
    { player },
  );
  if ("trouble" in opened) return opened.trouble;
  table = opened;
  take(opened.state);
  opened.onTrouble(trouble);
  opened.onState((view) => {
    const before = picture();
    take(view);
    if (hold.asking() || picture() === before) return;
    for (const fn of movedHearers) fn();
    changed();
  });
  return null;
}

/** What an answer's notes mean for the page itself: a run ended, or one set out on. */
function noted(notes: readonly RaidNote[]): void {
  for (const note of notes) {
    if (note.t === "ended") {
      const ended: Ended = { run: note.run, summary: note.summary, paid: note.paid, news: note.news };
      S.ended = ended;
      for (const fn of endHearers) fn(ended);
    } else if (note.t === "started") S.ended = null;
  }
  if (table) take(table.state);
}

/** Sends a command shown already. Should Leaf see it otherwise, its state is already the page's, and the member hears why. */
async function sent(play: Play<TableView, RaidCommand, RaidNote>, command: RaidCommand): Promise<void> {
  const answer = await play.send(command, (copy) => {
    const redone = predict(copy, command);
    return redone && "view" in redone ? redone.view : copy;
  });
  if ("refused" in answer) refuse(refusalText(answer.refused, play.state));
}

/**
 * Does a command the shared rules work out on the page's copy without Leaf: shows it at once and
 * sends it. A command they turn down is said so here and not sent. Null for one that must `ask`,
 * and for one held off while Leaf answers (nothing is done or sent).
 */
export function doNow(command: RaidCommand): Did | null {
  const play = table;
  if (!play || heldOff(command)) return null;
  const guess = predict(play.state, command);
  if (!guess) return null;
  if ("refused" in guess) {
    const why = refusalText(guess.refused, play.state);
    refuse(why);
    return { ok: false, why };
  }
  void sent(play, command);
  take(play.state);
  tellNotes(guess.notes);
  changed();
  return { ok: true, notes: guess.notes };
}

/**
 * Sends a command only Leaf can answer, and shows what it did when Leaf answers. `waiting` is the
 * thing asked for: it shows the kit's waiting look while Leaf takes more than a moment.
 *
 * Null, with nothing asked, for one held off while Leaf answers another.
 */
export async function ask(command: RaidCommand, waiting: Element | null = null): Promise<Did | null> {
  const play = table;
  if (!play || heldOff(command)) return null;
  const answer = await hold.until(STEADY.has(command.do), waitingLook(waiting, play.send(command)));
  take(play.state);
  if ("refused" in answer) {
    const why = refusalText(answer.refused, play.state);
    refuse(why);
    changed();
    return { ok: false, why };
  }
  noted(answer.notes);
  tellNotes(answer.notes);
  changed();
  return { ok: true, notes: answer.notes };
}

/** Whether anything sent to Leaf has not been answered yet. */
export const waitingForLeaf = (): boolean => table?.waiting() ?? false;

/** Asks Leaf for the table again and takes it: for when something was staged from outside. */
export async function again(): Promise<void> {
  await table?.refresh();
  if (table) take(table.state);
}

export function prefsChanged(): void {
  keepPrefs(S.prefs);
  changed();
}
