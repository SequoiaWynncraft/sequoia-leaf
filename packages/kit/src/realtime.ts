/**
 * Live, the game's side: being in a room on Leaf with other players, and seeing them move as it
 * happens (the wire is `@sequoia-leaf/core`'s `live.ts`; the server is `apps/api/src/live`).
 *
 * `joinLive(room, ears)` opens the connection and keeps it open: after a drop it connects again
 * within a moment, and keeps trying while Leaf is away, waiting longer each time up to five seconds
 * (`LIVE_BACKOFF`), at once when the page comes back to the front or the network returns; then it
 * joins the room again, and says where the player is again (Leaf shows others that as a jump). A
 * try that has not opened by the kit's deadline is let go as one that did not open, and an open
 * connection that has gone silent is closed and opened again. Where the connection is, is one
 * value (`Conn`: down, connecting, open, gone), moved only by `stepConn`. A page goes from room to
 * room on the one connection (`go`), and may step out of every room and keep it (`go(null)`): Leaf
 * is told it left, and told again on any connection that comes back meanwhile; back, or into
 * another room, the page joins on the same connection and is welcomed, so going about opens nothing
 * (Leaf allows a player only so many openings). A welcome to a room the page has asked to leave
 * meanwhile is answered by asking for the one it wants. Why a connection closed is
 * its close code alone (`CLOSE`): told the player opened the game live somewhere else, or that
 * their session ended, this page lets go. A browser cannot see why a connection would not open, so after a few tries
 * that did not, the page asks Leaf whether the player is still signed in, and lets go if not. With
 * no Leaf there is no server, and it does nothing.
 *
 * What this page knows of the room starts at a welcome, each time: who is in it, where they have
 * been, and Leaf's clock. Nothing heard before a welcome counts, and a new connection's picture
 * replaces the old one only then, so nothing of one room, or one connection, is mixed with another's.
 * In a room of the town it hears who is about elsewhere in the game, and gives it the page's
 * presence: Leaf's lists, as it comes in, and each change to them after (`AboutHeard`).
 * In a visit's room (core's `visitRoom`) it hears what Leaf does to the state visited (`did`), and in
 * a camp's (`campRoom`) when the owner changed it (`changed`); what was done while it was not in the
 * room is never told, so a page hears a welcome after a drop as the moment to read the state again.
 *
 * What it does not do is draw anybody. A page asks it each frame where somebody is to be drawn
 * (`sample`): their motion `INTERP_MS` behind the newest snapshots as they reach this page
 * (`Playout`), between the two snapshots either side of that moment, so that everybody moves
 * smoothly and only where they have been, whatever the network's delay and unevenness.
 */

import {
  CLIENT_HZ,
  CLOSE,
  decodeSnapshot,
  encodeMove,
  type GameId,
  type LiveMember,
  livePath,
  type Motion,
  parsePlayerId,
  readToClient,
  reconnects,
  type ToClient,
  type ToServer,
  visitRoom,
} from "@sequoia-leaf/core";

import { AboutHeard } from "./about.ts";
import { device, type LetGo, member } from "./live.ts";
import { ask, type Backoff, backoff, type LiveSocket, outside } from "./net.ts";
import { Playout, Track } from "./playout.ts";
import { askAgain, heardAbout, inRoom } from "./presence.ts";

// What a page needs of the wire to draw who is in its room.
export { Flag, type LiveMember, type Motion } from "@sequoia-leaf/core";

// ---------- Leaf's clock ----------

/** How far Leaf's clock is ahead of this page's, as any room on the page last heard. */
let leafAhead = 0;
/**
 * Leaf's clock at a moment of this page's (`now`), as last heard: between connections and out of
 * a room the last word stands, so nothing timed by it jumps. The page's own until a room has heard.
 */
export const leafClock = (now: number): number => now + leafAhead;

/**
 * Leaf's clock as this page can know it, from pings: each answer says how far Leaf's clock is from
 * this one, give or take half the round trip. The answer that came back quickest is the best guess,
 * so the offset is the one from the quickest of the last few. Until a ping comes back, the welcome's.
 */
