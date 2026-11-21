/**
 * Live, the game's side: being in a room on Leaf with other players, and seeing them move as it
 * happens (the wire is `@sequoia-leaf/core`'s `live.ts`; the server is `apps/api/src/live`).
 *
 * `joinLive(room, ears)` opens the connection and keeps it open: after a drop it connects again with
 * a growing, jittered wait, joins the room again, and says where the player is again, as a jump. Why
 * a connection closed is its close code alone (`CLOSE`): told the player opened the game live
 * somewhere else, or that their session ended, this page lets go. With the made-up guild there is
 * no server, and it does nothing.
 *
 * Each connection learns the room afresh (`Link`): who is in it, where they have been, and Leaf's
 * clock. A new connection's picture replaces the old one only once it is whole, at its welcome, so
 * nothing from one connection is ever mixed with another's.
 *
 * What it does not do is draw anybody. A page asks it each frame where somebody is to be drawn
 * (`sample`): their motion as it was `INTERP_MS` ago by Leaf's clock, between the two snapshots
 * either side of that moment, so that everybody moves smoothly whatever the network does.
 */

import {
  CLIENT_HZ,
  CLOSE,
  decodeSnapshot,
  encodeMove,
  Flag,
  INTERP_MS,
  LIVE_PATH,
  LIVE_VERSION,
  type LiveMember,
  type Motion,
  readToClient,
  reconnects,
  type ToServer,
} from "@sequoia-leaf/core";

import { member } from "./live.ts";
import { type LiveSocket, outside } from "./net.ts";

// ---------- Leaf's clock ----------

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

// ---------- somebody's track ----------

/** The longest a track keeps, in milliseconds of Leaf's clock. */
const KEEP_MS = 1000;
/** The furthest ahead of the newest snapshot somebody is drawn, going on as they were. */
const AHEAD_MS = 200;

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
   * Where they are at `time`: between the snapshots either side of it, or going on from the newest
   * for a little while if none is newer yet, if they were moving. Between two snapshots with
   * different jumps they are drawn where they were, then where they jumped to, never on the way.
   */
  at(time: number): Motion | null {
    const pts = this.points;
    const first = pts[0];
    const last = pts.at(-1);
    if (!first || !last) return null;
    if (time <= first.time) return first.m;
    if (time >= last.time) {
      if ((last.m.flags & Flag.Moving) === 0) return last.m;
      const ahead = Math.min(time - last.time, AHEAD_MS) / 1000;
      return { ...last.m, x: last.m.x + last.m.vx * ahead, y: last.m.y + last.m.vy * ahead };
    }
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
  /** In the room (again, after a reconnect): who is there. Anybody heard of before and not in it has gone. */
  welcome?(you: number, room: string, roster: readonly LiveMember[]): void;
  joined?(m: LiveMember): void;
  left?(id: number): void;
  act?(id: number, kind: string, arg: string): void;
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
  /** Where somebody is to be drawn now, `INTERP_MS` behind Leaf's clock. */
  sample(id: number): Motion | null;
  /** Leaf's clock now, as far as this page can tell. */
  serverNow(): number;
  /** The quickest round trip to Leaf lately, in milliseconds. */
  rtt(): number | null;
  /** Leaves the room and closes the connection for good. */
  close(): void;
}

/** Waits before trying again after a drop: half a second, doubling to ten, each with up to half again by chance. */
export const retryAfter = (tries: number, chance: number): number =>
  Math.min(10_000, 500 * 2 ** Math.min(tries, 5)) * (1 + chance / 2);

/** Pings: quickly at first, to learn the clock, then now and then, to keep it. */
const PING_FIRST = 1000;
const PING_EVERY = 10_000;

