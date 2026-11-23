/**
 * Where the game is being played: on the guild's own server, as a real member, or anywhere else (a
 * file server), where there is no Leaf and every page shows the card that says so. Every page
 * awaits `start()` before anything else. It asks the page's own server `GET /v1/game/hello`; no
 * answer, or anything but that answer, is no server. With a server it asks who the member is:
 *
 * - known: the game is live, as them, and the purse keeps the ledger's Leaf and Leaf's Coins;
 * - known as a guest (signed in, not in the guild): the game is live, as them, with the ledger's
 *   Leaf and Leaf's Coins, and the page asks nothing that is only for members (`/v1/me...`, the guild's news);
 * - signed out: the whole window goes to the guild's sign-in and comes back, once; refused again
 *   within a minute, or in a frame, it says so on a card instead;
 * - not a member (a server that lets in only members), or the server is having trouble: a card says so.
 *
 * The cards (`shutCard`) are the same on every page.
 */

import { type Device, deviceForWidth } from "@sequoia-leaf/core";

import { el } from "./dom.ts";
import { ask, isRecord, listen, type Listening, outside } from "./net.ts";
import type { Trouble } from "./play.ts";
import {
  asGuest,
  balance,
  coinsOnLeaf,
  fromLeaf,
  fromLedger,
  heardCoins,
  leafSpending,
  refreshCoins,
  watch,
} from "./purse.ts";
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