export class ClockSync {
  private readonly samples: { rtt: number; offset: number }[] = [];
  private best: number;

  constructor(server: number, now: number) {
    this.best = server - now;
  }

  /** A pong: `sent` is this page's clock when the ping went (as it came back), `server` Leaf's, `now` this page's. */
  add(sent: number, server: number, now: number): void {
    const rtt = Math.max(0, now - sent);
    this.samples.push({ rtt, offset: server - (sent + rtt / 2) });
    if (this.samples.length > 8) this.samples.shift();
    this.best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
  }

  /** Leaf's clock now. */
  server(now: number): number {
    return now + this.best;
  }

  /** The quickest round trip lately, in milliseconds; null before any ping came back. */
  rtt(): number | null {
    return this.samples.length === 0 ? null : Math.min(...this.samples.map((s) => s.rtt));
  }
}

// ---------- sending the player's motion ----------

/** Where the page says its player is: a motion, but for the jump, which `joinLive` counts itself. */
export type Step = Omit<Motion, "jump">;

const same = (a: Motion, b: Motion): boolean =>
  a.x === b.x &&
  a.y === b.y &&
  a.vx === b.vx &&
  a.vy === b.vy &&
  a.facing === b.facing &&
  a.pose === b.pose &&
  a.flags === b.flags &&
  a.jump === b.jump;

/**
 * When to send the player's newest motion, given the last one sent and when: at once when it is the
 * first, or they started or stopped or jumped (those cannot wait); not at all when nothing changed;
 * otherwise once `CLIENT_HZ` allows. Returns the delay in milliseconds, or null for none.
 */
export function sendIn(m: Motion, sent: Motion | null, sentAt: number, now: number): number | null {
  if (sent === null || m.flags !== sent.flags || m.jump !== sent.jump) return 0;
  if (same(m, sent)) return null;
  return Math.max(0, 1000 / CLIENT_HZ - (now - sentAt));
}

// ---------- the connection ----------

export type LiveStatus = "connecting" | "open" | "closed" | "replaced" | "signedout";

/** What a page hears from its room. Every one is optional. */
export interface LiveEars {
  /**
   * In the room (again, after a reconnect): who is there. Anybody heard of before and not in it has
   * gone; but `restarted` (the connection before it was closed because Leaf was restarting) they may
   * only not be back yet, every page having been told to come back at the same moment.
   */
  welcome?(you: number, room: string, roster: readonly LiveMember[], restarted: boolean): void;
  joined?(m: LiveMember): void;
  left?(id: number): void;
  act?(id: number, kind: string, arg: string): void;
  /** In a visit's room: a batch of commands Leaf has just done to the state visited (core's `did`), with the commands' ids when Leaf sends them. */
  did?(rev: number, did: readonly unknown[], after: unknown, ids?: readonly string[]): void;
  /** In a camp's room: the owner changed the camp, as Leaf kept it at `rev` (core's `changed`). */
  changed?(rev: number): void;
  status?(s: LiveStatus): void;
}

export interface LiveRoom {
  /** Everybody in the room, the player too, by their number. */
  members(): ReadonlyMap<number, LiveMember>;
  /** The player's own number in the room, once in it. */
  you(): number | null;
  /**
   * Says where the player is and how they move, `jumped` when they did not walk there. It goes at
   * most `CLIENT_HZ` times a second, and only when it changed; starting, stopping and a jump at
   * once, and the last change always.
   */
  move(step: Step, jumped?: boolean): void;
  /** Something the player did that others see once: one of core's `ACTS`. */
  act(kind: string, arg: string): void;
  /** Where somebody is to be drawn now: `INTERP_MS` behind the newest snapshots as they reach the page (`Playout`). */
  sample(id: number): Motion | null;
  /** Leaf's clock now, as far as this page can tell. */
  serverNow(): number;
  /** The quickest round trip to Leaf lately, in milliseconds. */
  rtt(): number | null;
  /**
   * Goes into a room of a kind (core's `ROOMS`, a camp's), or steps out of every room (`null`),
   * keeping the connection: out, the page is in no room and shows nobody; into one, it joins on the
   * same connection, and shows nobody until the welcome follows.
   */
  go(room: string | null): void;
  /** Where the page stands with its room just now (`RoomState`). */
  state(): RoomState;
  /** Leaves the room and closes the connection for good. */
  close(): void;
}

