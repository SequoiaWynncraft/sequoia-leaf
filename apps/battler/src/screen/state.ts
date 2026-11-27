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
 * Leaf's table keeps two runs, the run in hand and the endless run beside it; the table plays one of
 * them at a time (`S.slot`), and every command for a run is aimed at that one (`slot: "endless"`
 * for the endless run).
 *
 * What the table is showing is one value (`S.screen`, `screen.ts`), moved on only by `go`, which
 * also asks Leaf for a room's takings once its fight has been played; whoever animates the table
 * hears each move (`onScreen`).
 */
import { makeHold, openPlay, type Play, type Trouble, waitingLook } from "@sequoia-leaf/kit/play.ts";
import {
  type Almanac,
  type Catalog,
  catalogOf,
  type Era,
  isRunCommand,
  LEGACY_ERA,
  type Looks,
  newAlmanac,
  newLooks,
  predict,
  type RaidCommand,
  type RaidNote,
  readNotes,
  readView,
  refusalText,
  type Roster,
  type RunView,
  type Slot,
  type TableView,
} from "@sequoia-leaf/raid";

import { keepPrefs, newPrefs, type Prefs, readPrefs } from "./keep.ts";
import { endedOf, type Event, type Screen, step, type Table } from "./screen.ts";

/** Which of the table's two runs the page plays: the run in hand, or the endless run beside it. */
export type { Slot } from "@sequoia-leaf/raid";

export const S: {
  /** The run the table plays (`slot`), as the page's copy; while the screen shows a run that has ended, that run. */
  run: RunView | null;
  /** Which of the table's runs that is. */
  slot: Slot;
  /** Both runs laid out, as Leaf has them: the run in hand and the endless run. */
  laid: { run: RunView | null; endless: RunView | null };
  almanac: Almanac;
  looks: Looks;
  /** The trail picked to set out on next. */
  trail: number;
  /** The number of the run the table plays: runs begun at this table, or for the endless run endless runs begun. */
  runs: number;
  /** This week's deepest rooms won in each endless way, as Leaf has them. */
  week: TableView["week"];
  /** The figures the member has pulled, with their levels. */
  roster: Roster;
  /** The era Leaf's clock is in, as Leaf said it: what the page reads the catalogue by (`catalogOf`). */
  era: Era;
  prefs: Prefs;
  /** What the table is showing; moved on by `go`. */
  screen: Screen;
} = {
  run: null,
  slot: "main",
  laid: { run: null, endless: null },
  almanac: newAlmanac(),
  looks: newLooks(),
  trail: 0,
  runs: 0,
  week: { at: 0, deepest: { wilds: 0, deep: 0 } },
  roster: {},
  era: LEGACY_ERA,
  prefs: newPrefs(),
  screen: { at: "front" },
};

/**
 * The catalogue of a run's things (a seat's run is in its sitting's era), or, with no run, of Leaf's
 * view of the table: never a newer one, and never the page's own clock. A fight's things read their
 * setup's (`Fight.cat`).
 */
export const catalogFor = (run: { readonly era: Era } | null): Catalog => catalogOf(run ?? S);

/** What a command did: its notes, or the sentence it was turned down with. */
export type Did = { ok: true; notes: RaidNote[] } | { ok: false; why: string };

/**
 * The member at a live table (`live/seated.ts`), while they are at it: the run the table shows, what
 * the screen sits down to, and where their commands go instead of Leaf's solo table. The front page
 * is the solo table's, so stepping back to it lets the seat go (the live table is kept).
 */
export interface Seated {
  run(): RunView | null;
  table(): Table;
  doNow(command: RaidCommand): Did | null;
  ask(command: RaidCommand, waiting: Element | null): Promise<Did | null>;
}
export const LIVE: { seat: Seated | null } = { seat: null };

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
export const hold = makeHold();
export function heldOff(command: RaidCommand): boolean {
  if (!hold.held(STEADY.has(command.do))) return false;
  for (const fn of heldHearers) fn();
  return true;
}
/** Whether Leaf is answering a rustle, a pick, setting out or the takings: until it has, nothing more is done. */
export const busy = (): boolean => hold.held(true);

/** What the page shows, as text, to tell whether Leaf's answer changed it. */
const picture = (): string =>
  JSON.stringify([S.run, S.laid, S.almanac, S.looks, S.trail, S.runs, S.week, S.roster, S.era]);

/** The run in a slot of Leaf's table. */
const inSlot = (view: TableView, slot: Slot): RunView | null => view.held[slot];

/** Takes Leaf's state (the copy, with what is still waiting on top) into what the page shows. */
function take(view: TableView): void {
  S.almanac = view.almanac;
  S.looks = view.looks;
  S.trail = view.trail;
  S.runs = view.begun[S.slot];
  S.week = view.week;
  S.roster = view.roster;
  S.era = view.era;
  S.laid = { run: view.held.main, endless: view.held.endless };
  // A run that has ended stays on the table, for its last page, while the screen shows it.
  S.run = LIVE.seat ? LIVE.seat.run() : (inSlot(view, S.slot) ?? endedOf(S.screen)?.run ?? null);
}

/** Leaf's run in the slot the table plays (or the live seat's), as the page has it, and its number: what the screen sits down to. */
export const tableNow = (): Table =>
  LIVE.seat?.table() ?? { run: table ? inSlot(table.state, S.slot) : null, runs: S.runs };

/**
 * What a page over the table shows, as text, to tell whether it must be drawn again: the page, the
 * era Leaf's view is of (which the almanac's figures are of), the run and the runs laid out.
 */
export const pagesKey = (id: string | null): string =>
  `${id}:${S.era}:${S.runs}:${S.run?.room ?? 0}:${endedOf(S.screen) ? 1 : 0}:${laidKey()}`;

/** Where both runs laid out stand, as text: what their strips on the front page say. */
export const laidKey = (): string =>
  [S.laid.run, S.laid.endless].map((r) => (r ? `${r.room}.${r.record.length}.${r.resolve}` : "-")).join(":");

/** Has the table play the run in a slot, from the front page. */
export function playSlot(slot: Slot): void {
  S.slot = slot;
  if (table) take(table.state);
}

/** A command as it is sent: one for a run is aimed at the run the table plays. */
const aimed = (command: RaidCommand): RaidCommand =>
  S.slot === "endless" && isRunCommand(command) ? { ...command, slot: "endless" } : command;

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
      if (S.screen.at === "front") LIVE.seat = null;
      if (table) take(table.state);
      // At a live table the clock settles the room.
      if (S.screen.at === "after" && before.at === "fight" && !LIVE.seat) void settleRoom();
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
  const answer = await hold.until(false, play.send(aimed({ do: "take" })));
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
export function doNow(asked: RaidCommand): Did | null {
  if (LIVE.seat) return LIVE.seat.doNow(asked);
  const play = table;
  const command = aimed(asked);
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
export async function ask(asked: RaidCommand, waiting: Element | null = null): Promise<Did | null> {
  if (LIVE.seat) return LIVE.seat.ask(asked, waiting);
  const play = table;
  const command = aimed(asked);
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
