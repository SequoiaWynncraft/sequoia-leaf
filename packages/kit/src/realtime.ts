/**
 * Live, the game's side: being in a room on Leaf with other players, and seeing them move as it
 * happens (the wire is `@sequoia-leaf/core`'s `live.ts`; the server is `apps/api/src/live`).
 *
 * `joinLive(room, ears)` opens the connection and keeps it open: after a drop it connects again
 * within a moment, and keeps trying every second or so while Leaf is away (`retryAfter`), at once
 * when the page comes back to the front or the network returns; then it joins the room again, and
 * says where the player is again (Leaf shows others that as a jump). An open connection that has
 * gone silent is closed and opened again. Why a connection closed is its close code alone
 * (`CLOSE`): told the player opened the game live somewhere else, or that their session ended,
 * this page lets go. A browser cannot see why a connection would not open, so after a few tries
 * that did not, the page asks Leaf whether the player is still signed in, and lets go if not. With
 * no Leaf there is no server, and it does nothing.
 *
 * What this page knows of the room starts at a welcome, each time: who is in it, where they have
 * been, and Leaf's clock. Nothing heard before a welcome counts, and a new connection's picture
 * replaces the old one only then, so nothing of one room, or one connection, is mixed with another's.
 * In a visit's room (core's `visitRoom`) it hears what Leaf does to the state visited (`did`); what
 * was done while it was not in the room is never told, so a page hears a welcome after a drop as the
 * moment to read the state again.
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
  INTERP_MS,
  type LiveMember,
  livePath,
  type Motion,
  parsePlayerId,
  readToClient,
  reconnects,
  type ToServer,
  visitRoom,
} from "@sequoia-leaf/core";

import { device, member } from "./live.ts";
import { ask, type LiveSocket, outside } from "./net.ts";
import { askAgain, inRoom } from "./presence.ts";

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

// ---------- when to draw others ----------

/** How many of the latest snapshots' times on the way the playout goes by. */
const TRANSITS = 40;
/** The most the slowest snapshots lately may put the moment drawn back, in milliseconds, however uneven the network. */
const MOST_UNEVEN = 1500;
/** How much faster or slower than its own clock the moment drawn may run while it settles: a tenth. */
const SETTLE = 0.1;

/**
 * The moment of Leaf's clock to draw others at. A snapshot stamped `time` reaches this page some
 * while later by its own clock: the network's delay, and how far the two clocks differ, together.
 * The page draws at its own clock less the time most snapshots lately took (all but the slowest
 * tenth), less `INTERP_MS`, so that the moment drawn has a snapshot on either side of it however
 * slow and uneven the network is. Drawn behind Leaf's clock as it is instead, a page whose snapshots
 * take longer than `INTERP_MS` would have nothing past the newest to draw but a guess, and somebody
 * stopping or turning would be seen overshooting and coming back. The moment drawn settles towards
 * a new delay by at most a tenth of the time passing, so that nobody is ever drawn jumping or going
 * back when the network changes.
 */
export class Playout {
  private readonly transits: number[] = [];
  /** How far behind this page's clock the moment drawn is, and when that was last worked out. */
  private behind: number | null = null;
  private at = 0;

  /** A snapshot stamped `time` by Leaf's clock came at `now` by this page's. */
  heard(time: number, now: number): void {
    this.transits.push(now - time);
    if (this.transits.length > TRANSITS) this.transits.shift();
  }

  /** The moment of Leaf's clock to draw others at, at `now` by this page's clock; null before any snapshot came. */
  time(now: number): number | null {
    if (this.transits.length === 0) return null;
    const sorted = this.transits.toSorted((a, b) => a - b);
    const quickest = sorted[0] ?? 0;
    const most = sorted[Math.ceil((sorted.length - 1) * 0.9)] ?? quickest;
    const want = quickest + Math.min(most - quickest, MOST_UNEVEN) + INTERP_MS;
    if (this.behind === null) this.behind = want;
    else {
      const step = Math.max(0, now - this.at) * SETTLE;
      this.behind += Math.max(-step, Math.min(step, want - this.behind));
    }
    this.at = now;
    return now - this.behind;
  }
}

