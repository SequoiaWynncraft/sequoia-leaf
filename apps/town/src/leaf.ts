/**
 * The member's town and camp on the page. Both are Leaf's: the page opens them from the guild's
 * server (`openTown`), holds a copy to draw from (`town()`, its camp `mine()`), and sends everything
 * the member does as a command:
 *
 * - `doNow`, for what the shared rules work out on the copy (setting out, moving, turning, putting
 *   away, a present taken, the tray looked in, a lantern lit, the mail read, the crab spotted, a
 *   pet chosen, staying in town): shown at once, and sent;
 * - `ask`, for what only Leaf can answer (the arrival letter put away, a caller greeted, the chest,
 *   buying): sent, and shown when Leaf answers. Meanwhile nothing more is done (the kit's one rule),
 *   but one purchase may follow another.
 *
 * Whenever Leaf's state is not what the page was showing (another page of the member's acted, a
 * caller arrived, a guess was wrong), the page takes Leaf's and draws again. While the member is in
 * their own camp the page asks Leaf for the state every half minute, which is how a caller arrives.
 * It tells Leaf the member is still here (`here`) every five minutes while the page is in view, and
 * as the page is put away. While a game is open over the town, the town tells and reads nothing: the
 * game calls Leaf itself.
 *
 * A visit to somebody else's camp opens theirs beside the member's own (`openCamp`), as Leaf gives
 * a visitor it, and the camp on show is theirs (`shown()`) until the member leaves (`lookAt`). The
 * member's own town stays open meanwhile, but nothing is sent: `doNow` and `ask` refuse, and the
 * camp looked at is read again every half minute, at once when the tab comes back, and at once when
 * its room hears the owner changed it (`campChanged`).
 */

import { pageCard, troubleCard as kitTroubleCard } from "@sequoia-leaf/kit/live.ts";
import { outside } from "@sequoia-leaf/kit/net.ts";
import { askPerson } from "@sequoia-leaf/kit/person.ts";
import { makeHold, openPlay, type Play, type Trouble, waitingLook } from "@sequoia-leaf/kit/play.ts";
import { catalogOf } from "@sequoia-leaf/raid/content/catalog.ts";
import { predict, readNotes, readView, type TownCommand, type TownNote, type TownView } from "@sequoia-leaf/town";
import { type Camp, MOST_OWNED, WHY_NOT } from "@sequoia-leaf/town/camp.ts";
import { nameCarvings } from "@sequoia-leaf/town/things.ts";

/** What a command did: its notes, or the code it was refused with. */
export type Did = { notes: TownNote[] } | { refused: string };

/** Whether a command was done (and not refused, or held off). */
export const ok = (did: Did | null): did is { notes: TownNote[] } => did !== null && "notes" in did;

/** What the page says of a refusal, where it says anything. */
const WORDS: Readonly<Record<string, string>> = {
  ...WHY_NOT,
  plenty: `You have ${MOST_OWNED}, the most you can have.`,
  not_enough_coins: "Not enough Coins.",
};
export const refusal = (code: string): string => WORDS[code] ?? "That could not be done just now.";

/** How often the page asks Leaf for the town while the member is in their camp. */
export const LOOK_EVERY = 30_000;
/** How often the page tells Leaf the member is still here, while it is in view. */
export const HERE_EVERY = 5 * 60_000;

type TownPlay = Play<TownView, TownCommand, TownNote>;
const READER = { view: readView, notes: readNotes };

let leaf: TownPlay | null = null;
/** Who the page is signed in as. */
let me = "";
const hold = makeHold();
const hearers: ((differs: boolean) => void)[] = [];

/** The town as the page shows it: Leaf's, with what is still on its way worked out on top. */
export function town(): TownView {
  if (!leaf) throw new Error("the town is not open");
  return leaf.state;
}
/** The member's own camp, as the page shows it. */
export const mine = (): Camp => town().camp;

/** Somebody else's camp the member is at: whose, and Leaf's copy of it as a visitor is given it. */
export interface Looked {
  readonly id: string;
  readonly name: string;
  readonly play: TownPlay;
}
let looked: Looked | null = null;

/** Whose camp the member is visiting, or null at their own (or in town): what each part of a visit asks. */
export const visiting = (): Looked | null => looked;

/** Whose camp a camp on the stage is, by its owner's id: the one visited, or else the member's own. */
export const whoseCamp = (): string => looked?.id ?? me;

/** The town as a camp shows it: in a visit, the camp looked at; else the member's own. */
export const shown = (): TownView => looked?.play.state ?? town();

/** Hears each change to the copy: done here, or Leaf's state taking its place (`differs` when it was not what was shown). */
export const onTown = (fn: (differs: boolean) => void): void => void hearers.push(fn);
const tell = (differs: boolean): void => {
  for (const fn of hearers) fn(differs);
};

