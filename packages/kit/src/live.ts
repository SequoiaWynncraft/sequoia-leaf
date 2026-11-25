/**
 * Where the game is being played: on the guild's own server, as a real member, or anywhere else (a
 * file server), where there is no Leaf and every page shows the card that says so. Every page
 * awaits `start()` before anything else. It asks the page's own server `GET /v1/game/hello`; no
 * answer, or anything but that answer, is no server. With a server it asks who the member is:
 *
 * - known: the game is live, as them, and the purse holds Leaf's word on their Leaf and Coins;
 * - known as a guest (signed in, not in the guild): the game is live, as them, with Leaf's word on
 *   their Leaf and Coins, and the page asks nothing that is only for members (`/v1/me...`, the guild's news);
 * - signed out: the gate, a card with one button, Sign in with Discord (Leaf's own sign-in, which
 *   anyone may use and members too); nothing goes there by itself. In the town's frame, the card
 *   goes back to town instead;
 * - not a member (a server that lets in only members), or the server is having trouble: a card says so.
 *
 * The cards (`shutCard`) are the same on every page. A member of the guild's Discord with no
 * Minecraft account linked is asked to link one before the town opens (`askToLink`).
 */

import { type Balances, type Device, deviceForWidth, readBalances } from "@sequoia-leaf/core";

import { dialog } from "./dialog.ts";
import { el } from "./dom.ts";
import { keepText, keptText } from "./keep.ts";
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
  /** How they signed in: on the guild's website, with a Minecraft account linked, or with Discord alone. */
  signedInWith: "sequoia" | "discord";
  /** Whether they have a Minecraft account now, however they signed in: one may have been linked since. */
  linked: boolean;
  /** Whether to ask them to link a Minecraft account: a member of the guild's Discord with none linked. */
  askLink: boolean;
}

/** Why the game will not open: signed out, not one of the guild, or the server in trouble. */
export type Shut = "signedout" | "member" | "closed";

export type Where =
  { mode: "none" } | { mode: "live"; me: Member; signIn: string } | { mode: "shut"; why: Shut; signIn: string };

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
    signedInWith: v.signed_in_with === "discord" ? "discord" : "sequoia",
    linked: v.linked === true || v.signed_in_with !== "discord",
    askLink: v.ask_link === true,
  };
}

async function look(): Promise<Where> {
  const hello = await ask("/v1/game/hello");
  const signIn = hello.status === 200 && isRecord(hello.body) ? str(hello.body.sign_in) : null;
  if (signIn === null) return { mode: "none" };
  const me = await ask("/v1/game/me");
  if (me.status === 200) {
    const member = readMember(me.body);
    if (!member) return { mode: "shut", why: "closed", signIn };
    if (member.guest) asGuest();
    leafSpending(isRecord(hello.body) && hello.body.leaf_spending === true);
    // From here on the purse is Leaf's word, guest or member.
    fromLeaf(readBalances(me.body) ?? { coins: 0, leaf: member.leaf, version: 0 });
    signedInOn = deviceForWidth(outside.width());
    return { mode: "live", me: member, signIn };
  }
  if (me.status === 401) return { mode: "shut", why: "signedout", signIn };
  if (me.status === 403) return { mode: "shut", why: "member", signIn };
  return { mode: "shut", why: "closed", signIn };
}

/** Where the town is, on this page's server. */
export const townAddress = (): string => new URL("/play/town/", outside.href()).href;

/** Where the whole window comes back to after going away: this page, or the town when the page is in its frame. */
const backTo = (): string => (outside.top() ? outside.href() : townAddress());

/**
 * Sends the whole window to Leaf's own sign-in, with Discord, to come back here after. Anyone may
 * use it, with or without a Minecraft account linked.
 */
export function signInWithDiscord(): void {
  // With its query: a link to somebody's camp (`?camp=`) or yard (`?of=`) comes back to it signed in.
  const page = new URL(backTo());
  outside.away(`/v1/game/sign-in?to=${encodeURIComponent(page.pathname + page.search)}`);
}

/**
 * Sends the whole window to the guild's sign-in (`signIn`, from hello), which has a Discord account
 * with no Minecraft account link one, and comes back here signed in on the guild's website.
 */