/**
 * Where a page stands with its room, from its connection's one state (`Conn`): in it; away from it
 * by its own choice; on its way in; lost by a drop `ms` milliseconds ago, and trying again; or let
 * go of for good.
 */
export type RoomState =
  | { readonly at: "in" }
  | { readonly at: "away" }
  | { readonly at: "joining" }
  | { readonly at: "down"; readonly ms: number }
  | { readonly at: "gone"; readonly why: Gone };

// ---------- trying again ----------

/**
 * How the page connects again after a drop: a quarter of a second, doubling to five seconds, each
 * with up to a quarter more by chance. A drop because Leaf is restarting starts at the second wait
 * (`firstTry`).
 */
export const LIVE_BACKOFF: Backoff = { first: 250, most: 5000, jitter: 0.25 };

/** The first try's number after a drop with this close code: Leaf restarting is given half a second, not a quarter. */
export const firstTry = (code: number): number => (code === CLOSE.restart ? 1 : 0);

/** The soonest the page tries again of its own accord (`wake`) after its last try, in milliseconds. */
export const SOONEST = 1000;

/**
 * Whether to ask Leaf why, after this many tries in a row that did not open: after the third, and
 * every fifth after that.
 */
export const askWhy = (failed: number): boolean => failed >= 3 && (failed - 3) % 5 === 0;

/** Pings: quickly at first, to learn the clock, then now and then, to keep it. */
const PING_FIRST = 1000;
const PING_EVERY = 10_000;

/** Nothing from Leaf for this long on an open connection, the page asking all the while, and it is dead. */
export const SILENT_MS = 15_000;
/** How long a ping goes unanswered before the quiet counts against the connection. */
const ANSWER_MS = 5000;

/**
 * Whether an open connection has gone dead: nothing has come from Leaf for `SILENT_MS` (`heard` is
 * when anything last came), and a ping went out after that at least `ANSWER_MS` ago. The page pings
 * every ten seconds, so on a page in front that is fifteen seconds of quiet; a page whose timers
 * were held in the background was not asking, and its own quiet is not counted against Leaf.
 */
export const silent = (heard: number, pinged: number | null, now: number): boolean =>
  pinged !== null && pinged >= heard && now - heard >= SILENT_MS && now - pinged >= ANSWER_MS;

/** The address of Leaf's live connection into a room, next to the page, saying what the page is on. */
const liveUrl = (room: string): string => {
  const url = new URL(livePath(room), outside.href());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const on = device();
  if (on !== null) url.searchParams.set("device", on);
  return url.toString();
};

// ---------- where the connection is ----------

/** Why a page let go of its room for good: Leaf said so (`LetGo`), or the page closed it. */
export type Gone = LetGo | "closed";

/**
 * Where a page's connection to its room is, and the one connection whose picture of the room is
 * shown (`shown`: the last welcomed, kept through a drop until the next welcome, and none while the
 * page is away). `L` is a connection; `tries` counts the tries since the last welcome (how long the
 * next wait is), `failed` the tries in a row that did not open (when to ask Leaf why), `restart`
 * whether the last connection that opened was closed because Leaf was restarting, `away` whether
 * the page has stepped out of the room while keeping its connection, and `downSince` when the room
 * was lost by a drop (the page's clock), until the next welcome.
 *
 * - `down`: no connection; the next try is due at `retryAt`, and the last began at `lastTry`.
 * - `connecting`: a try begun at `since`, not open yet; let go if it has not opened by the deadline.
 *   Opening it is joining the room (the room is in its address).
 * - `open`: open, and where it stands with the room (`room`): `joining` until Leaf's welcome; `in`
 *   once welcomed (`shown === link`); `out` once it has told Leaf it left, while the page is away.
 * - `gone`: let go of for good; nothing is shown or tried any more.
 */