/** The member's Coins as `/v1/game/me` says them, or null for anything that does not say. */
export function readCoins(v: unknown): number | null {
  const coins = isRecord(v) ? num(v.coins) : null;
  return coins === null ? null : Math.max(0, Math.floor(coins));
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
    fromLedger(member.leaf);
    leafSpending(isRecord(hello.body) && hello.body.leaf_spending === true);
    // From here on the purse's Coins are Leaf's ledger's, guest or member.
    fromLeaf(readCoins(me.body) ?? 0);
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

/** Puts a card over the page: a title, a line (if not empty) and one button. */
function card(title: string, line: string, word: string, go: () => void): void {
  const button = el("button", "k-btn wide", { type: "button" }, word);
  button.addEventListener("click", go);
  const paper = el(
    "section",
    "k-paper k-rise k-shut",
    { role: "alertdialog", "aria-label": title },
    el("h1", "k-title big", { text: title }),
    line === "" ? null : el("p", "", { text: line }),
    button,
  );
  document.body.append(el("div", "k-scrim", {}, paper));
  button.focus();
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
 * signed out or turned away, the state Leaf keeps not reading, or no Leaf with the play service
 * answering, which `line` says in the game's words. A game that can be visited says its own card
 * for nothing to visit (`pageCard`); any other is shown it as closed.
 */
export function troubleCard(why: Trouble, signIn: string, line: string): void {
  if (why === "unreadable") unreadableCard();
  else if (why === "noserver") serverCard(line);
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
  const go = el("button", "k-btn wide", { type: "button" }, word);
  const paper = el(
    "section",
    "k-paper k-rise k-shut",
    { role: "alertdialog", "aria-label": title },
    el("h1", "k-title big", { text: title }),
    el("p", "", { text: line }),
    go,
  );
  const scrim = el("div", "k-scrim k-let-go", {}, paper);
  const away = (): void => {
    scrim.remove();
  };
  go.addEventListener("click", () => {
    if (why === "signedout") return goSignIn(signIn);
    away();
    again();
  });
  document.body.append(scrim);
  go.focus();
  return away;
}

// ---------- the member's own news ----------

/**
 * Asks Leaf for the player again, and the purse takes the Leaf the ledger gives them: after the
 * member's news, or a command that took Leaf. The player as Leaf has them, or null for no answer
 * or the made-up guild (nothing is asked).
 */
export async function refreshLeaf(): Promise<Member | null> {
  if (!member()) return null;
  const a = await ask("/v1/game/me");
  const m = a.status === 200 ? readMember(a.body) : null;
  if (!m) return null;
  fromLedger(m.leaf);
  return m;
}

/**
 * Listens to what happens to the member and asks the ledger for their Leaf again whenever anything
 * does. `heard` is told each event, and `fresh` the member as the server has them after it. It
 * listens from the newest event when the member was first looked at (`cursor`), so anything paid
 * since, before the stream opened, is heard at once. A guest has no news of their own, and nothing
 * is listened to.
 */
export function followLeaf(
  heard: (type: string, data: unknown, id: number) => void = () => undefined,
  fresh: (me: Member) => void = () => undefined,
): Listening {
  if (isGuest()) return { stop: () => undefined };
  const since = member()?.cursor;
  // A raid paid out to a party arrives as a handful of events at once: one question covers them.
  let asking = false;
  async function again(): Promise<void> {
    const m = await refreshLeaf();
    asking = false;
    if (m) fresh(m);
  }
  return listen(
    "/v1/me/events/stream",
    (e) => {
      heard(e.type, e.data, e.id);
      if (asking) return;
      asking = true;
      setTimeout(() => void again(), 400);
    },
    since === undefined ? {} : { after: since },
  );
}

// ---------- the member's Leaf in a game in the town ----------

/**
 * Keeps the member's Leaf and Coins up to date in a game for as long as it is open. A game takes
 * them once, as it starts. In the town's frame the town hears the member's news, and says each new
 * number the ledger gives (`passLeaf`), and each change to its Coins (`passCoins`); the purse takes
 * the Leaf as it takes a fresh read of the ledger, and the Coins as Leaf's. Opened on its own, the
 * game listens to the member's news itself, as the town does, and asks Leaf for the Coins whenever
 * it comes back into view (`followCoins`). Returns how to stop.
 */
export function keepLeaf(): () => void {
  if (inTown()) {
    return fromTown((msg) => {
      if (msg.town === "leaf" && member()) fromLedger(msg.leaf);
      else if (msg.town === "coins" && member()) heardCoins(msg.coins);
    });
  }
  if (!member()) return () => undefined;
  const away = followCoins();
  if (isGuest()) return away;
  const ears = followLeaf();
  return () => {
    away();
    ears.stop();
  };
}

/** The page came back into view, or went out of it: back in view, the purse asks Leaf for the Coins. */
function inViewAgain(): void {
  if (document.visibilityState === "visible") refreshCoins();
}

/**
 * On the guild's server, asks Leaf for the member's Coins whenever the page comes back into view:
 * another page of the game, or another device, may have earned or spent some meanwhile. Returns
 * how to stop.
 */
export function followCoins(): () => void {
  if (typeof document === "undefined" || !coinsOnLeaf()) return () => undefined;
  document.addEventListener("visibilitychange", inViewAgain);
  return () => document.removeEventListener("visibilitychange", inViewAgain);
}

/** What `passLeaf` and `passCoins` give the town: say what is owed once the game is ready, and stop. */
export interface Passing {
  ready(): void;
  stop(): void;
}

/**
 * Passes each new number the purse holds of one kind to `say`, from when the game is ready: a change
 * while it is still opening waits for `ready()` and is said then.
 */
function pass(kind: "leaf" | "coins", say: (n: number) => void): Passing {
  let n = balance()[kind];
  let heard = false;
  let owed = false;
  const stop = watch((p) => {
    if (p[kind] === n) return;
    n = p[kind];
    if (heard) say(n);
    else owed = true;
  });
  return {
    ready() {
      heard = true;
      if (!owed) return;
      owed = false;
      say(n);
    },
    stop() {
      stop();
    },
  };
}

/**
 * In the town, while a game is open in its frame: passes each new Leaf the guild's ledger gives
 * the member to `say`, which tells the game. A game hears nothing until it is ready, so a change
 * while it is still opening waits for `ready()` and is said then.
 */
export const passLeaf = (say: (leaf: number) => void): Passing => pass("leaf", say);

/** In the town, while a game is open in its frame: passes each change to the town's Coins to `say`, as `passLeaf` does Leaf. */
export const passCoins = (say: (coins: number) => void): Passing => pass("coins", say);