// ---------- somebody's track ----------

/** The longest a track keeps, in milliseconds of Leaf's clock. */
const KEEP_MS = 2500;

/** Somebody's motion as snapshots told it, and where they are to be drawn at any moment of Leaf's clock. */
export class Track {
  private readonly points: { time: number; m: Motion }[] = [];

  add(time: number, m: Motion): void {
    const last = this.points.at(-1);
    if (last && time < last.time) return;
    if (last && time === last.time) this.points.pop();
    this.points.push({ time, m });
    while (this.points.length > 2 && (this.points[1]?.time ?? 0) < time - KEEP_MS) this.points.shift();
  }

  /**
   * Where they are at `time`: between the snapshots either side of it, or where the newest has them
   * if none is newer yet: never anywhere they have not been. Between two snapshots with different
   * jumps they are drawn where they were, then where they jumped to, never on the way.
   */
  at(time: number): Motion | null {
    const pts = this.points;
    const first = pts[0];
    const last = pts.at(-1);
    if (!first || !last) return null;
    if (time <= first.time) return first.m;
    if (time >= last.time) return last.m;
    let i = pts.length - 1;
    while (i > 0 && (pts[i - 1]?.time ?? 0) > time) i--;
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) return last.m;
    if (a.m.jump !== b.m.jump) return a.m;
    const k = (time - a.time) / Math.max(1, b.time - a.time);
    return { ...a.m, x: a.m.x + (b.m.x - a.m.x) * k, y: a.m.y + (b.m.y - a.m.y) * k };
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
  /** In a visit's room: a batch of commands Leaf has just done to the state visited (core's `did`). */
  did?(rev: number, did: readonly unknown[], after: unknown): void;
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
  /** Leaves the room and closes the connection for good. */
  close(): void;
}

// ---------- trying again ----------

/**
 * How long to wait before the next try after a drop, by how many tries there have been since it
 * (`tries`, 0 before the first) and how long the connection has been down (`down`, ms): a quarter
 * of a second, then half, then a second each time for the first thirty seconds, two for the next
 * minute, and five after that; each with up to a quarter more by `chance` (0 to 1), so that pages
 * dropped together do not all come back in the same instant. A drop because Leaf is restarting
 * starts at the second wait (`firstTry`).
 */
export function retryAfter(tries: number, down: number, chance: number): number {
  const wait = tries <= 0 ? 250 : tries === 1 ? 500 : down < 30_000 ? 1000 : down < 90_000 ? 2000 : 5000;
  return wait * (1 + chance / 4);
}

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

/** What one connection knows of the room. Made afresh for each, and shown only once its welcome came. */
interface Link {
  readonly socket: LiveSocket;
  readonly people: Map<number, LiveMember>;
  readonly tracks: Map<number, Track>;
  clock: ClockSync | null;
  /** When to draw others, from when this connection's snapshots came. */
  playout: Playout;
  you: number | null;
  open: boolean;
  /** When anything last came from Leaf on it, and when it last sent a ping (this page's clock). */
  heard: number;
  pinged: number | null;
}

const NOBODY: ReadonlyMap<number, LiveMember> = new Map();

/** Stops a timer, if there is one; says there is none now. */
const stop = (t: ReturnType<typeof setTimeout> | null): null => {
  if (t) clearTimeout(t);
  return null;
};