export type Conn<L> =
  | ({ readonly at: "down"; readonly lastTry: number; readonly retryAt: number } & Counted<L>)
  | ({ readonly at: "connecting"; readonly link: L; readonly since: number } & Counted<L>)
  | ({
      readonly at: "open";
      readonly link: L;
      readonly since: number;
      readonly room: "joining" | "in" | "out";
    } & Counted<L>)
  | { readonly at: "gone"; readonly why: Gone };

/** What a connection not let go of carries from one place to the next. */
interface Counted<L> {
  readonly shown: L | null;
  readonly tries: number;
  readonly failed: number;
  readonly restart: boolean;
  readonly away: boolean;
  readonly downSince: number | null;
}

/**
 * What moves a connection on: one try begun, opened, welcomed or dropped (a close code), the page
 * back, Leaf's word, or the page's: stepping out of the room or back into it (`away`), or done.
 */
export type ConnEvent<L> =
  | { readonly do: "try"; readonly link: L; readonly now: number }
  | { readonly do: "opened"; readonly link: L }
  | { readonly do: "welcomed"; readonly link: L }
  | { readonly do: "dropped"; readonly link: L; readonly code: number; readonly now: number; readonly chance: number }
  | { readonly do: "wake"; readonly now: number }
  | { readonly do: "letGo"; readonly why: LetGo }
  | { readonly do: "away"; readonly on: boolean }
  | { readonly do: "close" };

/** A connection before its first try: due at once. */
export const firstConn = <L>(): Conn<L> => ({
  at: "down",
  shown: null,
  tries: 0,
  failed: 0,
  restart: false,
  away: false,
  downSince: null,
  lastTry: -Infinity,
  retryAt: -Infinity,
});

/**
 * The one way a connection moves on. Anything about a connection that is not the current one, or
 * that cannot happen where it is, leaves it as it is; nothing moves a connection let go of.
 *
 * - A drop with a code that does not reconnect (`reconnects`) lets go: `replaced`, or `signedout`.
 * - Any other drop is down until the next try, after a wait by `LIVE_BACKOFF`: the first after a
 *   welcome by the code (`firstTry`), each after it longer. A try that opened and dropped says why
 *   the room was left (`restart`); one that did not open counts as failed.
 * - Back (`wake`), a try still opening after `SOONEST` is let go and tried again at once, and a
 *   wait is cut to `SOONEST` after the last try where that is sooner.
 * - Leaf's word that the player is signed out lets go, unless the connection is open.
 * - Away, the page shows no room; an open connection in it steps out (`out`), and one still joining
 *   steps out as its welcome comes. Back, an open connection out of the room joins it again
 *   (`joining`); any other joins as it opens. A drop, or a try let go, is when the room was lost
 *   (`downSince`), until a welcome.
 */
