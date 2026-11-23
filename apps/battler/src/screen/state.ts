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
 *
 * What the table is showing is one value (`S.screen`, `screen.ts`), moved on only by `go`, which
 * also asks Leaf for a room's takings once its fight has been played; whoever animates the table
 * hears each move (`onScreen`).
 */
import { makeHold, openPlay, type Play, type Trouble, waitingLook } from "@sequoia-leaf/kit/play.ts";
import {
  type Almanac,
  type Looks,
  newAlmanac,
  newLooks,
  predict,
  type RaidCommand,
  type RaidNote,
  readNotes,
  readView,
  refusalText,
  type RunView,
  type TableView,
} from "@sequoia-leaf/raid";

import { keepPrefs, newPrefs, type Prefs, readPrefs } from "./keep.ts";
import { endedOf, type Event, type Screen, step, type Table } from "./screen.ts";

export const S: {
  /** The run in hand, as the page's copy; while the screen shows a run that has ended, that run. */
  run: RunView | null;
  almanac: Almanac;
  looks: Looks;
  /** The trail picked to set out on next. */
  trail: number;
  /** Runs begun at this table. */
  runs: number;
  prefs: Prefs;
  /** What the table is showing; moved on by `go`. */
  screen: Screen;
} = {
  run: null,
  almanac: newAlmanac(),
  looks: newLooks(),
  trail: 0,
  runs: 0,
  prefs: newPrefs(),
  screen: { at: "front" },
};

/** What a command did: its notes, or the sentence it was turned down with. */
export type Did = { ok: true; notes: RaidNote[] } | { ok: false; why: string };

type NotesHeard = (notes: readonly RaidNote[]) => void;
const noteHearers: NotesHeard[] = [];
const changeHearers: (() => void)[] = [];
const refusalHearers: ((why: string) => void)[] = [];
const heldHearers: (() => void)[] = [];
const screenHearers: ((before: Screen, now: Screen) => void)[] = [];

/** Hears what every command did, in order. */
export const onNotes = (fn: NotesHeard): void => void noteHearers.push(fn);
/** Hears that something on the table changed and the interface should be drawn again. */
export const onChange = (fn: () => void): void => void changeHearers.push(fn);
/** Hears why a command was turned down, to say so. */
export const onRefused = (fn: (why: string) => void): void => void refusalHearers.push(fn);
/** Hears that a command was held off while Leaf answers another: nothing was done or sent. */
export const onHeld = (fn: () => void): void => void heldHearers.push(fn);
/** Hears each move of the screen: what it was, and what it is now. */
export const onScreen = (fn: (before: Screen, now: Screen) => void): void => void screenHearers.push(fn);

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
  // A run that has ended stays on the table, for its last page, while the screen shows it.
  S.run = view.run ?? endedOf(S.screen)?.run ?? null;
}

/** Leaf's run as the page has it, and the runs begun at the table: what the screen sits down to. */
export const tableNow = (): Table => ({ run: table?.state.run ?? null, runs: S.runs });

let moving = false;
const moves: Event[] = [];
/**
 * Moves the screen on (`step`), and tells whoever animates the table. A move asked for while one is
 * being told waits its turn. A fight played to its end has its room settled by Leaf: its takings,
 * or, taken on another page already, the table as Leaf has it.
 */
export function go(event: Event): void {
  moves.push(event);
  if (moving) return;
  moving = true;
  try {
    for (let ev = moves.shift(); ev; ev = moves.shift()) {
      const before = S.screen;
      S.screen = step(before, ev);
      if (S.screen === before) continue;
      if (table) take(table.state);
      if (S.screen.at === "after" && before.at === "fight") void settleRoom();
      for (const fn of screenHearers) fn(before, S.screen);
    }
  } finally {
    moving = false;
  }
}

/** Asks Leaf to settle the room whose fight was played, after anything already on its way to Leaf. */
async function settleRoom(): Promise<void> {
  const play = table;
  if (!play) return;
  const answer = await hold.until(false, play.send({ do: "take" }));
  take(play.state);
  if ("refused" in answer) {
    go({ e: "elsewhere", ...tableNow() });
    return;
  }
  tellNotes(answer.notes);
  go({ e: "taken", notes: answer.notes });
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
    go({ e: "leaf", ...tableNow() });
    changed();
  });
  return null;
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
