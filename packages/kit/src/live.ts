/**
 * Where the game is being played: on the guild's own server, as a real member, or anywhere else (a
 * file server), where there is no Leaf and every page shows the card that says so. Every page
 * awaits `start()` before anything else. It asks the page's own server `GET /v1/game/hello`; no
 * answer, or anything but that answer, is no server. With a server it asks who the member is:
 *
 * - known: the game is live, as them, and the purse holds Leaf's word on their Leaf and Coins;
 * - known as a guest (signed in, not in the guild): the game is live, as them, with Leaf's word on
 *   their Leaf and Coins, and the page asks nothing that is only for members (`/v1/me...`, the guild's news);
 * - signed out: the whole window goes to the guild's sign-in and comes back, once; refused again
 *   within a minute, or in a frame, it says so on a card instead;
 * - not a member (a server that lets in only members), or the server is having trouble: a card says so.
 *
 * The cards (`shutCard`) are the same on every page.
 */

import { type Balances, type Device, deviceForWidth, readBalances } from "@sequoia-leaf/core";

import { dialog } from "./dialog.ts";
import { el } from "./dom.ts";
import { ask, isRecord, listen, type Listening, outside } from "./net.ts";
import type { Trouble } from "./play.ts";
import { asGuest, fromLeaf, leafSpending, onLeaf, said, watch } from "./purse.ts";
import { fromTown, inTown, leave, tell } from "./shell.ts";

export interface Member {
  /** Their block-game account's id. */
  id: string;
  name: string;
  /** Their rank in the guild as the guild writes it, or null for somebody let in without one. */
  rank: string | null;
  /** Whether they play as a guest: signed in, but not in the guild. A guest has their Leaf, but no quests or guild news. */
  guest: boolean;
  leaf: number;
  level: { number: number; into: number; next: number };
  /** The id of the newest thing that happened to them; 0 if nothing has. */
  cursor: number;
}

/** Why the game will not open: signed out, not one of the guild, the server in trouble, or gone to sign in. */
export type Shut = "signedout" | "member" | "closed" | "signin";

export type Where =
  { mode: "none" } | { mode: "live"; me: Member; signIn: string } | { mode: "shut"; why: Shut; signIn: string };

/** When this browser was last sent to sign in, so that a member refused again is not sent round and round. */
const SIGNED_KEY = "town.signin.v1";
const AGAIN_AFTER = 60_000;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The member from `/v1/game/me`, or null for anything that is not one. */
export function readMember(v: unknown): Member | null {
  if (!isRecord(v) || !isRecord(v.player) || !isRecord(v.level)) return null;
  const id = str(v.player.id);
  const name = str(v.player.username);
  const leaf = num(v.leaf);
  const level = num(v.level.number);
  const into = num(v.level.xp_into_level);
  const next = num(v.level.xp_for_next_level);
  if (id === null || name === null || leaf === null || level === null || into === null || next === null) return null;
  const rank = str(v.rank);
  return {
    id,
    name,
    rank,
    guest: v.guest === true,
    leaf,
    level: { number: level, into, next },
    cursor: Math.max(0, num(v.event_cursor) ?? 0),
  };
}

async function look(): Promise<Where> {
  const hello = await ask("/v1/game/hello");
  const signIn = hello.status === 200 && isRecord(hello.body) ? str(hello.body.sign_in) : null;
  if (signIn === null) return { mode: "none" };
  const me = await ask("/v1/game/me");
  const store = outside.store();
  if (me.status === 200) {
    const member = readMember(me.body);
    if (!member) return { mode: "shut", why: "closed", signIn };
    try {
      store?.removeItem(SIGNED_KEY);
    } catch {
      // Nothing was remembered.
    }
    if (member.guest) asGuest();
    leafSpending(isRecord(hello.body) && hello.body.leaf_spending === true);
    // From here on the purse is Leaf's word, guest or member.
    fromLeaf(readBalances(me.body) ?? { coins: 0, leaf: member.leaf, version: 0 });
    signedInOn = deviceForWidth(outside.width());
    return { mode: "live", me: member, signIn };
  }
  if (me.status === 401) {
    if (!outside.top() || !store) return { mode: "shut", why: "signedout", signIn };
    let last = 0;
    try {
      last = Number(store.getItem(SIGNED_KEY) ?? 0) || 0;
    } catch {
      last = 0;
    }
    const now = outside.now();
    if (now - last < AGAIN_AFTER && now >= last) return { mode: "shut", why: "signedout", signIn };
    goSignIn(signIn);
    return { mode: "shut", why: "signin", signIn };
  }
  if (me.status === 403) return { mode: "shut", why: "member", signIn };
  return { mode: "shut", why: "closed", signIn };
}

/** Sends the whole window to the guild's sign-in, to come back here after. */
function goSignIn(signIn: string): void {
  try {
    outside.store()?.setItem(SIGNED_KEY, String(outside.now()));
  } catch {
    // It still goes; it only cannot remember having gone.
  }
  outside.go(signIn + encodeURIComponent(outside.href()));
}