export function stepConn<L>(c: Conn<L>, e: ConnEvent<L>): Conn<L> {
  if (c.at === "gone") return c;
  switch (e.do) {
    case "close":
      return { at: "gone", why: "closed" };
    case "letGo":
      return c.at === "open" ? c : { at: "gone", why: e.why };
    case "away": {
      if (c.away === e.on) return c;
      if (!e.on)
        return c.at === "open" && c.room === "out" ? { ...c, away: false, room: "joining" } : { ...c, away: false };
      return c.at === "open" && c.room === "in"
        ? { ...c, away: true, shown: null, room: "out" }
        : { ...c, away: true, shown: null };
    }
    case "try": {
      if (c.at !== "down") return c;
      const { shown, tries, failed, restart, away, downSince } = c;
      return { at: "connecting", shown, link: e.link, since: e.now, tries, failed, restart, away, downSince };
    }
    case "opened":
      return c.at === "connecting" && c.link === e.link ? { ...c, at: "open", failed: 0, room: "joining" } : c;
    case "welcomed": {
      if (c.at !== "open" || c.link !== e.link) return c;
      const met = { tries: 0, restart: false, downSince: null };
      return c.away ? { ...c, ...met, room: "out" } : { ...c, ...met, shown: e.link, room: "in" };
    }
    case "dropped": {
      if (c.at === "down" || c.link !== e.link) return c;
      if (!reconnects(e.code)) return { at: "gone", why: e.code === CLOSE.replaced ? "replaced" : "signedout" };
      const opened = c.at === "open";
      const tries = opened && c.shown === c.link ? firstTry(e.code) : c.tries;
      return {
        at: "down",
        shown: c.shown,
        tries: tries + 1,
        failed: opened ? 0 : c.failed + 1,
        restart: opened ? e.code === CLOSE.restart : c.restart,
        away: c.away,
        downSince: c.downSince ?? e.now,
        lastTry: c.since,
        retryAt: e.now + backoff(LIVE_BACKOFF, tries, e.chance),
      };
    }
    case "wake": {
      if (c.at === "connecting" && e.now - c.since >= SOONEST) {
        const { shown, tries, failed, restart, away, since } = c;
        const downSince = c.downSince ?? e.now;
        return {
          at: "down",
          shown,
          tries,
          failed: failed + 1,
          restart,
          away,
          downSince,
          lastTry: since,
          retryAt: e.now,
        };
      }
      if (c.at !== "down") return c;
      const soonest = Math.max(e.now, c.lastTry + SOONEST);
      return soonest < c.retryAt ? { ...c, retryAt: soonest } : c;
    }
  }
}

/** Where a page stands with its room (`RoomState`), from its connection at a moment of the page's clock. */
export function roomState(c: Conn<unknown>, now: number): RoomState {
  if (c.at === "gone") return { at: "gone", why: c.why };
  if (c.away) return { at: "away" };
  if (c.at === "open" && c.room === "in") return { at: "in" };
  return c.downSince === null ? { at: "joining" } : { at: "down", ms: now - c.downSince };
}

/** What one connection knows of the room. Made afresh for each, and shown only once its welcome came. */
interface Link {
  readonly socket: LiveSocket;
  readonly people: Map<number, LiveMember>;
  readonly tracks: Map<number, Track>;
  clock: ClockSync | null;
  /** When to draw others, from when this connection's snapshots came. */
  playout: Playout;
  you: number | null;
  /** When anything last came from Leaf on it, and when it last sent a ping (this page's clock). */
  heard: number;
  pinged: number | null;
  /** Who is about, as this connection has heard it since its welcome. */
  readonly about: AboutHeard;
}

const NOBODY: ReadonlyMap<number, LiveMember> = new Map();

/** Stops a timer, if there is one; says there is none now. */
const stop = (t: ReturnType<typeof setTimeout> | null): null => {
  if (t) clearTimeout(t);
  return null;
};

/** The connection open and in the room, if it is. */
const inside = (c: Conn<Link>): Link | null => (c.at === "open" && c.room === "in" ? c.link : null);
/** The connection on its way or open now, if there is one. */
const current = (c: Conn<Link>): Link | null => (c.at === "connecting" || c.at === "open" ? c.link : null);

/** What the room a page is in said on its connection, but for its welcome and its pongs, told to the page's ears. */
function roomSaid(l: Link, m: ToClient, ears: LiveEars): void {
  switch (m.t) {
    case "joined":
      l.people.set(m.member.id, m.member);
      return ears.joined?.(m.member);
    case "left":
      l.people.delete(m.id);
      l.tracks.delete(m.id);
      return ears.left?.(m.id);
    case "act":
      return ears.act?.(m.id, m.kind, m.arg);
    case "did":
      return ears.did?.(m.rev, m.did, m.after, m.ids);
    case "changed":
      return ears.changed?.(m.rev);
    case "about":
      return m.v === undefined ? heardAbout(m.who) : l.about.given(m.v, m.who);
    case "aboutChanged":
      return l.about.changed(m);
    case "error":
    case "welcome":
    case "pong":
      return;
  }
}