/** The address of Leaf's live connection, next to the page. */
const liveUrl = (): string => {
  const url = new URL(`${LIVE_PATH}?v=${LIVE_VERSION}`, outside.href());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

/** What one connection knows of the room. Made afresh for each, and shown only once its welcome came. */
interface Link {
  readonly socket: LiveSocket;
  readonly people: Map<number, LiveMember>;
  readonly tracks: Map<number, Track>;
  clock: ClockSync | null;
  you: number | null;
  open: boolean;
}

const NOBODY: ReadonlyMap<number, LiveMember> = new Map();

/** Puts the player in a room on Leaf, live. With the made-up guild it does nothing, and nobody is ever there. */
export function joinLive(room: string, ears: LiveEars = {}): LiveRoom {
  /** The connection open now, if any; and the one whose picture of the room is shown. */
  let link: Link | null = null;
  let shown: Link | null = null;
  let done = member() === null;
  let tries = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let pinger: ReturnType<typeof setTimeout> | null = null;
  // The player's motion: as the page last said it, as last sent, and when, and a send waiting its turn.
  let motion: Motion | null = null;
  let sent: Motion | null = null;
  let sentAt = 0;
  let seq = 0;
  let later: ReturnType<typeof setTimeout> | null = null;

  const status = (s: LiveStatus): void => ears.status?.(s);
  const say = (l: Link, m: ToServer): void => l.socket.send(JSON.stringify(m));

  function sendNow(): void {
    if (later) clearTimeout(later);
    later = null;
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

  function ping(l: Link, n: number): void {
    if (link !== l) return;
    say(l, { t: "ping", c: outside.now() });
    pinger = setTimeout(() => ping(l, n + 1), n < 5 ? PING_FIRST : PING_EVERY);
  }

  function heard(l: Link, text: string): void {
    const m = readToClient(text);
    if (!m) return;
    switch (m.t) {
      case "welcome": {
        tries = 0;
        l.you = m.you;
        l.clock = new ClockSync(m.time, outside.now());
        l.people.clear();
        for (const r of m.roster) l.people.set(r.id, r);
        shown = l;
        ears.welcome?.(m.you, m.room, m.roster);
        // Said again as a jump: whatever anybody saw of the player before, they are here now.
        if (motion) want({ ...motion, jump: (motion.jump + 1) & 0xff });
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
      case "pong":
        l.clock?.add(m.c, m.s, outside.now());
        return;
      case "error":
        return;
    }
  }

  function snapshot(l: Link, data: ArrayBuffer): void {
    const snap = decodeSnapshot(new Uint8Array(data));
    if (!snap) return;
    for (const entry of snap.entries) {
      if (entry.id === l.you) continue;
      let track = l.tracks.get(entry.id);
      if (!track) l.tracks.set(entry.id, (track = new Track()));
      track.add(snap.time, entry);
    }
  }

  function connect(): void {
    if (done) return;
    status("connecting");
    const l: Link = {
      socket: outside.socket(liveUrl()),
      people: new Map(),
      tracks: new Map(),
      clock: null,
      you: null,
      open: false,
    };
    link = l;
    l.socket.binaryType = "arraybuffer";
    l.socket.addEventListener("open", () => {
      if (link !== l) return;
      l.open = true;
      status("open");
      say(l, { t: "join", room });
      ping(l, 0);
    });
    l.socket.addEventListener("message", (e) => {
      if (link !== l) return;
      if (typeof e.data === "string") heard(l, e.data);
      else if (e.data instanceof ArrayBuffer) snapshot(l, e.data);
    });
    l.socket.addEventListener("close", (e) => {
      if (link !== l) return;
      link = null;
      if (pinger) clearTimeout(pinger);
      if (done) return;
      if (!reconnects(e.code)) {
        done = true;
        return status(e.code === CLOSE.replaced ? "replaced" : "signedout");
      }
      status("closed");
      retry = setTimeout(connect, retryAfter(tries++, Math.random()));
    });
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
      if (link && shown === link) say(link, { t: "act", kind, arg });
    },
    sample(id) {
      const l = shown;
      if (!l?.clock) return null;
      return l.tracks.get(id)?.at(l.clock.server(outside.now()) - INTERP_MS) ?? null;
    },
    serverNow: () => shown?.clock?.server(outside.now()) ?? outside.now(),
    rtt: () => shown?.clock?.rtt() ?? null,
    close() {
      done = true;
      for (const t of [retry, pinger, later]) if (t) clearTimeout(t);
      if (link?.open) say(link, { t: "leave" });
      link?.socket.close(CLOSE.done, "bye");
      link = null;
    },
  };
}
