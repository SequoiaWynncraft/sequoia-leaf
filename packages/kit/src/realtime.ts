/**
 * Live, the game's side: being in a room on Leaf with other players, and seeing them move as it
 * happens (the wire is `@sequoia-leaf/core`'s `live.ts`; the server is `apps/api/src/live`).
 *
 * `joinLive(room, ears)` opens the connection and keeps it open: it reconnects after a drop with a
 * growing, jittered wait, joins the room again, and says where the player is again. A player who
 * opens the game live somewhere else is told so here (`status("replaced")`) and this page lets go.
 * With the made-up guild there is no server, and it does nothing.
 *
 * What it does not do is draw anybody. A page asks it each frame where somebody is to be drawn
 * (`sample`): their motion as it was `INTERP_MS` ago by Leaf's clock, between the two snapshots
 * either side of that moment, so that everybody moves smoothly whatever the network does.
 */

import {
  CLIENT_HZ,
  decodeSnapshot,
  encodeMove,
  Flag,
  INTERP_MS,
  LIVE_PATH,
  LIVE_VERSION,
  type LiveMember,
  type Motion,
  readToClient,
  type ToServer,
} from "@sequoia-leaf/core";

import { member } from "./live.ts";
import { type LiveSocket, outside } from "./net.ts";

// ---------- Leaf's clock ----------

/**
 * Leaf's clock as this page can know it, from pings: each answer says how far Leaf's clock is from
 * this one, give or take half the round trip. The answer that came back quickest is the best guess,
 * so the offset is the one from the quickest of the last few.
 */
export class ClockSync {
  private readonly samples: { rtt: number; offset: number }[] = [];
  private best = 0;
  private known = false;

  /** A pong: `sent` is this page's clock when the ping went (as it came back), `server` Leaf's, `now` this page's. */
  add(sent: number, server: number, now: number): void {
    const rtt = Math.max(0, now - sent);
    this.samples.push({ rtt, offset: server - (sent + rtt / 2) });
    if (this.samples.length > 8) this.samples.shift();
    const quickest = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.best = quickest.offset;
    this.known = true;
  }

  /** Takes Leaf's clock from a welcome, until a ping says better. */
  guess(server: number, now: number): void {
    if (this.known) return;
    this.best = server - now;
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
   * for a little while if none is newer yet. Across a snap (`Flag.Snap`) they are drawn where they
   * jumped to, not on the way.
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
    if ((b.m.flags & Flag.Snap) !== 0) return a.m;
    const k = (time - a.time) / Math.max(1, b.time - a.time);
    return { ...a.m, x: a.m.x + (b.m.x - a.m.x) * k, y: a.m.y + (b.m.y - a.m.y) * k };
  }
}

// ---------- the connection ----------

export type LiveStatus = "connecting" | "open" | "closed" | "replaced";

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
   * Says where the player is and how they move. It goes at most `CLIENT_HZ` times a second, and only
   * when it changed; starting, stopping and a snap go at once, and the last change always goes.
   */
  move(m: Motion): void;
  /** Something the player did that others see once: a kind and an argument, short tokens. */
  act(kind: string, arg?: string): void;
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

const SEND_EVERY = 1000 / CLIENT_HZ;
/** Pings: quickly at first, to learn the clock, then now and then, to keep it. */
const PING_FIRST = 1000;
const PING_EVERY = 10_000;

const same = (a: Motion, b: Motion): boolean =>
  a.x === b.x &&
  a.y === b.y &&
  a.vx === b.vx &&
  a.vy === b.vy &&
  a.facing === b.facing &&
  a.pose === b.pose &&
  a.flags === b.flags;