/**
 * Opens the town from Leaf, for the member the page is signed in as (`player`). Says why it could
 * not; after that, whatever stops the page sending is told to `trouble`.
 */
/** Who is told what stops the page sending (`openTown`'s `trouble`), for a camp looked at too. */
let troubled: (why: Trouble) => void = () => {};

export async function openTown(player: string, trouble: (why: Trouble) => void): Promise<Trouble | null> {
  // Under a game it opened, the town says nothing of itself: the game calls Leaf.
  const opened = await openPlay<TownView, TownCommand, TownNote>("town", READER, {
    player,
    away: () => told?.inGame() === true,
  });
  if ("trouble" in opened) return opened.trouble;
  me = player;
  leaf = opened;
  troubled = trouble;
  nameCarvings(catalogOf(opened.state));
  opened.onTrouble(trouble);
  opened.onState((view, differs) => {
    nameCarvings(catalogOf(view));
    tell(differs);
  });
  return null;
}

/**
 * Opens somebody's camp from Leaf, as a visitor is given it, for `lookAt` to show; or says why not.
 * Their name is asked of Leaf meanwhile, when it is not known.
 */
export async function openCamp(id: string, name?: string): Promise<Looked | Trouble> {
  const [opened, said] = await Promise.all([
    openPlay<TownView, TownCommand, TownNote>("town", READER, { player: me, of: id }),
    name === undefined ? askPerson(id) : null,
  ]);
  if ("trouble" in opened) return opened.trouble;
  // Signed out, or let go, while looking at this camp: said as for the member's own town.
  opened.onTrouble((why) => {
    if (looked?.play === opened) troubled(why);
  });
  opened.onState((_view, differs) => {
    if (looked?.play === opened) tell(differs);
  });
  return { id, name: name ?? said?.name ?? "Someone", play: opened };
}

/** Whether the page is out of sight: a camp visited is read again as it comes back, not before. */
const hidden = (): boolean => typeof document !== "undefined" && document.hidden;

/**
 * Leaf says the owner has changed the camp the member is visiting, as it kept it at `rev` (the camp's
 * room hears it): it is read again at once, and once more if the read was one on its way before then.
 */
export async function campChanged(rev: number): Promise<void> {
  const at = looked;
  if (!at || at.play.rev >= rev || hidden()) return;
  await at.play.refresh();
  if (looked === at && at.play.rev < rev) await at.play.refresh();
}

/**
 * The page has come into the room of a camp (`welcome`), after walking there or after a drop: a
 * camp being visited is read again, for whatever the owner changed before the room could say so.
 * A read already on its way may have left before then, so it is waited for and the camp read after it.
 */
export async function campEntered(): Promise<void> {
  const at = looked;
  if (!at || hidden()) return;
  await at.play.refresh();
  if (looked === at) await at.play.refresh();
}

/** Shows a camp opened (`openCamp`); with null, the member's own again. The camp shown before is put away. */
export function lookAt(at: Looked | null): void {
  if (looked !== null && looked !== at) looked.play.close();
  looked = at;
}

/** What the kit's card says where no Leaf answers. */
export const NEEDS_LEAF = "The town needs the guild's server.";

/** Puts the town away behind the kit's card for why Leaf will not open it; for nothing to visit, with the way to the member's own camp. */
export function troubleCard(why: Trouble): void {
  if (why === "nothing")
    pageCard("No camp to visit", "", "My camp", () => {
      outside.go(`?camp=${encodeURIComponent(me)}`);
    });
  else kitTroubleCard(why);
}

/**
 * The things set out that Leaf has not answered for yet, by the page's own number for each, and
 * Leaf's number to come (null: Leaf did not set it out). The page's own numbers are below nothing,
 * so none is ever one Leaf gives; the copy shows a thing by it until Leaf's state comes with its own.
 */
const unnumbered = new Map<number, Promise<number | null>>();
let marked = 0;

/** The number of the thing a command set out, as its notes give it. */
const setOutIn = (notes: readonly TownNote[]): number | null => notes.find((n) => n.t === "setOut")?.n ?? null;

/** A command's prediction with the thing it sets out numbered `mark` instead of the next of the copy's counter. */
function markedAs(
  guess: { view: TownView; notes: TownNote[] },
  mark: number | null,
): { view: TownView; notes: TownNote[] } {
  const n = setOutIn(guess.notes);
  if (mark === null || n === null) return guess;
  const placed = guess.view.camp.placed.map((p) => (p.n === n ? { ...p, n: mark } : p));
  return {
    view: { ...guess.view, camp: { ...guess.view.camp, placed } },
    notes: guess.notes.map((note) => (note.t === "setOut" ? { ...note, n: mark } : note)),
  };
}