export function linkAccount(signIn: string): void {
  outside.away(signIn + encodeURIComponent(backTo()));
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

/** A button of a notice: its word, and what a press does, given how to take the notice away. A quiet one is smaller, under the others. */
export interface NoticeButton {
  readonly word: string;
  readonly quiet?: boolean;
  readonly go: (away: () => void) => void;
}

/**
 * A notice over the page that must be answered: a title, a line (if not empty) and its buttons. One
 * that asks something of somebody signed in, before the page opens (`ask`), is a wider card with
 * its title on one line and every word in the game's face, over a page nothing of which shows yet.
 */
export interface Notice {
  readonly title: string;
  readonly line: string;
  readonly ask?: boolean;
  readonly buttons: readonly NoticeButton[];
}

/** Loads the page again: what Try again does. */
const loadAgain = (): void => {
  outside.reload();
};

/**
 * The notice for why the game will not open. Signed out it is the gate: the town's name and one
 * button, which signs in with Discord; in the town's frame, the way back to town instead.
 */
export function shutNotice(why: Shut): Notice {
  if (why === "member")
    // Only a server that lets in members alone answers so; the guild's own lets everyone in, guests too.
    return {
      title: "Members only",
      line: "Guild Town is for Sequoia members.",
      buttons: [{ word: "Try again", go: loadAgain }],
    };
  if (why === "closed")
    return {
      title: "Just a moment",
      line: "The guild's books are closed for a moment. Try again.",
      buttons: [{ word: "Try again", go: loadAgain }],
    };
  if (!outside.top()) return { title: "Signed out", line: "", buttons: [{ word: "Back to town", go: () => leave() }] };
  return { title: "Guild Town", line: "", buttons: [{ word: "Sign in with Discord", go: signInWithDiscord }] };
}

/** Puts a notice over the page. Returns how to take it away. */
function show(notice: Notice, scrimLook = notice.ask === true ? "k-ask" : ""): () => void {
  const head = el("h1", notice.ask === true ? "k-title" : "k-title big", { text: notice.title });
  const buttons = notice.buttons.map((b) =>
    el(
      "button",
      b.quiet === true ? "k-btn slate sm wide" : "k-btn wide",
      { type: "button", onclick: () => b.go(away) },
      b.word,
    ),
  );
  const paper = el(
    "section",
    "k-paper k-rise k-shut",
    { role: "alertdialog" },
    head,
    notice.line === "" ? null : el("p", "", { text: notice.line }),
    ...buttons,
  );
  const scrim = el("div", `k-scrim ${scrimLook}`.trim(), {}, paper);
  document.body.append(scrim);
  // A layer first, so that what had the focus before the notice is what has it back after.
  const done = dialog(paper, head, null);
  buttons[0]?.focus();
  const away = (): void => {
    scrim.remove();
    done();
  };
  return away;
}

/**
 * Puts the page away behind the card for why it will not open (`shutNotice`). A game in a frame
 * says it is ready, so that the town shows its card.
 */
export function shutCard(why: Shut): void {
  document.body.replaceChildren();
  show(shutNotice(why));
  if (inTown()) tell({ town: "ready" });
}

/**
 * Puts the page away behind a card in the game's own words: a title, a line and one button, which
 * does `go`. A game in a frame says it is ready, so that the town shows the card.
 */
export function pageCard(title: string, line: string, word: string, go: () => void): void {
  document.body.replaceChildren();
  show({ title, line, buttons: [{ word, go }] });
  if (inTown()) tell({ town: "ready" });
}

// ---------- asking a member to link their account ----------

/** Kept in the tab once a member has answered Later: they are not asked again until the tab closes. */
const LATER_KEY = "leaf.link.later.v1";

/**
 * The notice that asks a member of the guild's Discord with no Minecraft account linked to link
 * one, or null where there is nothing to ask: anybody else, or a member who answered Later in this
 * tab. Link account goes to the guild's sign-in; Later takes the notice away, and `later` is called.
 */
export function linkNotice(w: Where, later: () => void): Notice | null {
  if (w.mode !== "live" || !w.me.askLink || keptText(LATER_KEY, "tab") !== null) return null;
  const { signIn } = w;
  return {
    title: "Link your Wynncraft account",
    line: "Link the account you play on to collect the Leaf your raids and wars earned.",
    ask: true,
    buttons: [
      { word: "Link account", go: () => linkAccount(signIn) },
      {
        word: "Later",
        quiet: true,
        go: (away) => {
          keepText(LATER_KEY, "1", "tab");
          away();
          later();
        },
      },
    ],
  };
}

/** Asks the member to link their account (`linkNotice`), before the town opens: done at once where there is nothing to ask, else when they answer Later. */
export function askToLink(w: Where): Promise<void> {
  return new Promise((resolve) => {
    const notice = linkNotice(w, resolve);
    if (notice) show(notice);
    else resolve();
  });
}

/**
 * Puts a game away behind the card for a page opened where no Leaf answers: a game played on Leaf
 * needs the guild's server. `line` says so in the game's words.
 */
export const serverCard = (line: string): void => pageCard("No server here", line, "Try again", loadAgain);

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
    else loadAgain();
  });
}

/**
 * Puts a game played on Leaf away behind the card for why it cannot go on (`play.ts`'s `Trouble`):
 * signed out or turned away, or the state Leaf keeps not reading. A game that can be visited says
 * its own card for nothing to visit (`pageCard`); any other is shown it as closed.
 */
export function troubleCard(why: Trouble): void {
  if (why === "unreadable") unreadableCard();
  else shutCard(why === "nothing" ? "closed" : why);
}

// ---------- the cards for a live room let go of ----------

/** Why a page has let go of its live room for good (`realtime.ts`): the player went live somewhere else, or their session ended. */
export type LetGo = "replaced" | "signedout";

/**
 * The notice for a live room let go of: a title, a line (if any) and one button. Playing somewhere
 * else, the button is `again` (taking the room back); signed out, it signs in with Discord and
 * comes back.
 */
export function letGoNotice(why: LetGo, again: () => void): Notice {
  if (why === "signedout")
    return { title: "Signed out", line: "", buttons: [{ word: "Sign in with Discord", go: signInWithDiscord }] };
  const here = (away: () => void): void => {
    away();
    again();
  };
  return {
    title: "Playing somewhere else",
    line: "This page has let go of the town.",
    buttons: [{ word: "Play here", go: here }],
  };
}

/** Puts the card for a live room let go of (`letGoNotice`) over the page, which plays on beneath it. Returns how to take the card away. */
export const letGoCard = (why: LetGo, again: () => void): (() => void) => show(letGoNotice(why, again), "k-let-go");

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
