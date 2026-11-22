/**
 * The member's town and camp on the page. Both are Leaf's: the page opens them from the guild's
 * server (`openTown`), holds a copy to draw from (`town()`, its camp `mine()`), and sends everything
 * the member does as a command:
 *
 * - `doNow`, for what the shared rules work out on the copy (setting out, moving, turning, putting
 *   away, unpacking, a present taken, a lantern lit, the mail read, the crab spotted, a pet chosen,
 *   staying in town): shown at once, and sent;
 * - `ask`, for what only Leaf can answer (the arrival letter put away, a caller greeted, the chest,
 *   buying): sent, and shown when Leaf answers. Meanwhile nothing more is done (the kit's one rule),
 *   but one purchase may follow another.
 *
 * Whenever Leaf's state is not what the page was showing (another page of the member's acted, a
 * caller arrived, a guess was wrong), the page takes Leaf's and draws again. While the member is in
 * their own camp the page asks Leaf for the state every half minute, which is how a caller arrives.
 * It tells Leaf the member is still here (`here`) every five minutes while the page is in view, and
 * as the page is put away.
 *
 * A visit to somebody else's camp opens theirs beside the member's own (`openCamp`), as Leaf gives
 * a visitor it, and the camp on show is theirs (`shown()`) until the member leaves (`lookAt`). The
 * member's own town stays open meanwhile, but nothing is sent: `doNow` and `ask` refuse, and the
 * camp looked at is read again every half minute, and at once when the tab comes back.
 */

import { pageCard, troubleCard as kitTroubleCard, where } from "@sequoia-leaf/kit/live.ts";
import { outside } from "@sequoia-leaf/kit/net.ts";
import { askPerson } from "@sequoia-leaf/kit/person.ts";
import { makeHold, openPlay, type Play, type Trouble, waitingLook } from "@sequoia-leaf/kit/play.ts";
import { refreshCoins } from "@sequoia-leaf/kit/purse.ts";
import { predict, readNotes, readView, type TownCommand, type TownNote, type TownView } from "@sequoia-leaf/town";
import { type Camp, WHY_NOT } from "@sequoia-leaf/town/camp.ts";

/** What a command did: its notes, or the code it was refused with. */
export type Did = { notes: TownNote[] } | { refused: string };

/** Whether a command was done (and not refused, or held off). */
export const ok = (did: Did | null): did is { notes: TownNote[] } => did !== null && "notes" in did;

/** What the page says of a refusal, where it says anything. */
const WORDS: Readonly<Record<string, string>> = {
  ...WHY_NOT,
  trail_full: "Too many parcels are waiting by the trail. Unpack some first.",
  plenty: "You have plenty of those.",
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
  const opened = await openPlay<TownView, TownCommand, TownNote>("town", READER, { player });
  if ("trouble" in opened) return opened.trouble;
  me = player;
  leaf = opened;
  troubled = trouble;
  opened.onTrouble(trouble);
  opened.onState((_view, differs) => {
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

/** Shows a camp opened (`openCamp`); with null, the member's own again. */
export function lookAt(at: Looked | null): void {
  looked = at;
}

/** What the kit's card says where no Leaf with the play service answers. */
export const NEEDS_LEAF = "The town needs the guild's server.";

/** Puts the town away behind the kit's card for why Leaf will not open it; for nothing to visit, with the way to the member's own camp. */
export function troubleCard(why: Trouble): void {
  const w = where();
  if (why === "nothing")
    pageCard("No camp to visit", "", "My camp", () => {
      outside.go(`?camp=${encodeURIComponent(me)}`);
    });
  else kitTroubleCard(why, w.mode === "none" ? "" : w.signIn, NEEDS_LEAF);
}

/**
 * Does a command the shared rules work out on the copy: shows it at once and sends it. A command
 * they turn down is not sent, and its refusal is given back. Null for one that must be asked, and
 * for one held off while Leaf answers another (nothing is done or sent). In a visit, refused.
 */
export function doNow(command: TownCommand): Did | null {
  if (looked) return { refused: "visiting" };
  const play = leaf;
  if (!play || hold.held(false)) return null;
  const guess = predict(play.state, command, Date.now());
  if (!guess) return null;
  if ("refused" in guess) return guess;
  void play.send(command, (copy) => {
    const redone = predict(copy, command, Date.now());
    return redone && "view" in redone ? redone.view : copy;
  });
  tell(false);
  return { notes: guess.notes };
}

/**
 * Sends a command only Leaf can answer, and gives what it did when Leaf answers; `waiting` shows the
 * kit's waiting look meanwhile. What it paid or took is asked of Leaf for the purse. Null, with
 * nothing sent, for one held off while Leaf answers another. In a visit, refused.
 */
export async function ask(command: TownCommand, waiting: Element | null = null): Promise<Did | null> {
  if (looked) return { refused: "visiting" };
  const play = leaf;
  const steady = command.do === "buy";
  if (!play || hold.held(steady)) return null;
  const answer = await hold.until(steady, waitingLook(waiting, play.send(command)));
  if (command.do === "buy" || command.do === "openChest") refreshCoins();
  tell(false);
  return answer;
}

/** Whether anything sent to Leaf has not been answered yet. */
export const waitingForLeaf = (): boolean => leaf?.waiting() ?? false;

/** Asks Leaf for the town again: for when something was staged from outside, or another page acted. */
export async function again(): Promise<void> {
  await leaf?.refresh();
}

/**
 * Keeps Leaf told while the page is open: every half minute, while `inCamp()` (the member's own),
 * the town is asked for; every five minutes while in view, and as the page is put away, the member
 * is said to be here, with their news told as far as `cursor()`, once `home()` (the letter put
 * away). In a visit nothing is told, and the camp looked at is read every half minute, and as the
 * tab comes back.
 */
export function keepTold(o: { home: () => boolean; inCamp: () => boolean; cursor: () => number | null }): void {
  if (typeof window === "undefined") return;
  const here = (): void => {
    if (o.home() && !looked) doNow({ do: "here", cursor: o.cursor() });
  };
  const look = (): void => {
    if (looked) void looked.play.refresh();
    else if (o.inCamp()) void again();
  };
  window.setInterval(() => {
    if (!document.hidden) look();
  }, LOOK_EVERY);
  window.setInterval(() => {
    if (!document.hidden) here();
  }, HERE_EVERY);
  const goingAway = (): void => {
    here();
    leaf?.flush();
  };
  window.addEventListener("pagehide", goingAway);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") goingAway();
    else if (looked) void looked.play.refresh();
  });
}
