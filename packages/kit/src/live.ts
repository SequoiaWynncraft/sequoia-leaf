/**
 * Where the game is being played: on the guild's own server, as a real member, or anywhere else
 * (the lab, a file server), with the made-up guild. Every page awaits `start()` before anything
 * else. It asks the page's own server `GET /v1/game/hello`; no answer, or anything but that answer,
 * is no server, and the game plays as it always has. With a server it asks who the member is:
 *
 * - known: the game is live, as them, and the purse keeps the ledger's Leaf;
 * - signed out: the whole window goes to the guild's sign-in and comes back, once; refused again
 *   within a minute, or in a frame, it says so on a card instead;
 * - not a member, or the server is having trouble: a card says so.
 *
 * The cards (`shutCard`) are the same on every page.
 */

import { el } from "./dom.ts";
import { ask, isRecord, listen, type Listening, outside } from "./net.ts";
import { fromLedger } from "./purse.ts";
import { inTown, leave, tell } from "./shell.ts";

export interface Member {
  /** Their block-game account's id. */
  id: string;
  name: string;
  /** Their rank in the guild as the guild writes it, or null for somebody let in without one. */
  rank: string | null;
  leaf: number;
  level: { number: number; into: number; next: number };
  /** The id of the newest thing that happened to them; 0 if nothing has. */
  cursor: number;
}

/** Why the game will not open: signed out, not one of the guild, the server in trouble, or gone to sign in. */
export type Shut = "signedout" | "member" | "closed" | "signin";

export type Where =
  { mode: "madeup" } | { mode: "live"; me: Member; signIn: string } | { mode: "shut"; why: Shut; signIn: string };

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
  return { id, name, rank, leaf, level: { number: level, into, next }, cursor: Math.max(0, num(v.event_cursor) ?? 0) };
}

async function look(): Promise<Where> {
  const hello = await ask("/v1/game/hello");
  const signIn = hello.status === 200 && isRecord(hello.body) ? str(hello.body.sign_in) : null;
  if (signIn === null) return { mode: "madeup" };
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
    fromLedger(member.leaf);
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

/** Finds out where the game is, once per page; every later call gives the same answer. */
export function start(): Promise<Where> {
  finding ??= look().then((w) => {
    found = w;
    return w;
  });
  return finding;
}

/** Where `start()` found the game to be; the made-up guild until it has answered. */
export const where = (): Where => found ?? { mode: "madeup" };
/** The member, when the game is live. */
export const member = (): Member | null => {
  const w = where();
  return w.mode === "live" ? w.me : null;
};

/** Forgets what `start()` found (for tests). */
export function restart(): void {
  finding = null;
  found = null;
}

// ---------- the cards for a game that will not open ----------

const CARDS: Readonly<Record<Exclude<Shut, "signin">, readonly [string, string, string]>> = {
  signedout: ["Signed out", "Sign in with the guild's website, and the gate will know you.", "Sign in"],
  member: ["Members only", "Guild Town is for Sequoia members.", "Try again"],
  closed: ["Just a moment", "The guild's books are closed for a moment. Try again.", "Try again"],
};

/**
 * Puts the page away behind the card for why it will not open: a title, a line and one button.
 * In a frame, signed out goes back to town instead of to the sign-in. On its way to sign in, the
 * page is left empty. A game in a frame says it is ready, so that the town shows its card.
 */
export function shutCard(why: Shut, signIn: string): void {
  document.body.replaceChildren();
  if (why !== "signin") {
    const framed = !outside.top();
    const [title, line, word] = CARDS[why];
    const back = why === "signedout" && framed;
    const go = el("button", "k-btn wide", { type: "button" }, back ? "Back to town" : word);
    go.addEventListener("click", () => {
      if (back) leave();
      else if (why === "signedout") goSignIn(signIn);
      else location.reload();
    });
    const card = el(
      "section",
      "k-paper k-rise k-shut",
      { role: "alertdialog", "aria-label": title },
      el("h1", "k-title big", { text: title }),
      el("p", "", { text: line }),
      go,
    );
    document.body.append(el("div", "k-scrim", {}, card));
    go.focus();
  }
  if (inTown()) tell({ town: "ready" });
}

// ---------- the member's own news ----------

/**
 * Listens to what happens to the member and asks the ledger for their Leaf again whenever anything
 * does. `heard` is told each event, and `fresh` the member as the server has them after it. It
 * listens from the newest event when the member was first looked at (`cursor`), so anything paid
 * since, before the stream opened, is heard at once.
 */
export function followLeaf(
  heard: (type: string, data: unknown, id: number) => void = () => undefined,
  fresh: (me: Member) => void = () => undefined,
): Listening {
  const since = member()?.cursor;
  // A raid paid out to a party arrives as a handful of events at once: one question covers them.
  let asking = false;
  async function again(): Promise<void> {
    const a = await ask("/v1/game/me");
    asking = false;
    const m = a.status === 200 ? readMember(a.body) : null;
    if (!m) return;
    fromLedger(m.leaf);
    fresh(m);
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