/** The address of Leaf's live connection, next to the page. */
const liveUrl = (): string => {
  const url = new URL(`${LIVE_PATH}?v=${LIVE_VERSION}`, outside.href());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

/** Puts the player in a room on Leaf, live. With the made-up guild it does nothing, and nobody is ever there. */
export function joinLive(room: string, ears: LiveEars = {}): LiveRoom {
  const people = new Map<number, LiveMember>();
  const tracks = new Map<number, Track>();
  const clock = new ClockSync();
  let you: number | null = null;
  let socket: LiveSocket | null = null;
  let open = false;
  let done = member() === null;
  let replaced = false;
  let tries = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let pinger: ReturnType<typeof setTimeout> | null = null;
  let pings = 0;
  // What the player last said, what was last sent, when, and a send waiting for its turn.
  let motion: Motion | null = null;
  let sent: Motion | null = null;
  let sentAt = -Infinity;
  let seq = 0;
  let later: ReturnType<typeof setTimeout> | null = null;

  const status = (s: LiveStatus): void => ears.status?.(s);
  const say = (m: ToServer): void => {
    if (open) socket?.send(JSON.stringify(m));
  };

  function sendMotion(m: Motion): void {
    if (!open || !socket) return;
    seq = (seq + 1) & 0xffff;
    socket.send(encodeMove(seq, m));
    sent = m;
    sentAt = outside.now();
  }

  function ping(): void {
    if (!open) return;
    say({ t: "ping", c: outside.now() });
    pings++;
    pinger = setTimeout(ping, pings < 5 ? PING_FIRST : PING_EVERY);
  }

  function heard(text: string): void {
    const m = readToClient(text);
    if (!m) return;
    switch (m.t) {
      case "welcome": {
        tries = 0;
        you = m.you;
        clock.guess(m.time, outside.now());
        const here = new Set(m.roster.map((r) => r.id));
        for (const id of people.keys()) if (!here.has(id)) tracks.delete(id);
        people.clear();
        for (const r of m.roster) people.set(r.id, r);
        ears.welcome?.(m.you, m.room, m.roster);
        // Where the player is goes again at once, as a jump: nobody has seen them in this room yet.
        if (motion) sendMotion({ ...motion, flags: motion.flags | Flag.Snap });
        return;
      }
      case "joined":
        people.set(m.member.id, m.member);
        ears.joined?.(m.member);
        return;
      case "left":
        people.delete(m.id);
        tracks.delete(m.id);
        ears.left?.(m.id);
        return;
      case "act":
        ears.act?.(m.id, m.kind, m.arg);
        return;
      case "pong":
        clock.add(m.c, m.s, outside.now());
        return;
      case "bye":
        if (m.code === "replaced") {
          done = true;
          replaced = true;
          status("replaced");
        }
        return;
      case "error":
        return;
    }
  }

  function connect(): void {
    if (done) return;
    status("connecting");
    const s = outside.socket(liveUrl());
    socket = s;
    s.binaryType = "arraybuffer";
    s.addEventListener("open", () => {
      open = true;
      status("open");
      say({ t: "join", room });
      pings = 0;
      ping();
    });
    s.addEventListener("message", (e) => {
      if (typeof e.data === "string") return heard(e.data);
      if (!(e.data instanceof ArrayBuffer)) return;
      const snap = decodeSnapshot(new Uint8Array(e.data));
      if (!snap) return;
      for (const entry of snap.entries) {
        if (entry.id === you) continue;
        let track = tracks.get(entry.id);
        if (!track) tracks.set(entry.id, (track = new Track()));
        track.add(snap.time, entry);
      }
    });
    s.addEventListener("close", () => {
      open = false;
      socket = null;
      you = null;
      if (pinger) clearTimeout(pinger);
      if (done) {
        if (!replaced) status("closed");
        return;
      }
      status("closed");
      retry = setTimeout(connect, retryAfter(tries++, Math.random()));
    });
  }

  connect();

  return {
    members: () => people,
    you: () => you,
    move(m) {
      motion = m;
      if (later) return;
      const changedHow = sent === null || (m.flags ^ sent.flags) !== 0;
      if (sent !== null && same(m, sent)) return;
      const wait = SEND_EVERY - (outside.now() - sentAt);
      if (changedHow || (m.flags & Flag.Snap) !== 0 || wait <= 0) return sendMotion(m);
      later = setTimeout(() => {
        later = null;
        if (motion && (sent === null || !same(motion, sent))) sendMotion(motion);
      }, wait);
    },
    act(kind, arg = "") {
      say({ t: "act", kind, arg });
    },
    sample(id) {
      return tracks.get(id)?.at(clock.server(outside.now()) - INTERP_MS) ?? null;
    },
    serverNow: () => clock.server(outside.now()),
    rtt: () => clock.rtt(),
    close() {
      done = true;
      for (const t of [retry, pinger, later]) if (t) clearTimeout(t);
      if (open) say({ t: "leave" });
      socket?.close(1000, "bye");
    },
  };
}