let finding: Promise<Where> | null = null;
let found: Where | null = null;
/** What the page is on, by how wide its window was when it signed in. */
let signedInOn: Device | null = null;

/** Finds out where the game is, once per page; every later call gives the same answer. */
export function start(): Promise<Where> {
  finding ??= look().then((w) => {
    found = w;
    return w;
  });
  return finding;
}

/** Where `start()` found the game to be; no Leaf until it has answered. */
export const where = (): Where => found ?? { mode: "none" };
/** The member, when the game is live. */
export const member = (): Member | null => {
  const w = where();
  return w.mode === "live" ? w.me : null;
};
/** Whether the game is live as a guest, who is not in the guild. */
export const isGuest = (): boolean => member()?.guest === true;
/**
 * What the page is on, a phone (under 700 CSS pixels wide when it signed in) or a desktop, for the
 * staff's record of who played; null until it is live. It is said with where the player is.
 */
export const device = (): Device | null => (member() === null ? null : signedInOn);

/** Forgets what `start()` found (for tests). */
export function restart(): void {
  finding = null;
  found = null;
  signedInOn = null;
}

// ---------- the cards for a game that will not open ----------

const CARDS: Readonly<Record<Exclude<Shut, "signin">, readonly [string, string, string]>> = {
  signedout: ["Signed out", "Sign in with the guild's website, and the gate will know you.", "Sign in"],
  // Only a server that lets in members alone answers so; the guild's own lets everyone in, guests too.
  member: ["Members only", "Guild Town is for Sequoia members.", "Try again"],
  closed: ["Just a moment", "The guild's books are closed for a moment. Try again.", "Try again"],
};

/**
 * Puts a notice over the page that must be answered: a title, a line (if not empty) and one button,
 * which does `go` (given how to take the notice away). Returns how to take it away.
 */
function card(title: string, line: string, word: string, go: (away: () => void) => void, scrimLook = ""): () => void {
  const button = el("button", "k-btn wide", { type: "button" }, word);
  const head = el("h1", "k-title big", { text: title });
  const paper = el(
    "section",
    "k-paper k-rise k-shut",
    { role: "alertdialog" },
    head,
    line === "" ? null : el("p", "", { text: line }),
    button,
  );
  const scrim = el("div", `k-scrim ${scrimLook}`.trim(), {}, paper);
  document.body.append(scrim);
  // A layer first, so that what had the focus before the notice is what has it back after.
  const done = dialog(paper, head, null);
  button.focus();
  const away = (): void => {
    scrim.remove();
    done();
  };
  button.addEventListener("click", () => go(away));
  return away;
}

/**
 * Puts the page away behind the card for why it will not open: a title, a line and one button.
 * In a frame, signed out goes back to town instead of to the sign-in. On its way to sign in, the
 * page is left empty. A game in a frame says it is ready, so that the town shows its card.
 */
export function shutCard(why: Shut, signIn: string): void {
  document.body.replaceChildren();
  if (why !== "signin") {
    const [title, line, word] = CARDS[why];
    const back = why === "signedout" && !outside.top();
    card(title, line, back ? "Back to town" : word, () => {
      if (back) leave();
      else if (why === "signedout") goSignIn(signIn);
      else location.reload();
    });
  }
  if (inTown()) tell({ town: "ready" });
}

/**
 * Puts the page away behind a card in the game's own words: a title, a line and one button, which
 * does `go`. A game in a frame says it is ready, so that the town shows the card.
 */
export function pageCard(title: string, line: string, word: string, go: () => void): void {
  document.body.replaceChildren();
  card(title, line, word, go);
  if (inTown()) tell({ town: "ready" });
}

/**
 * Puts a game away behind the card for a page opened where no Leaf answers: a game played on Leaf
 * needs the guild's server. `line` says so in the game's words.
 */
export const serverCard = (line: string): void =>
  pageCard("No server here", line, "Try again", () => location.reload());

/** What a game says when the state Leaf keeps for the player does not read. */
export const UNREADABLE = "Your game could not be read. It has been kept; tell the guild.";

/**
 * Puts a game away behind the card for a state Leaf keeps that does not read (`state_unreadable`):
 * it has been kept, and the guild is to be told. Nothing more is sent. In a frame, the button goes
 * back to town.
 */
export function unreadableCard(): void {
  const back = !outside.top();
  pageCard("Could not be read", UNREADABLE, back ? "Back to town" : "Try again", () => {
    if (back) leave();
    else location.reload();
  });
}

/**
 * Puts a game played on Leaf away behind the card for why it cannot go on (`play.ts`'s `Trouble`):
 * signed out or turned away, or the state Leaf keeps not reading. A game that can be visited says
 * its own card for nothing to visit (`pageCard`); any other is shown it as closed.
 */
export function troubleCard(why: Trouble, signIn: string): void {
  if (why === "unreadable") unreadableCard();
  else shutCard(why === "nothing" ? "closed" : why, signIn);
}

// ---------- the cards for a live room let go of ----------

/** Why a page has let go of its live room for good (`realtime.ts`): the player went live somewhere else, or their session ended. */
export type LetGo = "replaced" | "signedout";