/** Puts the player in a room on Leaf, live. Without Leaf it does nothing, and nobody is ever there. */
export function joinLive(room: string, ears: LiveEars = {}): LiveRoom {
  /** The connection open now, if any; and the one whose picture of the room is shown. */
  let link: Link | null = null;
  let shown: Link | null = null;
  let done = member() === null;
  /** How many acts may be sent now, and when that was last counted. */
  let acts = 5;
  let actedAt = outside.now();
  // Since the last welcome: when the connection went down, how many tries since, how many in a row
  // did not open, and when the last one began.
  let downSince: number | null = null;
  /** Whether the last connection was closed because Leaf was restarting. */
  let restarting = false;
  let tries = 0;
  let failed = 0;
  let lastTry = 0;
  /** The try waiting its turn, and when it is due. */
  let retry: ReturnType<typeof setTimeout> | null = null;
  let retryAt = 0;
  let pinger: ReturnType<typeof setTimeout> | null = null;
  let watcher: ReturnType<typeof setTimeout> | null = null;
  // The player's motion: as the page last said it, as last sent, and when, and a send waiting its turn.
  let motion: Motion | null = null;
  let sent: Motion | null = null;
  let sentAt = 0;
  let seq = 0;
  let later: ReturnType<typeof setTimeout> | null = null;

  const status = (s: LiveStatus): void => ears.status?.(s);
  const say = (l: Link, m: ToServer): void => l.socket.send(JSON.stringify(m));

  function sendNow(): void {
    later = stop(later);
    const l = shown;
    if (!l || l !== link || !motion) return;
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
    if (link !== l) return;
    pingOnce(l);
    pinger = setTimeout(() => ping(l, n + 1), n < 5 ? PING_FIRST : PING_EVERY);
  }

  /**
   * Keeps an eye on an open connection: gone silent, it is closed, and the page connects again. Quiet
   * with no ping out (the page's timers were held), it asks now, and looks again once the answer is due.
   */
  function watch(l: Link): void {
    watcher = stop(watcher);
    if (link !== l || !l.open) return;
    const now = outside.now();
    if (silent(l.heard, l.pinged, now)) {
      // The browser may take a long while to notice; this page stops waiting for it.
      l.socket.close(CLOSE.done, "silent");
      return dropped(l, CLOSE.done);
    }
    if (now - l.heard >= SILENT_MS && (l.pinged === null || l.pinged < l.heard)) pingOnce(l);
    const due = Math.max(l.heard + SILENT_MS, (l.pinged ?? 0) + ANSWER_MS);
    watcher = setTimeout(() => watch(l), Math.max(50, due - now));
  }

  function heard(l: Link, text: string): void {
    const m = readToClient(text);
    if (!m) return;
    switch (m.t) {
      case "welcome": {
        downSince = null;
        tries = 0;
        l.you = m.you;
        l.clock = new ClockSync(m.time, outside.now());
        l.playout = new Playout();
        l.people.clear();
        l.tracks.clear();
        for (const r of m.roster) l.people.set(r.id, r);
        shown = l;
        inRoom(room);
        // Whoever came or went while the page was not in the room, Leaf's list says now.
        askAgain();
        // Nothing has been sent on this connection yet: whatever the player says next goes at once.
        sent = null;
        const restarted = restarting;
        restarting = false;
        ears.welcome?.(m.you, m.room, m.roster, restarted);
        // Said again, unless whoever heard the welcome has just said it: this room has not heard
        // from the player on this connection yet.
        if (motion && sent === null) want(motion);
        return;
      }
      case "joined":
        l.people.set(m.member.id, m.member);
        if (shown === l) ears.joined?.(m.member);
        return;
      case "left":
        l.people.delete(m.id);
        l.tracks.delete(m.id);
        if (shown === l) ears.left?.(m.id);
        return;
      case "act":
        if (shown === l) ears.act?.(m.id, m.kind, m.arg);
        return;
      case "did":
        if (shown === l) ears.did?.(m.rev, m.did, m.after);
        return;
      case "pong":
        l.clock?.add(m.c, m.s, outside.now());
        return;
      case "about":
        if (shown === l) askAgain();
        return;
      case "error":
        return;
    }
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

  // Whoever hears the status may close the room from inside it: each is said only once the change
  // it tells of is complete, and nothing is done after it that a close would undo.

  /** Lets go of the room for good: nothing of it is shown any more, and nothing is tried again. */
  function letGo(why: "replaced" | "signedout"): void {
    done = true;
    shown = null;
    retry = stop(retry);
    pinger = stop(pinger);
    watcher = stop(watcher);
    unwake();
    const l = link;
    link = null;
    l?.socket.close(CLOSE.done, "bye");
    inRoom(null);
    status(why);
  }

  /** The connection is gone: tried again after a wait, or let go of for good, by why it closed. */
  function dropped(l: Link, code: number): void {
    link = null;
    // Out of the room until the next welcome: the page says where the player is itself meanwhile.
    inRoom(null);
    pinger = stop(pinger);
    watcher = stop(watcher);
    if (done) return;
    if (!reconnects(code)) return letGo(code === CLOSE.replaced ? "replaced" : "signedout");
    // A try that did not open says nothing new of why the room was left.
    if (l.open) restarting = code === CLOSE.restart;
    const now = outside.now();
    if (downSince === null) {
      downSince = now;
      tries = firstTry(code);
    }
    if (!l.open) failed++;
    const wait = retryAfter(tries++, now - downSince, Math.random());
    retryAt = now + wait;
    retry = setTimeout(connect, wait);
    if (askWhy(failed)) void findOutWhy();
    status("closed");
  }

  /**
   * The connection keeps not opening, and a browser cannot see why: Leaf is asked whether the player
   * is still signed in. Signed out, the page lets go as Leaf would have told it to; anything else,
   * or no answer, and it keeps trying.
   */
  async function findOutWhy(): Promise<void> {
    const a = await ask("/v1/game/me");
    if (done || link?.open || a.status !== 401) return;
    letGo("signedout");
  }

  /**
   * The page is back, or the network is: a waiting try goes now, or as soon after the last as
   * `SOONEST` allows, if that is sooner than it would have.
   */
  function wake(): void {
    if (done) return;
    const now = outside.now();
    const l = link;
    if (l?.open) {
      // Open as far as the browser knows: asked at once, it is seen to be alive, or to be dead soon.
      if (now - (l.pinged ?? 0) >= SOONEST) {
        pingOnce(l);
        watch(l);
      }
      return;
    }
    const soonest = lastTry + SOONEST;
    if (retry === null || retryAt <= soonest) return;
    retry = stop(retry);
    if (soonest <= now) return connect();
    retryAt = soonest;
    retry = setTimeout(connect, soonest - now);
  }
  const unwake = done ? () => undefined : outside.wake(wake);

  function connect(): void {
    retry = null;
    if (done) return;
    lastTry = outside.now();
    const l: Link = {
      socket: outside.socket(liveUrl(room)),
      people: new Map(),
      tracks: new Map(),
      clock: null,
      playout: new Playout(),
      you: null,
      open: false,
      heard: lastTry,
      pinged: null,
    };
    link = l;
    l.socket.binaryType = "arraybuffer";
    l.socket.addEventListener("open", () => {
      if (link !== l) return;
      // Opening it is entering the room: Leaf's welcome comes first.
      l.open = true;
      l.heard = outside.now();
      failed = 0;
      ping(l, 0);
      watch(l);
      status("open");
    });
    l.socket.addEventListener("message", (e) => {
      if (link !== l) return;
      l.heard = outside.now();
      if (typeof e.data === "string") heard(l, e.data);
      else if (e.data instanceof ArrayBuffer) snapshot(l, e.data);
    });
    l.socket.addEventListener("close", (e) => {
      if (link === l) dropped(l, e.code);
    });
    status("connecting");
  }

  connect();

  return {
    members: () => shown?.people ?? NOBODY,
    you: () => shown?.you ?? null,
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
      if (acts < 1 || !link || shown !== link) return;
      acts--;
      say(link, { t: "act", kind, arg });
    },
    sample(id) {
      const time = shown?.playout.time(outside.now()) ?? null;
      return time === null ? null : (shown?.tracks.get(id)?.at(time) ?? null);
    },
    serverNow() {
      if (shown?.clock) leafAhead = shown.clock.server(0);
      return leafClock(outside.now());
    },
    rtt: () => shown?.clock?.rtt() ?? null,
    close() {
      done = true;
      for (const t of [retry, pinger, watcher, later]) stop(t);
      unwake();
      if (link?.open) say(link, { t: "leave" });
      link?.socket.close(CLOSE.done, "bye");
      link = null;
      shown = null;
      inRoom(null);
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