/**
 * Does a command the shared rules work out on the copy: shows it at once and sends it. A command
 * they turn down is not sent, and its refusal is given back. Null for one that must be asked, for
 * one held off while Leaf answers another, and for one naming a thing set out that Leaf has not
 * numbered yet (nothing is done or sent: `numbered`). In a visit, refused. A thing set out is
 * numbered by the page below nothing until Leaf answers (`setOutAs`).
 */
export function doNow(command: TownCommand, now = Date.now()): Did | null {
  if (looked) return { refused: "visiting" };
  const play = leaf;
  if (!play || hold.held(false)) return null;
  if ("n" in command && command.n < 0) return null;
  const mark = command.do === "setOut" ? -++marked : null;
  const guess = predict(play.state, command, now);
  if (!guess) return null;
  if ("refused" in guess) return guess;
  const answer = play.send(command, (copy) => {
    const redone = predict(copy, command, now);
    return redone && "view" in redone ? markedAs(redone, mark).view : copy;
  });
  if (mark !== null) {
    const leafs = (async () => {
      const a = await answer;
      unnumbered.delete(mark);
      return "notes" in a ? setOutIn(a.notes) : null;
    })();
    unnumbered.set(mark, leafs);
  }
  tell(false);
  return { notes: markedAs(guess, mark).notes };
}

/** The page's own number for the thing a command it did set out (`doNow`), below nothing until Leaf numbers it. */
export const setOutAs = (did: Did): number | null => ("notes" in did ? setOutIn(did.notes) : null);

/**
 * The number Leaf gave a thing the page knows as `n`: `n` itself, unless it is one the page gave a
 * thing just set out, when it is Leaf's once Leaf answers (null: Leaf did not set it out).
 */
export async function numbered(n: number): Promise<number | null> {
  return n >= 0 ? n : ((await unnumbered.get(n)) ?? null);
}

/**
 * Sends a command only Leaf can answer, and gives what it did when Leaf answers; `waiting` shows the
 * kit's waiting look meanwhile. What it paid or took comes in the purse with the answer. Null, with
 * nothing sent, for one held off while Leaf answers another. In a visit, refused.
 */
export async function ask(command: TownCommand, waiting: Element | null = null): Promise<Did | null> {
  if (looked) return { refused: "visiting" };
  const play = leaf;
  const steady = command.do === "buy";
  if (!play || hold.held(steady)) return null;
  const answer = await hold.until(steady, waitingLook(waiting, play.send(command)));
  tell(false);
  return answer;
}

/** Whether anything sent to Leaf has not been answered yet. */
export const waitingForLeaf = (): boolean => leaf?.waiting() ?? false;

/** Asks Leaf for the town again: for when something was staged from outside, or another page acted. */
export async function again(): Promise<void> {
  await leaf?.refresh();
}

/** Reads the camp the member is in (`inCamp`) again: the one looked at in a visit, else their own town; nothing elsewhere. */
export async function lookAgain(inCamp: boolean): Promise<void> {
  if (inCamp) await (looked ? looked.play.refresh() : again());
}

interface Told {
  /** Whether the arrival letter has been put away. */
  readonly home: () => boolean;
  /** Whether the member is in a camp, theirs or somebody's, and not walking off from it. */
  readonly inCamp: () => boolean;
  /** Whether a game is open over the town. */
  readonly inGame: () => boolean;
  /** How far the member's news has been told. */
  readonly cursor: () => number | null;
}
let told: Told | null = null;

/** Tells Leaf the member is here, with their news told as far as `cursor()`: once `home()`, and not in a visit. */
export function here(): void {
  if (told?.home() && !looked) doNow({ do: "here", cursor: told.cursor() });
}

/** As the page is put away: the member is said to be here, and everything Leaf has not answered is sent. */
function goingAway(): void {
  if (!told?.inGame()) here();
  leaf?.flush();
}

/**
 * Keeps Leaf told while the page is open: every half minute, while `inCamp()`, the camp is read: the
 * town at the member's own, the camp looked at in a visit, which is read as the tab comes back too.
 * A camp being walked off from is read no more, so that a stay in the next counts from its first
 * read (`Tallies.visited`). Every five minutes while in view, and as the page is put away, the member
 * is said to be `here`; in a visit, nothing is told. While `inGame()`, neither is done.
 */
export function keepTold(o: Told): void {
  if (typeof window === "undefined") return;
  told = o;
  window.setInterval(() => {
    if (!document.hidden && !o.inGame()) void lookAgain(o.inCamp());
  }, LOOK_EVERY);
  window.setInterval(() => {
    if (!document.hidden && !o.inGame()) here();
  }, HERE_EVERY);
  window.addEventListener("pagehide", goingAway);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") goingAway();
    else if (looked) void looked.play.refresh();
  });
}