/**
 * Puts the player in a room on Leaf, live. Without Leaf it does nothing, and nobody is ever there.
 * Where the connection is, is `conn` alone, moved only by `stepConn` (in `move`, which then does what
 * the new place asks: a socket's deadline, pings, a wait, a status for the page).
 */
export function joinLive(first: string, ears: LiveEars = {}): LiveRoom {
  /** The room the page wants to be in, or was last in while it is out of every room. */
  let room = first;
  let conn: Conn<Link> = member() === null ? { at: "gone", why: "closed" } : firstConn();
  /** The wait of the place the connection is in: a try's deadline, the open one's watch, or the next try. */
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pinger: ReturnType<typeof setTimeout> | null = null;
  /** How many acts may be sent now, and when that was last counted. */
  let acts = 5;
  let actedAt = outside.now();
  // The player's motion: as the page last said it, as last sent, and when, and a send waiting its turn.
  let motion: Motion | null = null;
  let sent: Motion | null = null;
  let sentAt = 0;
  let seq = 0;
  let later: ReturnType<typeof setTimeout> | null = null;

  const status = (s: LiveStatus): void => ears.status?.(s);
  const say = (l: Link, m: ToServer): void => l.socket.send(JSON.stringify(m));
  const shown = (): Link | null => (conn.at === "gone" ? null : conn.shown);

  function sendNow(): void {
    later = stop(later);
    const l = inside(conn);
    if (!l || !motion) return;
    seq = (seq + 1) & 0xffff;
    l.socket.send(encodeMove(seq, motion));
    sent = motion;
    sentAt = outside.now();
  }

  function want(m: Motion): void {
    motion = m;
    const wait = sendIn(m, sent, sentAt, outside.now());
    if (wait === 0) return sendNow();
    if (wait === null || later) return;
    later = setTimeout(sendNow, wait);
  }

  function pingOnce(l: Link): void {
    l.pinged = outside.now();
    say(l, { t: "ping", c: l.pinged });
  }

  function ping(l: Link, n: number): void {
    if (current(conn) !== l) return;
    pingOnce(l);
    pinger = setTimeout(() => ping(l, n + 1), n < 5 ? PING_FIRST : PING_EVERY);
  }

  /**
   * Keeps an eye on an open connection: gone silent, it is closed, and the page connects again. Quiet
   * with no ping out (the page's timers were held), it asks now, and looks again once the answer is due.
   */
  function watch(l: Link): void {
    timer = stop(timer);
    if (conn.at !== "open" || conn.link !== l) return;
    const now = outside.now();
    if (silent(l.heard, l.pinged, now)) {
      // The browser may take a long while to notice; this page stops waiting for it.
      l.socket.close(CLOSE.done, "silent");
      return move({ do: "dropped", link: l, code: CLOSE.done, now, chance: Math.random() });
    }
    if (now - l.heard >= SILENT_MS && (l.pinged === null || l.pinged < l.heard)) pingOnce(l);
    const due = Math.max(l.heard + SILENT_MS, (l.pinged ?? 0) + ANSWER_MS);
    timer = setTimeout(() => watch(l), Math.max(50, due - now));
  }

  // Whoever hears the status may close the room from inside it: each is said only once the change
  // it tells of is complete, and nothing is done after it that a close would undo.

  /** Moves the connection on (`stepConn`), and does what its new place asks. */
  function move(e: ConnEvent<Link>): void {
    const was = conn;
    const next = stepConn(was, e);
    if (next === was) return;
    conn = next;
    // Out of the room by the page's choice: it says where the player is itself meanwhile.
    if (next.at !== "gone" && was.at !== "gone" && next.away && !was.away) inRoom(null);
    if (next.at === "open" && was.at === "open") {
      // In and out of the room on the open connection, Leaf told each way; a welcome does the rest itself.
      if (next.room === "out" && was.room !== "out") say(next.link, { t: "leave" });
      if (next.room === "joining" && was.room === "out") say(next.link, { t: "join", room });
      return;
    }
    timer = stop(timer);
    if (next.at !== "open") pinger = stop(pinger);
    const now = outside.now();
    switch (next.at) {
      case "connecting":
        // A try that has not opened by the deadline (from when it began) is let go, as one that did not open.
        timer = setTimeout(
          () => {
            next.link.socket.close(CLOSE.done, "late");
            move({ do: "dropped", link: next.link, code: CLOSE.done, now: outside.now(), chance: Math.random() });
          },
          Math.max(0, next.since + outside.deadline - now),
        );
        if (was.at !== "connecting") status("connecting");
        return;
      case "open":
        next.link.heard = now;
        ping(next.link, 0);
        watch(next.link);
        return status("open");
      case "down": {
        // Out of the room until the next welcome: the page says where the player is itself meanwhile.
        inRoom(null);
        const fresh = was.at !== "down";
        if (fresh && askWhy(next.failed)) void findOutWhy();
        if (fresh) status("closed");
        if (conn !== next) return;
        if (next.retryAt <= now) return tryNow();
        timer = setTimeout(tryNow, next.retryAt - now);
        return;
      }
      case "gone": {
        pinger = stop(pinger);
        later = stop(later);
        unwake();
        const l = current(was);
        if (was.at === "open" && was.room !== "out" && next.why === "closed") say(was.link, { t: "leave" });
        l?.socket.close(CLOSE.done, "bye");
        inRoom(null);
        if (next.why !== "closed") status(next.why);
        return;
      }
    }
  }

  /** A welcome, on a connection: to a room the page has asked to leave meanwhile, it asks for the one it wants. */
  function welcomed(l: Link, m: Extract<ToClient, { t: "welcome" }>): void {
    if (conn.at !== "open" || conn.link !== l) return;
    // The room of the kind wanted, in a copy of its own (`town/1`).
    if (!conn.away && m.room.split("/")[0] !== room) return say(l, { t: "join", room });
    const restarted = conn.restart;
    move({ do: "welcomed", link: l });
    // Away, the welcome only answers the connection's opening, and the page has stepped out again.
    if (inside(conn) !== l) return;
    l.you = m.you;
    l.clock = new ClockSync(m.time, outside.now());
    l.playout = new Playout();
    l.people.clear();
    l.tracks.clear();
    l.about.forget();
    for (const r of m.roster) l.people.set(r.id, r);
    inRoom(room);
    // Whoever came or went while the page was not in the room, Leaf's list says now.
    askAgain();
    // Nothing has been sent on this connection yet: whatever the player says next goes at once.
    sent = null;
    ears.welcome?.(m.you, m.room, m.roster, restarted);
    // Said again, unless whoever heard the welcome has just said it: this room has not heard
    // from the player on this connection yet.
    if (motion && sent === null) want(motion);
  }

  function heard(l: Link, text: string): void {
    const m = readToClient(text);
    if (m?.t === "welcome") return welcomed(l, m);
    if (m?.t === "pong") return l.clock?.add(m.c, m.s, outside.now());
    // Before its welcome, and once the page has left the room it was welcomed into, nothing else counts.
    if (m && shown() === l) roomSaid(l, m, ears);
  }

  function snapshot(l: Link, data: ArrayBuffer): void {
    // Before its welcome, a connection is in no room this page asked for.
    if (l.you === null) return;
    const snap = decodeSnapshot(new Uint8Array(data));
    if (!snap) return;
    l.playout.heard(snap.time, outside.now());
    for (const entry of snap.entries) {
      if (entry.id === l.you) continue;
      let track = l.tracks.get(entry.id);
      if (!track) l.tracks.set(entry.id, (track = new Track()));
      track.add(snap.time, entry);
    }
  }

  /**
   * The connection keeps not opening, and a browser cannot see why: Leaf is asked whether the player
   * is still signed in. Signed out, the page lets go as Leaf would have told it to; anything else,
   * or no answer, and it keeps trying.
   */
  async function findOutWhy(): Promise<void> {
    const a = await ask("/v1/game/me");
    if (a.status === 401) move({ do: "letGo", why: "signedout" });
  }

  /**
   * The page is back, or the network is: an open connection is asked at once, if it has not been
   * within `SOONEST`, so it is seen to be alive or to be dead soon; anything else moves on (`stepConn`).
   */
  function wake(): void {
    const now = outside.now();
    if (conn.at === "open") {
      const l = conn.link;
      if (now - (l.pinged ?? 0) >= SOONEST) {
        pingOnce(l);
        watch(l);
      }
      return;
    }
    if (conn.at === "connecting" && now - conn.since >= SOONEST) conn.link.socket.close(CLOSE.done, "again");
    move({ do: "wake", now });
  }
  const unwake = conn.at === "gone" ? () => undefined : outside.wake(wake);

  /** The next try: a socket of its own, in the place of none. */
  function tryNow(): void {
    if (conn.at !== "down") return;
    const now = outside.now();
    const l: Link = {
      socket: outside.socket(liveUrl(room)),
      people: new Map(),
      tracks: new Map(),
      clock: null,
      playout: new Playout(),
      you: null,
      heard: now,
      pinged: null,
      about: new AboutHeard({ show: heardAbout, ask: () => say(l, { t: "about" }) }),
    };
    l.socket.binaryType = "arraybuffer";
    l.socket.addEventListener("open", () => move({ do: "opened", link: l }));
    l.socket.addEventListener("message", (e) => {
      if (current(conn) !== l) return;
      l.heard = outside.now();
      if (typeof e.data === "string") heard(l, e.data);
      else if (e.data instanceof ArrayBuffer) snapshot(l, e.data);
    });
    l.socket.addEventListener("close", (e) =>
      move({ do: "dropped", link: l, code: e.code, now: outside.now(), chance: Math.random() }),
    );
    move({ do: "try", link: l, now });
  }

  tryNow();

  return {
    members: () => shown()?.people ?? NOBODY,
    you: () => shown()?.you ?? null,
    move(step, jumped = false) {
      const jump = motion?.jump ?? 0;
      want({ ...step, jump: jumped ? (jump + 1) & 0xff : jump });
    },
    act(kind, arg) {
      // Held a little under what Leaf allows (3 a second, 6 at once): one it would refuse is not
      // sent, so tapping away at a thing costs the player nothing with Leaf.
      const now = outside.now();
      acts = Math.min(5, acts + ((now - actedAt) / 1000) * 2.5);
      actedAt = now;
      const l = inside(conn);
      if (acts < 1 || !l) return;
      acts--;
      say(l, { t: "act", kind, arg });
    },
    sample(id) {
      const l = shown();
      const time = l?.playout.time(outside.now()) ?? null;
      return time === null ? null : (l?.tracks.get(id)?.at(time) ?? null);
    },
    serverNow() {
      const clock = shown()?.clock;
      if (clock) leafAhead = clock.server(0);
      return leafClock(outside.now());
    },
    rtt: () => shown()?.clock?.rtt() ?? null,
    go(next) {
      const moved = next !== null && next !== room;
      room = next ?? room;
      // Into another room: out of the one it is in, and into that.
      if (moved) move({ do: "away", on: true });
      move({ do: "away", on: next === null });
    },
    state: () => roomState(conn, outside.now()),
    close() {
      move({ do: "close" });
    },
  };
}

/**
 * Joins the room of a visit to a player's state in a game (`visitRoom`), to hear what Leaf does to it
 * (`did`) as `joinLive` hears any room; none for somebody who is not a player.
 */
export function joinVisit(game: GameId, player: string, ears: LiveEars = {}): LiveRoom | null {
  const visited = parsePlayerId(player);
  return visited === undefined ? null : joinLive(visitRoom(game, visited), ears);
}