/** What each card says: a title, a line, and its one button. */
export const LET_GO: Readonly<Record<LetGo, readonly [string, string, string]>> = {
  replaced: ["Playing somewhere else", "This page has let go of the town.", "Play here"],
  signedout: CARDS.signedout,
};

/**
 * Puts the card for a live room let go of over the page, which plays on beneath it: a title, a line
 * and one button. Playing somewhere else, the button is `again` (taking the room back); signed out,
 * it goes to the guild's sign-in and comes back. Returns how to take the card away.
 */
export function letGoCard(why: LetGo, signIn: string, again: () => void): () => void {
  const [title, line, word] = LET_GO[why];
  return card(
    title,
    line,
    word,
    (away) => {
      if (why === "signedout") return goSignIn(signIn);
      away();
      again();
    },
    "k-let-go",
  );
}

// ---------- the member's own news ----------

/**
 * Asks Leaf for the player again, and the purse takes Leaf's word on their balances: after the
 * member's news, or as the page comes back. The player as Leaf has them, or null for no answer or
 * the made-up guild (nothing is asked). A game's own commands need none of this: every answer to
 * one carries Leaf's word.
 */
export async function refreshLeaf(): Promise<Member | null> {
  if (!member()) return null;
  const a = await ask("/v1/game/me");
  const m = a.status === 200 ? readMember(a.body) : null;
  if (!m) return null;
  const word = readBalances(a.body);
  if (word) fromLeaf(word);
  return m;
}

/** How long after a piece of the member's news the purse asks Leaf again: a raid paid to a party comes as a handful at once. */
const NEWS_SETTLES = 400;

/**
 * Listens to what happens to the member and asks Leaf for their balances again a moment after
 * anything does, once for whatever came in that moment. `heard` is told each event, and `fresh`
 * the member as the server has them after it. It listens from the newest event when the member was
 * first looked at (`cursor`), so anything paid since, before the stream opened, is heard at once. A
 * guest has no news of their own, and nothing is listened to.
 */
export function followLeaf(
  heard: (type: string, data: unknown, id: number) => void = () => undefined,
  fresh: (me: Member) => void = () => undefined,
): Listening {
  if (isGuest()) return { stop: () => undefined };
  const since = member()?.cursor;
  /** The question due a moment after the first news not yet asked about. */
  let soon: ReturnType<typeof setTimeout> | null = null;
  const ears = listen(
    "/v1/me/events/stream",
    (e) => {
      heard(e.type, e.data, e.id);
      soon ??= setTimeout(() => {
        soon = null;
        void refreshLeaf().then((m) => m && fresh(m));
      }, NEWS_SETTLES);
    },
    since === undefined ? {} : { after: since },
  );
  return {
    stop() {
      ears.stop();
      if (soon !== null) clearTimeout(soon);
    },
  };
}

// ---------- the member's Leaf in a game in the town ----------

/**
 * Keeps the member's Leaf and Coins up to date in a game for as long as it is open. In the town's
 * frame, the game and the town each say Leaf's word to the other whenever theirs is newer
 * (`passPurse` in the town), and each takes the newer of the two. Opened on its own, the game
 * listens to the member's news itself, as the town does, and asks Leaf for the purse whenever it
 * comes back into view (`followPurse`). Returns how to stop.
 */
export function keepLeaf(): () => void {
  if (inTown()) {
    const heard = fromTown((msg) => {
      if (msg.town === "purse" && member()) fromLeaf(msg.purse);
    });
    const saying = watch((_p, why) => {
      const word = said();
      if (why === "Leaf" && word) tell({ town: "purse", purse: word });
    });
    return () => {
      heard();
      saying();
    };
  }
  if (!member()) return () => undefined;
  const away = followPurse();
  if (isGuest()) return away;
  const ears = followLeaf();
  return () => {
    away();
    ears.stop();
  };
}

/** The page came back into view, or went out of it: back in view, the purse asks Leaf again. */
function inViewAgain(): void {
  if (document.visibilityState === "visible") void refreshLeaf();
}

/**
 * On the guild's server, asks Leaf for the member's balances whenever the page comes back into
 * view: another page of the game, or another device, may have earned or spent some meanwhile.
 * Returns how to stop.
 */
export function followPurse(): () => void {
  if (typeof document === "undefined" || !onLeaf()) return () => undefined;
  document.addEventListener("visibilitychange", inViewAgain);
  return () => document.removeEventListener("visibilitychange", inViewAgain);
}

/** What `passPurse` gives the town: say Leaf's word once the game is ready, and stop. */
export interface Passing {
  ready(): void;
  stop(): void;
}

/**
 * In the town, while a game is open in its frame: says Leaf's word on the member's balances to
 * `say`, which tells the game, each time the purse takes a newer one; from when the game is ready,
 * when the newest is said at once.
 */
export function passPurse(say: (word: Balances) => void): Passing {
  let ready = false;
  const stop = watch((_p, why) => {
    const word = said();
    if (ready && why === "Leaf" && word) say(word);
  });
  return {
    ready() {
      ready = true;
      const word = said();
      if (word) say(word);
    },
    stop,
  };
}
