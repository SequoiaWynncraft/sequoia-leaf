import { afterEach, describe, expect, jest, test } from "bun:test";

import {
  campRoom,
  CLOSE,
  encodeSnapshot,
  Flag,
  INTERP_MS,
  livePath,
  type Motion,
  playerId,
  type ToClient,
  visitRoom,
} from "@sequoia-leaf/core";

import { ABOUT_ASK_AGAIN } from "./about.ts";
import { restart, start } from "./live.ts";
import { backoff, onWake, outside, pretend } from "./net.ts";
import { Playout, Track } from "./playout.ts";
import { hearPresent, here, type Present } from "./presence.ts";
import { forgetLedger } from "./purse.ts";
import {
  askWhy,
  ClockSync,
  type Conn,
  type ConnEvent,
  firstConn,
  firstTry,
  joinLive,
  LIVE_BACKOFF,
  type LiveRoom,
  type LiveStatus,
  roomState,
  sendIn,
  silent,
  type Step,
  stepConn,
} from "./realtime.ts";
import { FakeSocket, HELLO, type Reply, type Standin, standin, TESTER } from "./standin.ts";

const step = (x: number, y: number, flags = 0, vx = 0): Step => ({ x, y, vx, vy: 0, facing: 1, pose: 0, flags });
const at = (x: number, y: number, flags = 0, jump = 0, vx = 0): Motion => ({ ...step(x, y, flags, vx), jump });

describe("Leaf's clock", () => {
  test("is the welcome's until a ping comes back, then the offset the quickest ping saw", () => {
    const c = new ClockSync(10_000, 1000);
    expect(c.server(1500)).toBe(10_500);
    expect(c.rtt()).toBeNull();

    // Sent at 2000, back at 2100: Leaf said 11_060, so it is 9010 ahead, give or take 50.
    c.add(2000, 11_060, 2100);
    // A slow one (400 ms) says something else; the quick one is believed.
    c.add(3000, 12_500, 3400);
    expect(c.server(4000)).toBe(13_010);
    expect(c.rtt()).toBe(100);
  });
});

describe("somebody's track", () => {
  test("goes between the snapshots either side of the moment", () => {
    const t = new Track();
    t.add(1000, at(0, 0, Flag.Moving));
    t.add(1100, at(10, 20, Flag.Moving));
    expect(t.at(1050)).toMatchObject({ x: 5, y: 10 });
    expect(t.at(900)).toMatchObject({ x: 0, y: 0 });
  });

  test("past the newest, is where the newest has them: never anywhere they have not been", () => {
    const t = new Track();
    t.add(1000, at(100, 50, Flag.Moving, 0, 64));
    expect(t.at(1100)).toMatchObject({ x: 100, y: 50 });
    expect(t.at(5000)).toMatchObject({ x: 100 });
  });

  test("is never drawn on the way across a jump", () => {
    const t = new Track();
    t.add(1000, at(0, 0, 0, 4));
    t.add(1100, at(400, 300, 0, 5));
    t.add(1200, at(410, 300, 0, 5));
    expect(t.at(1099)).toMatchObject({ x: 0, y: 0 });
    expect(t.at(1100)).toMatchObject({ x: 400, y: 300 });
    expect(t.at(1150)).toMatchObject({ x: 405 });
  });

  test("keeps two and a half seconds, and takes no snapshot older than the newest", () => {
    const t = new Track();
    for (let time = 0; time <= 5000; time += 100) t.add(time, at(time, 0));
    t.add(2000, at(-1, -1));
    expect(t.at(1000)).toMatchObject({ x: 2400 });
    expect(t.at(4950)).toMatchObject({ x: 4950 });
  });
});

describe("when to draw others", () => {
  test("INTERP_MS behind the newest snapshots as they come, however far behind Leaf's clock the network has them", () => {
    const p = new Playout();
    expect(p.time(0)).toBeNull();
    // Leaf's clock is 5 s ahead of the page's, and each snapshot takes 120 ms to come.
    for (let i = 0; i < 20; i++) p.heard(5000 + i * 50, i * 50 + 120);
    // The newest, sent at 5950 by Leaf's clock, came at 1070 by the page's: drawn INTERP_MS behind it.
    expect(p.time(1070)).toBe(5950 - INTERP_MS);
  });

  test("lets most of an uneven network's snapshots come before the moment drawn, all but the slowest tenth", () => {
    const p = new Playout();
    // Twenty snapshots, every 50 ms: most take 40 ms, every tenth 140.
    for (let i = 0; i < 20; i++) p.heard(i * 50, i * 50 + (i % 10 === 9 ? 140 : 40));
    expect(p.time(1000)).toBe(1000 - 140 - INTERP_MS);
    const q = new Playout();
    for (let i = 0; i < 20; i++) q.heard(i * 50, i * 50 + (i % 20 === 19 ? 400 : 40));
    expect(q.time(1000)).toBe(1000 - 40 - INTERP_MS);
  });

  test("settles to a slower network by a tenth of the time passing at most, so the moment drawn never goes back", () => {
    const p = new Playout();
    p.heard(0, 40);
    expect(p.time(100)).toBe(100 - 40 - INTERP_MS);
    // The network slows: snapshots now take 240 ms.
    for (let i = 1; i <= 40; i++) p.heard(i * 50, i * 50 + 240);
    const times = Array.from({ length: 30 }, (_, i) => p.time(2100 + i * 100) ?? 0);
    for (let i = 1; i < times.length; i++) expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(90);
    expect(times.at(-1)).toBe(2100 + 29 * 100 - 240 - INTERP_MS);
  });

  test("follows a walker over a slow, uneven network smoothly, never back, and where they really were", () => {
    // Alice walks right at 64 a second, her page saying so every 50 ms; Leaf stamps each and sends it
    // on, and it comes 80 to 200 ms later, in order.
    const p = new Playout();
    const t = new Track();
    let due = 0;
    const arrivals: { time: number; came: number; x: number }[] = [];
    for (let time = 0; time <= 6000; time += 50) {
      const wait = 80 + ((time * 7919) % 121);
      due = Math.max(due, time + wait);
      arrivals.push({ time, came: due, x: time * 0.064 });
    }
    let next = 0;
    let was = -Infinity;
    let worst = 0;
    for (let now = 1000; now <= 6000; now += 16) {
      while ((arrivals[next]?.came ?? Infinity) <= now) {
        const a = arrivals[next++];
        if (!a) break;
        p.heard(a.time, a.came);
        t.add(a.time, at(a.x, 0, Flag.Moving, 0, 64));
      }
      const time = p.time(now) ?? 0;
      const x = t.at(time)?.x ?? 0;
      expect(x).toBeGreaterThanOrEqual(was);
      was = x;
      worst = Math.max(worst, Math.abs(x - time * 0.064));
    }
    // Where she was at the moment drawn, to within the steps her page said it in.
    expect(worst).toBeLessThan(0.5);
  });
});

describe("sending the player's motion", () => {
  test("goes at once the first time, and whenever they start, stop or jump, however soon", () => {
    const sent = at(0, 0, Flag.Moving);
    expect(sendIn(sent, null, 0, 0)).toBe(0);
    expect(sendIn(at(1, 0, 0), sent, 1000, 1001)).toBe(0);
    expect(sendIn(at(1, 0, Flag.Moving, 1), sent, 1000, 1001)).toBe(0);
  });

  test("goes no more than twenty times a second otherwise, and not at all when nothing changed", () => {
    const sent = at(0, 0, Flag.Moving);
    expect(sendIn(at(1, 0, Flag.Moving), sent, 1000, 1010)).toBe(40);
    expect(sendIn(at(1, 0, Flag.Moving), sent, 1000, 1080)).toBe(0);
    expect(sendIn(sent, sent, 1000, 9999)).toBeNull();
  });
});

describe("trying again", () => {
  test("waits a quarter second, doubling to five seconds at most, each with up to a quarter more by chance", () => {
    expect([0, 1, 2, 3, 4, 5, 40].map((tries) => backoff(LIVE_BACKOFF, tries, 0))).toEqual([
      250, 500, 1000, 2000, 4000, 5000, 5000,
    ]);
    expect([backoff(LIVE_BACKOFF, 0, 1), backoff(LIVE_BACKOFF, 2, 0.5), backoff(LIVE_BACKOFF, 9, 1)]).toEqual([
      312.5, 1125, 6250,
    ]);
  });

  test("starts at half a second when Leaf said it is restarting", () => {
    expect(backoff(LIVE_BACKOFF, firstTry(CLOSE.restart), 0)).toBe(500);
    expect([1006, CLOSE.done, CLOSE.policy].map((code) => backoff(LIVE_BACKOFF, firstTry(code), 0))).toEqual([
      250, 250, 250,
    ]);
  });

  test("asks why after three tries in a row that did not open, and every fifth after", () => {
    const asked = Array.from({ length: 20 }, (_, n) => n + 1).filter(askWhy);
    expect(asked).toEqual([3, 8, 13, 18]);
  });

  test("counts a connection dead after fifteen seconds of quiet, only with a ping unanswered for five", () => {
    // Pinged ten seconds in, nothing back: dead at fifteen.
    expect(silent(0, 10_000, 14_999)).toBe(false);
    expect(silent(0, 10_000, 15_000)).toBe(true);
    // The ping was answered (something came after it): quiet since then is the page's own.
    expect(silent(60_000, 59_990, 120_000)).toBe(false);
    // A page back from the background asks at once, and gives the answer five seconds.
    expect(silent(60_000, 120_000, 124_999)).toBe(false);
    expect(silent(60_000, 120_000, 125_000)).toBe(true);
    expect(silent(0, null, 60_000)).toBe(false);
  });
});

/** A connection dropped, as its socket says. */
const drop = (link: string, code: number, now = 5000): ConnEvent<string> => ({
  do: "dropped",
  link,
  code,
  now,
  chance: 0,
});

describe("where the connection is", () => {
  type C = Conn<string>;
  const counted = { shown: null, tries: 0, failed: 0, restart: false, away: false, downSince: null };
  const down = (over: Partial<Omit<Extract<C, { at: "down" }>, "at">> = {}): C => ({
    at: "down",
    ...counted,
    lastTry: -Infinity,
    retryAt: -Infinity,
    ...over,
  });
  const on = (where: "connecting" | "open", over: Partial<Omit<Extract<C, { at: "open" }>, "at">> = {}): C => {
    const { room = "joining", ...rest } = over;
    return where === "open"
      ? { at: "open", ...counted, link: "a", since: 1000, room, ...rest }
      : { at: "connecting", ...counted, link: "a", since: 1000, ...rest };
  };

  test.each<[string, C, ConnEvent<string>, C]>([
    ["a try begins from down", firstConn(), { do: "try", link: "a", now: 1000 }, on("connecting")],
    ["a try begins only from down", on("connecting"), { do: "try", link: "b", now: 1000 }, on("connecting")],
    [
      "the try opens: nothing has failed since",
      on("connecting", { failed: 2 }),
      { do: "opened", link: "a" },
      on("open"),
    ],
    ["another connection opening is nothing", on("connecting"), { do: "opened", link: "b" }, on("connecting")],
    [
      "the welcome shows this connection, in the room, and its tries start again",
      on("open", { tries: 4, restart: true, downSince: 900 }),
      { do: "welcomed", link: "a" },
      on("open", { shown: "a", room: "in" }),
    ],
    [
      "a welcomed connection dropped waits the first wait",
      on("open", { shown: "a", since: 900, room: "in" }),
      drop("a", 1006),
      down({ shown: "a", tries: 1, lastTry: 900, retryAt: 5250, downSince: 5000 }),
    ],
    [
      "dropped as Leaf restarts, the first wait is the second, and the welcome will say so",
      on("open", { shown: "a", room: "in" }),
      drop("a", CLOSE.restart),
      down({ shown: "a", tries: 2, restart: true, lastTry: 1000, retryAt: 5500, downSince: 5000 }),
    ],
    [
      "a try that did not open counts as failed, and waits longer",
      on("connecting", { shown: "z", tries: 3, failed: 1, restart: true, downSince: 4000 }),
      drop("a", 1006),
      // Lost since the first drop, not this one.
      down({ shown: "z", tries: 4, failed: 2, restart: true, lastTry: 1000, retryAt: 7000, downSince: 4000 }),
    ],
    [
      "opened elsewhere: let go",
      on("open", { shown: "a" }),
      drop("a", CLOSE.replaced),
      { at: "gone", why: "replaced" },
    ],
    ["signed out: let go", on("connecting"), drop("a", CLOSE.signedOut), { at: "gone", why: "signedout" }],
    ["another connection dropping is nothing", on("open"), drop("b", 1006), on("open")],
    [
      "back while a try has been opening over a second: tried again at once",
      on("connecting", { since: 1000 }),
      { do: "wake", now: 2000 },
      down({ failed: 1, lastTry: 1000, retryAt: 2000, downSince: 2000 }),
    ],
    ["back while a try has just begun: nothing", on("connecting"), { do: "wake", now: 1500 }, on("connecting")],
    [
      "back while down: the wait is cut to a second after the last try",
      down({ lastTry: 1000, retryAt: 9000 }),
      { do: "wake", now: 1200 },
      down({ lastTry: 1000, retryAt: 2000 }),
    ],
    [
      "back while down with a try due sooner: left as it is",
      down({ lastTry: 1000, retryAt: 1500 }),
      { do: "wake", now: 1200 },
      down({ lastTry: 1000, retryAt: 1500 }),
    ],
    [
      "Leaf says signed out while trying: let go",
      down(),
      { do: "letGo", why: "signedout" },
      { at: "gone", why: "signedout" },
    ],
    ["Leaf says signed out while open: kept", on("open"), { do: "letGo", why: "signedout" }, on("open")],
    ["the page closes it", on("open", { shown: "a" }), { do: "close" }, { at: "gone", why: "closed" }],
    [
      "away from a room it is in: steps out, and shows nothing",
      on("open", { shown: "a", room: "in" }),
      { do: "away", on: true },
      on("open", { away: true, room: "out" }),
    ],
    [
      "away while still joining: stays joining, and steps out as the welcome comes",
      on("open", { shown: "z" }),
      { do: "away", on: true },
      on("open", { away: true }),
    ],
    [
      "welcomed while away: out of the room at once, and nothing is shown",
      on("open", { away: true, downSince: 900 }),
      { do: "welcomed", link: "a" },
      on("open", { away: true, room: "out" }),
    ],
    [
      "back from away on the open connection: joins again, and is in once welcomed",
      on("open", { away: true, room: "out" }),
      { do: "away", on: false },
      on("open", { room: "joining" }),
    ],
    [
      "back from away while still joining: the welcome to come puts it in",
      on("open", { away: true }),
      { do: "away", on: false },
      on("open"),
    ],
    [
      "away while down or connecting: carried to the next connection, which steps out as it is welcomed",
      down({ shown: "a", downSince: 800 }),
      { do: "away", on: true },
      down({ away: true, downSince: 800 }),
    ],
    [
      "a drop while away keeps the page away, and the connection comes back to step out again",
      on("open", { away: true, room: "out" }),
      drop("a", 1006),
      down({ away: true, tries: 1, lastTry: 1000, retryAt: 5250, downSince: 5000 }),
    ],
    [
      "a try opening carries the page's wish",
      down({ away: true }),
      { do: "try", link: "b", now: 1200 },
      on("connecting", { away: true, since: 1200, link: "b" }),
    ],
    [
      "asked to be where it is already: nothing",
      on("open", { room: "in", shown: "a" }),
      { do: "away", on: false },
      on("open", { room: "in", shown: "a" }),
    ],
    [
      "nothing moves a connection let go of",
      { at: "gone", why: "replaced" },
      { do: "try", link: "a", now: 0 },
      { at: "gone", why: "replaced" },
    ],
  ])("%s", (_name, from, event, to) => {
    expect(stepConn(from, event)).toEqual(to);
  });

  test("what the page is told of its room, from where the connection is", () => {
    expect(roomState(on("open", { room: "in", shown: "a" }), 9000)).toEqual({ at: "in" });
    expect(roomState(on("open", { away: true, room: "out" }), 9000)).toEqual({ at: "away" });
    expect(roomState(down({ away: true, downSince: 100 }), 9000)).toEqual({ at: "away" });
    expect(roomState(on("connecting"), 9000)).toEqual({ at: "joining" });
    expect(roomState(on("open"), 9000)).toEqual({ at: "joining" });
    expect(roomState(down({ downSince: 6000 }), 9000)).toEqual({ at: "down", ms: 3000 });
    expect(roomState(on("open", { downSince: 6000 }), 9000)).toEqual({ at: "down", ms: 3000 });
    expect(roomState({ at: "gone", why: "replaced" }, 9000)).toEqual({ at: "gone", why: "replaced" });
  });
});

const ALICE = { id: 2, player: "a", name: "Alice", rank: "Captain", guest: false };
/** A change to who is about, numbered `v`, that changes nothing but when the lists were made. */
const change = (v: number): ToClient => ({ t: "aboutChanged", v, at: `2026-11-25T10:00:0${v % 10}.000Z`, lists: {} });
/** Somebody on Leaf's lists of who is about, at a place. */
const listed = (id: string, place: string) => ({
  id,
  username: id,
  place,
  guest: false,
  seen_at: "2026-11-25T10:00:00.000Z",
});
const welcome = (you: number, time: number, roster = [{ ...ALICE, id: you }], room = "town"): ToClient => ({
  t: "welcome",
  v: 1,
  you,
  room: `${room}/1`,
  hz: 30,
  time,
  roster,
});

describe("a live room", () => {
  let world: Standin | null = null;
  let room: LiveRoom | null = null;
  let undo: (() => void) | null = null;
  const sockets: FakeSocket[] = [];
  afterEach(() => {
    room?.close();
    room = null;
    undo?.();
    undo = null;
    world?.done();
    world = null;
    sockets.length = 0;
    restart();
    forgetLedger();
  });

  /** A live game, and the sockets it opens. */
  async function live(): Promise<Standin> {
    const w = standin({ "GET /v1/game/hello": HELLO, "GET /v1/game/me": { status: 200, body: TESTER } });
    world = w;
    await start();
    undo = pretend({
      socket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    return w;
  }

  const socket = (i: number): FakeSocket => {
    const s = sockets[i];
    if (!s) throw new Error(`no socket ${i}`);
    return s;
  };

  test("opens nothing with the made-up guild", async () => {
    world = standin({});
    await start();
    let opened = 0;
    undo = pretend({
      socket: () => {
        opened++;
        return new FakeSocket("");
      },
    });
    room = joinLive("town");
    room.move(step(1, 1));
    expect(opened).toBe(0);
    expect(room.members().size).toBe(0);
  });

  test("joins the room next to the page, learns who is there, and follows them", async () => {
    const w = await live();
    const heard: string[] = [];
    room = joinLive("town", {
      welcome: (you, name, roster) => heard.push(`welcome ${you} ${name} ${roster.length}`),
      joined: (m) => heard.push(`joined ${m.name}`),
      left: (id) => heard.push(`left ${id}`),
      act: (id, kind, arg) => heard.push(`act ${id} ${kind} ${arg}`),
    });
    const s = socket(0);
    // Opening it is entering the room: the room is in the address, and nothing need be said to join.
    // With what the page is on, by its width when it signed in.
    expect(s.url).toBe(`wss://leaf.example${livePath("town")}&device=desktop`);
    s.open();
    expect(s.texts().map((m) => m.t)).toEqual(["ping"]);

    const now = w.clock.now;
    s.says(welcome(1, now + 5000));
    s.says({ t: "joined", member: ALICE });
    s.says({ t: "act", id: 2, kind: "emote", arg: "wave" });
    // Alice walks right: two snapshots 100 ms apart by Leaf's clock, each coming 30 ms after it was
    // sent; the player's own figure (1) is not followed.
    w.clock.now = now + 30;
    s.sends(
      encodeSnapshot(1, now + 5000, [
        { id: 2, seq: 1, ...at(0, 10, Flag.Moving) },
        { id: 1, seq: 1, ...at(9, 9) },
      ]),
    );
    w.clock.now = now + 130;
    s.sends(encodeSnapshot(2, now + 5100, [{ id: 2, seq: 2, ...at(20, 10, Flag.Moving) }]));

    expect(room.you()).toBe(1);
    expect([...room.members().keys()]).toEqual([1, 2]);
    // Leaf's clock is 5 s ahead of the page's; Alice is drawn 100 ms behind the newest snapshot as it
    // came: half way, and then, 50 ms on, where the newest has her.
    expect(room.serverNow()).toBe(now + 5130);
    w.clock.now = now + 180;
    expect(room.sample(2)).toMatchObject({ x: 10, y: 10 });
    w.clock.now = now + 230;
    expect(room.sample(2)).toMatchObject({ x: 20, y: 10 });
    expect(room.sample(1)).toBeNull();

    s.says({ t: "left", id: 2 });
    expect(room.sample(2)).toBeNull();
    expect(heard).toEqual(["welcome 1 town/1 1", "joined Alice", "act 2 emote wave", "left 2"]);
  });

  test("keeps the motion only of those it knows are here: none of somebody it was told has left, all of the rest", async () => {
    const w = await live();
    room = joinLive("town");
    const s = socket(0);
    s.open();
    const now = w.clock.now;
    s.says(welcome(1, now, [{ ...ALICE, id: 1 }, ALICE, { ...ALICE, id: 3, name: "Bea" }]));
    s.says({ t: "left", id: 2 });
    // A snapshot made before Alice left, or of somebody the page never heard of, comes after.
    s.sends(
      encodeSnapshot(1, now - 100, [
        { id: 2, seq: 1, ...at(5, 5) },
        { id: 3, seq: 1, ...at(7, 7) },
        { id: 4, seq: 1, ...at(9, 9) },
      ]),
    );

    expect([...room.members().keys()]).toEqual([1, 3]);
    expect([room.sample(2), room.sample(4), room.sample(3)?.x]).toEqual([null, null, 7]);
  });

  test("in a visit's room, hears each batch Leaf did to the state visited, from its welcome on", async () => {
    const w = await live();
    const heard: unknown[] = [];
    const visited = visitRoom("works", playerId("10000000-0000-0000-0000-000000000001"));
    room = joinLive(visited, { did: (rev, did, after) => heard.push({ rev, did, after }) });
    const s = socket(0);
    expect(s.url).toBe(`wss://leaf.example${livePath(visited)}&device=desktop`);
    s.open();
    // Nothing heard before the welcome counts.
    s.says({ t: "did", rev: 3, did: [{ do: "collect", tick: 9 }], after: { tick: 9 } });
    s.says(welcome(1, w.clock.now, undefined, visited));
    s.says({ t: "did", rev: 4, did: [{ do: "collect", tick: 10 }], after: { tick: 10 } });
    expect(heard).toEqual([{ rev: 4, did: [{ do: "collect", tick: 10 }], after: { tick: 10 } }]);
  });

  test("while welcomed into the town's room, the page only asks who is about; dropped, it says where the player is", async () => {
    const w = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/game/presence": { status: 200, body: { present: [], resting: [] } },
      "PUT /v1/game/presence": { status: 200, body: { present: [], resting: [] } },
    });
    world = w;
    await start();
    undo = pretend({
      socket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    room = joinLive("town");
    const s = socket(0);
    s.open();
    s.says(welcome(1, w.clock.now));
    here("town");
    await Bun.sleep(10);
    s.drop();
    here(null);
    here("town");
    await Bun.sleep(10);
    here(null);

    expect(w.sent.filter((x) => x.path === "/v1/game/presence").map((x) => x.method)).toEqual(["GET", "PUT"]);
  });

  test("asks who is about again at each welcome, and when the room says who is where changed without saying who", async () => {
    const w = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/game/presence": { status: 200, body: { present: [], resting: [] } },
      "PUT /v1/game/presence": { status: 200, body: { present: [], resting: [] } },
    });
    world = w;
    await start();
    undo = pretend({
      socket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    room = joinLive("town");
    here("town");
    await Bun.sleep(10);
    const s = socket(0);
    s.open();
    s.says(welcome(1, w.clock.now));
    await Bun.sleep(10);
    s.says({ t: "about" });
    await Bun.sleep(10);
    // A room's word with Leaf's lists in it is taken as it is: nothing is asked.
    s.says({ t: "about", who: { at: "2026-11-25T10:00:00.000Z", present: [], resting: [], gone: [] } });
    await Bun.sleep(10);
    here(null);

    // Said before the room welcomed the page; then asked at the welcome, and again at the room's word without lists.
    expect(w.sent.filter((x) => x.path === "/v1/game/presence").map((x) => x.method)).toEqual(["PUT", "GET", "GET"]);
  });

  test("makes who is about from Leaf's lists and each change after, and asks for all of them once when one does not follow", async () => {
    const w = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/game/presence": { status: 200, body: { at: "2026-11-25T09:00:00.000Z", present: [], resting: [] } },
      "PUT /v1/game/presence": { status: 200, body: { at: "2026-11-25T09:00:00.000Z", present: [], resting: [] } },
    });
    world = w;
    await start();
    undo = pretend({
      socket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    const lists: string[][] = [];
    const unhear = hearPresent((present: readonly Present[]) => lists.push(present.map((p) => `${p.name} ${p.place}`)));
    room = joinLive("town");
    here("town");
    await Bun.sleep(10);
    const s = socket(0);
    s.open();
    s.says(welcome(1, w.clock.now));
    await Bun.sleep(10);
    lists.length = 0;
    s.says({
      t: "about",
      v: 4,
      who: { at: "2026-11-25T10:00:00.000Z", present: [listed("Bo", "town")], resting: [], gone: [] },
    });
    s.says({
      t: "aboutChanged",
      v: 5,
      at: "2026-11-25T10:00:01.000Z",
      lists: { present: { add: [[0, listed("Al", "works")]], put: [{ id: "Bo", place: "camp" }] } },
    });
    // Number 7 does not follow 5: let go, and all of them asked for, once.
    const missed: ToClient = {
      t: "aboutChanged",
      v: 7,
      at: "2026-11-25T10:00:03.000Z",
      lists: { present: { drop: ["Bo"] } },
    };
    s.says(missed);
    s.says({ t: "aboutChanged", v: 8, at: "2026-11-25T10:00:03.500Z", lists: {} });
    s.says({ t: "about", v: 8, who: { at: "2026-11-25T10:00:04.000Z", present: [], resting: [], gone: [] } });
    s.says({
      t: "aboutChanged",
      v: 9,
      at: "2026-11-25T10:00:05.000Z",
      lists: { present: { add: [[0, listed("Cy", "town")]] } },
    });
    unhear();
    here(null);

    expect(lists).toEqual([["Bo town"], ["Al works", "Bo camp"], [], ["Cy town"]]);
    expect(s.texts().filter((m) => m["t"] === "about")).toEqual([{ t: "about" }]);
  });

  test("asks again for all of who is about while changes go on not following, every few seconds, whatever the machine's clock says", async () => {
    const w = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/game/presence": { status: 200, body: { at: "2026-11-25T09:00:00.000Z", present: [], resting: [] } },
      "PUT /v1/game/presence": { status: 200, body: { at: "2026-11-25T09:00:00.000Z", present: [], resting: [] } },
    });
    world = w;
    await start();
    undo = pretend({
      socket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    room = joinLive("town");
    here("town");
    await Bun.sleep(10);
    const s = socket(0);
    s.open();
    s.says(welcome(1, w.clock.now));
    const asks = () => s.texts().filter((m) => m["t"] === "about").length;
    s.says({ t: "about", v: 4, who: { at: "2026-11-25T10:00:00.000Z", present: [], resting: [], gone: [] } });
    // A number missed: all of them asked for. Leaf may not have taken the ask (the page sent too
    // much a moment ago): the changes still do not follow, and a few seconds on, it asks again.
    s.says(change(6));
    w.clock.elapsed += 1000;
    s.says(change(7));
    const early = asks();
    // The machine's clock is set back meanwhile: how long since the last ask is not.
    w.clock.now -= 3_600_000;
    w.clock.elapsed += ABOUT_ASK_AGAIN;
    s.says(change(8));
    const again = asks();
    // Given all of them: what follows is taken, and nothing more is asked.
    s.says({ t: "about", v: 8, who: { at: "2026-11-25T10:00:08.000Z", present: [], resting: [], gone: [] } });
    w.clock.elapsed += ABOUT_ASK_AGAIN;
    s.says(change(9));
    here(null);

    expect([early, again, asks()]).toEqual([1, 2, 2]);
  });

  test("sends a stop or a jump at once, even with a move still waiting its turn", async () => {
    const w = await live();
    room = joinLive("town");
    const s = socket(0);
    s.open();
    s.says(welcome(1, 0));
    room.move(step(0, 0, Flag.Moving));
    w.clock.now += 10;
    room.move(step(1, 0, Flag.Moving));
    room.move(step(2, 0, 0));
    w.clock.now += 1;
    room.move(step(300, 200, 0), true);
    expect(s.moves().map((m) => [m?.motion.x, m?.motion.flags, m?.motion.jump])).toEqual([
      [0, Flag.Moving, 0],
      [2, 0, 0],
      [300, 0, 1],
    ]);
    // Nothing is left waiting to go after them.
    await Bun.sleep(70);
    expect(s.moves().length).toBe(3);
  });

  test("after a drop, keeps showing the room until the new connection's welcome, then only the new one's", async () => {
    const w = await live();
    const seen: LiveStatus[] = [];
    room = joinLive("town", { status: (st) => seen.push(st) });
    const first = socket(0);
    first.open();
    first.says(welcome(1, w.clock.now, [{ ...ALICE, id: 1 }, ALICE]));
    first.sends(encodeSnapshot(1, w.clock.now - 100, [{ id: 2, seq: 1, ...at(50, 50) }]));
    room.move(step(30, 40));
    first.drop();
    expect(seen).toEqual(["connecting", "open", "closed"]);
    expect(room.sample(2)).toMatchObject({ x: 50 });

    await Bun.sleep(800);
    const second = socket(1);
    second.open();
    expect(room.members().size).toBe(2);
    // Leaf gave number 2 to somebody else this time: nothing of the old Alice is drawn for them.
    second.says(
      welcome(5, w.clock.now, [
        { ...ALICE, id: 5 },
        { ...ALICE, id: 2, name: "Bob" },
      ]),
    );
    expect(room.you()).toBe(5);
    expect(room.sample(2)).toBeNull();
    expect([...room.members().values()].map((m) => m.name)).toEqual(["Alice", "Bob"]);
    expect(second.url).toBe(first.url);
    // The player is said again on the new connection, at once (Leaf shows others that as a jump).
    expect(second.moves().map((m) => [m?.motion.x, m?.motion.jump])).toEqual([[30, 0]]);
    expect(seen).toEqual(["connecting", "open", "closed", "connecting", "open"]);
  });

  test("counts nothing heard before a welcome, and starts afresh at each one", async () => {
    const w = await live();
    room = joinLive("town");
    const s = socket(0);
    s.open();
    // The player's place from before this connection, in another room: not this page's to show.
    s.sends(encodeSnapshot(1, w.clock.now, [{ id: 2, seq: 1, ...at(70, 70) }]));
    s.says(welcome(1, w.clock.now, [{ ...ALICE, id: 1 }, ALICE]));
    expect(room.sample(2)).toBeNull();
    s.sends(encodeSnapshot(2, w.clock.now - 100, [{ id: 2, seq: 2, ...at(10, 10) }]));
    expect(room.sample(2)).toMatchObject({ x: 10 });
    s.says(welcome(1, w.clock.now, [{ ...ALICE, id: 1 }, ALICE]));
    expect(room.sample(2)).toBeNull();
  });

  test.each([
    [CLOSE.replaced, "replaced"],
    [CLOSE.signedOut, "signedout"],
  ] as const)("lets go for good on close code %d, by the code alone", async (code, said) => {
    await live();
    const seen: LiveStatus[] = [];
    room = joinLive("town", { status: (st) => seen.push(st) });
    socket(0).open();
    socket(0).drop(code);
    await Bun.sleep(800);
    expect(sockets.length).toBe(1);
    expect(seen).toEqual(["connecting", "open", said]);
  });

  test("may be closed by whoever hears its status, even as it connects again, and then does nothing more", async () => {
    const w = await live();
    let closeOn: LiveStatus | null = null;
    room = joinLive("town", {
      status: (st) => {
        if (st === closeOn) room?.close();
      },
    });
    socket(0).open();
    closeOn = "connecting";
    socket(0).drop();
    await Bun.sleep(800);
    const second = socket(1);

    expect(second.closed).toBe(CLOSE.done);
    second.open();
    second.says(welcome(1, w.clock.now, [{ ...ALICE, id: 1 }, ALICE]));
    expect([room.members().size, second.sent]).toEqual([0, []]);
    await Bun.sleep(800);
    expect(sockets.length).toBe(2);
  });

  test("sends the player's place once after a welcome, whether or not whoever heard it said it first", async () => {
    const w = await live();
    room = joinLive("town", { welcome: () => room?.move(step(9, 9)) });
    room.move(step(4, 4));
    const s = socket(0);
    s.open();
    s.says(welcome(1, w.clock.now));
    await Bun.sleep(70);

    expect(s.moves().map((m) => m?.motion.x)).toEqual([9]);
  });

  test("shows nobody once the connection is gone for good, though a drop keeps the room in view", async () => {
    const w = await live();
    room = joinLive("town");
    const s = socket(0);
    s.open();
    s.says(welcome(1, w.clock.now, [{ ...ALICE, id: 1 }, ALICE]));
    s.sends(encodeSnapshot(1, w.clock.now - 100, [{ id: 2, seq: 1, ...at(5, 5) }]));
    expect([room.members().size, room.sample(2)?.x]).toEqual([2, 5]);
    s.drop(CLOSE.replaced);

    expect([room.members().size, room.sample(2), room.you()]).toEqual([0, null, null]);
  });

  test("steps out of the room and back in on the one connection: Leaf is told each way, and nothing is opened again", async () => {
    const w = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/game/presence": { status: 200, body: { present: [], resting: [] } },
      "PUT /v1/game/presence": { status: 200, body: { present: [], resting: [] } },
    });
    world = w;
    await start();
    undo = pretend({
      socket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    const heard: string[] = [];
    room = joinLive("town", { welcome: (you) => heard.push(`welcome ${you}`) });
    const s = socket(0);
    s.open();
    s.says(welcome(1, w.clock.now));
    s.says({ t: "joined", member: ALICE });
    expect(room.state()).toEqual({ at: "in" });

    room.go(null);
    expect(s.texts().at(-1)).toEqual({ t: "leave" });
    expect(room.state()).toEqual({ at: "away" });
    // Away, the page is in no room: nobody is shown, its moves go nowhere, and it says where the player is itself.
    expect([room.you(), room.members().size]).toEqual([null, 0]);
    const moves = s.moves().length;
    room.move(step(3, 3, Flag.Moving));
    expect(s.moves()).toHaveLength(moves);
    here("town");
    await Bun.sleep(10);
    expect(w.sent.filter((x) => x.path === "/v1/game/presence").map((x) => x.method)).toEqual(["PUT"]);

    room.go("town");
    expect(s.texts().at(-1)).toEqual({ t: "join", room: "town" });
    expect(room.state()).toEqual({ at: "joining" });
    s.says(welcome(4, w.clock.now));
    expect(room.state()).toEqual({ at: "in" });
    expect(room.you()).toBe(4);
    // In again: the player's place goes at once on the same connection.
    expect(s.moves().length).toBeGreaterThan(moves);
    expect(heard).toEqual(["welcome 1", "welcome 4"]);
    expect(sockets).toHaveLength(1);
    expect(s.closed).toBeNull();
    here(null);
  });

  test("a connection welcomed while the page is away steps out at once, and the page hears no welcome", async () => {
    await live();
    const heard: string[] = [];
    room = joinLive("town", { welcome: (you) => heard.push(`welcome ${you}`) });
    room.go(null);
    const s = socket(0);
    s.open();
    s.says(welcome(1, 0));
    expect(s.texts().map((m) => m.t)).toEqual(["ping", "leave"]);
    expect(room.state()).toEqual({ at: "away" });
    expect(heard).toEqual([]);
    room.go("town");
    expect(s.texts().at(-1)).toEqual({ t: "join", room: "town" });
    s.says(welcome(2, 0));
    expect(heard).toEqual(["welcome 2"]);
  });

  const camp = campRoom(playerId("10000000-0000-0000-0000-000000000002"));

  test("goes from room to room on the one connection, showing nobody of the room left and nobody until the next welcome", async () => {
    const w = await live();
    const heard: string[] = [];
    room = joinLive("town", {
      welcome: (you, name) => heard.push(`welcome ${you} ${name}`),
      joined: (m) => heard.push(`joined ${m.name}`),
      changed: (rev) => heard.push(`changed ${rev}`),
    });
    const s = socket(0);
    s.open();
    s.says(welcome(1, w.clock.now));
    s.says({ t: "joined", member: ALICE });
    room.go(camp);
    // Out of the town's room, and into the camp's.
    expect(s.texts().slice(-2)).toEqual([{ t: "leave" }, { t: "join", room: camp }]);
    expect([room.state(), room.members().size, room.you()]).toEqual([{ at: "joining" }, 0, null]);
    // What the town's room says before the camp's welcome is the town's, and is not heard.
    s.says({ t: "joined", member: { ...ALICE, id: 3, name: "Bea" } });
    s.sends(encodeSnapshot(1, w.clock.now, [{ id: 2, seq: 1, ...at(5, 5) }]));
    s.says(welcome(4, w.clock.now, [{ ...ALICE, id: 4 }], camp));
    s.says({ t: "changed", rev: 7 });
    expect(room.state()).toEqual({ at: "in" });
    expect([...room.members().keys()]).toEqual([4]);
    expect(heard).toEqual(["welcome 1 town/1", "joined Alice", `welcome 4 ${camp}/1`, "changed 7"]);
    // Going where it is already is nothing.
    room.go(camp);
    expect(s.texts().filter((m) => m.t === "join")).toHaveLength(1);
    expect(sockets).toHaveLength(1);
  });

  test("a welcome to a room the page asked to leave meanwhile is answered by asking for the one it wants", async () => {
    const w = await live();
    const heard: string[] = [];
    room = joinLive("town", { welcome: (_you, name) => heard.push(name) });
    room.go(camp);
    const s = socket(0);
    // Opened for the town, as the page wanted when it began.
    expect(s.url).toBe(`wss://leaf.example${livePath("town")}&device=desktop`);
    s.open();
    s.says(welcome(1, w.clock.now));
    expect(s.texts().at(-1)).toEqual({ t: "join", room: camp });
    expect([room.state(), heard]).toEqual([{ at: "joining" }, []]);
    s.says(welcome(2, w.clock.now, undefined, camp));
    expect([room.state(), heard]).toEqual([{ at: "in" }, [`${camp}/1`]]);
    // Dropped, it comes back into the room it is in.
    s.drop();
    await Bun.sleep(800);
    expect(socket(1).url).toBe(`wss://leaf.example${livePath(camp)}&device=desktop`);
  });

  test("leaves and closes when the page is done with it, and sends nothing on a socket not yet open", async () => {
    await live();
    room = joinLive("town");
    room.close();
    expect(socket(0).sent).toEqual([]);
    expect(socket(0).closed).toBe(CLOSE.done);

    room = joinLive("town");
    const s = socket(1);
    s.open();
    room.close();
    expect(s.texts().at(-1)).toEqual({ t: "leave" });
    expect(s.closed).toBe(CLOSE.done);
  });
});

describe("the page coming back", () => {
  test("is the page shown again, focused, or back on the network, until told to stop", () => {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" });
    Object.defineProperty(globalThis, "window", { value: win, configurable: true });
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
    try {
      const heard: string[] = [];
      let now = "";
      const stop = onWake(() => heard.push(now));
      const say = (on: EventTarget, type: string): void => {
        now = type;
        on.dispatchEvent(new Event(type));
      };
      // Hidden is not back.
      say(doc, "visibilitychange");
      doc.visibilityState = "visible";
      say(doc, "visibilitychange");
      say(win, "focus");
      say(win, "online");
      stop();
      say(win, "focus");
      expect(heard).toEqual(["visibilitychange", "focus", "online"]);
    } finally {
      Reflect.deleteProperty(globalThis, "window");
      Reflect.deleteProperty(globalThis, "document");
    }
  });
});

/** Lets what the page is waiting for from the server arrive: a few turns of promises, as the timers are not real. */
async function settle(): Promise<void> {
  // oxlint-disable-next-line no-await-in-loop -- one turn after another
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("coming back after a drop", () => {
  let world: Standin | null = null;
  let room: LiveRoom | null = null;
  let undo: (() => void) | null = null;
  /** Every socket the page opened, with the page's clock when it did. */
  const made: { s: FakeSocket; at: number }[] = [];
  afterEach(() => {
    jest.useRealTimers();
    room?.close();
    room = null;
    undo?.();
    undo = null;
    world?.done();
    world = null;
    made.length = 0;
    restart();
    forgetLedger();
  });

  /** A live game on a clock of its own, whose `/v1/game/me` answers as `me` says once the page has started. */
  async function live(me: () => Reply = () => ({ status: 200, body: TESTER })): Promise<Standin> {
    let started = false;
    const w = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": () => (started ? me() : { status: 200, body: TESTER }),
    });
    world = w;
    await start();
    started = true;
    undo = pretend({
      socket: (url) => {
        const s = new FakeSocket(url);
        made.push({ s, at: w.clock.now });
        return s;
      },
    });
    jest.useFakeTimers();
    return w;
  }

  /** Moves the page's clock and its timers on together, ten milliseconds at a time. */
  function pass(ms: number): void {
    const w = world;
    if (!w) throw new Error("no world");
    for (let t = 0; t < ms; t += 10) {
      const by = Math.min(10, ms - t);
      w.clock.now += by;
      jest.advanceTimersByTime(by);
    }
  }

  const last = (): FakeSocket => {
    const s = made.at(-1)?.s;
    if (!s) throw new Error("no socket");
    return s;
  };

  /** How long, from now, until the page opens another socket (at most a minute). */
  function nextTry(): number {
    const w = world;
    if (!w) throw new Error("no world");
    const from = w.clock.now;
    const had = made.length;
    while (made.length === had && w.clock.now - from < 60_000) pass(10);
    return w.clock.now - from;
  }

  /** Into the room: the socket opens and Leaf welcomes the page. */
  function welcomed(s: FakeSocket): void {
    s.open();
    s.says(welcome(1, world?.clock.now ?? 0));
  }

  test("tries again after a quarter second, doubling to five seconds, with up to a quarter more, and from the start again after a welcome", async () => {
    await live();
    room = joinLive("town");
    welcomed(last());
    last().drop();
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      waits.push(nextTry());
      last().drop();
    }
    for (const [tries, wait] of waits.entries()) {
      expect(wait).toBeGreaterThanOrEqual(backoff(LIVE_BACKOFF, tries, 0));
      expect(wait).toBeLessThanOrEqual(backoff(LIVE_BACKOFF, tries, 1) + 10);
    }
    nextTry();
    welcomed(last());
    last().drop();
    expect(nextTry()).toBeLessThanOrEqual(320);
  });

  test("after Leaf says it is restarting, the first try waits half a second", async () => {
    await live();
    room = joinLive("town");
    welcomed(last());
    last().drop(CLOSE.restart);
    const wait = nextTry();
    expect(wait).toBeGreaterThanOrEqual(500);
    expect(wait).toBeLessThanOrEqual(630);
  });

  test("tries at once when the page comes back, but not twice within a second, and never later than it would have", async () => {
    const w = await live();
    room = joinLive("town");
    welcomed(last());
    last().drop();
    // Away from the page for two minutes: the waits have grown to five seconds.
    while (made.length < 60) {
      nextTry();
      last().drop();
    }
    pass(1000);
    const had = made.length;
    w.wake();
    expect(made.length).toBe(had + 1);
    // Back again while that one is still opening: nothing more.
    w.wake();
    expect(made.length).toBe(had + 1);
    // It did not open; back again at once: the next goes a second after the last, not five.
    last().drop();
    w.wake();
    expect(nextTry()).toBeLessThanOrEqual(1000);

    // Early on, a try already due within the second is left as it is.
    welcomed(last());
    last().drop();
    expect(nextTry()).toBeLessThanOrEqual(320);
    last().drop();
    pass(100);
    w.wake();
    const wait = nextTry();
    expect(wait).toBeGreaterThanOrEqual(400);
    expect(wait).toBeLessThanOrEqual(530);
  });

  test("an open connection is asked at once when the page comes back", async () => {
    const w = await live();
    room = joinLive("town");
    welcomed(last());
    // Five quick pings to learn the clock; the next is not due for ten seconds.
    pass(5000);
    last().says({ t: "pong", c: 0, s: 0 });
    pass(1500);
    expect(made.length).toBe(1);
    const pings = (): number =>
      last()
        .texts()
        .filter((m) => m.t === "ping").length;
    const before = pings();
    w.wake();
    expect(pings()).toBe(before + 1);
    // Not again within the second.
    w.wake();
    expect(pings()).toBe(before + 1);
  });

  test("closes a connection Leaf has said nothing on for fifteen seconds, and connects again", async () => {
    const seen: LiveStatus[] = [];
    await live();
    room = joinLive("town", { status: (s) => seen.push(s) });
    const first = last();
    welcomed(first);
    // Something heard ten seconds in: quiet counts from then.
    pass(10_000);
    first.snapshot(0, []);
    pass(14_900);
    expect([first.closed, made.length]).toEqual([null, 1]);
    pass(200);
    expect(first.closed).toBe(CLOSE.done);
    expect(seen.at(-1)).toBe("closed");
    expect(nextTry()).toBeLessThanOrEqual(320);
    // Whenever the browser gets round to saying the old one closed, it is nothing to this page.
    first.drop();
    expect(made.length).toBe(2);
    expect(seen.filter((s) => s === "closed").length).toBe(1);
  });

  test("keeps a quiet connection whose pings are answered", async () => {
    await live();
    room = joinLive("town");
    const s = last();
    welcomed(s);
    for (let i = 0; i < 12; i++) {
      pass(5000);
      s.says({ t: "pong", c: 0, s: 0 });
    }
    expect([s.closed, made.length]).toEqual([null, 1]);
  });

  test("after three tries that did not open, asks Leaf why, and lets go once signed out", async () => {
    let me: Reply = "offline";
    const seen: LiveStatus[] = [];
    const w = await live(() => me);
    room = joinLive("town", { status: (s) => seen.push(s) });
    welcomed(last());
    last().drop();
    const asked = (): number => w.sent.filter((x) => x.path === "/v1/game/me").length - 1;
    for (let i = 0; i < 2; i++) {
      nextTry();
      last().drop();
    }
    await settle();
    expect(asked()).toBe(0);
    // The third: no answer at all, as while Leaf is away; the page keeps trying.
    nextTry();
    last().drop();
    await settle();
    expect(asked()).toBe(1);
    // Signed in still (200): the page keeps trying, and asks again at the eighth.
    me = { status: 200, body: TESTER };
    for (let i = 0; i < 4; i++) {
      nextTry();
      last().drop();
      // oxlint-disable-next-line no-await-in-loop -- each try's question, if any, answered before the next
      await settle();
    }
    expect(asked()).toBe(1);
    me = { status: 401, body: { code: "unauthorized" } };
    nextTry();
    last().drop();
    await settle();
    expect(asked()).toBe(2);
    expect(seen.at(-1)).toBe("signedout");
    const had = made.length;
    pass(60_000);
    expect(made.length).toBe(had);
  });

  test("a try that does not open by the deadline is let go and tried again, and one still opening after a second goes again as the page comes back", async () => {
    const seen: LiveStatus[] = [];
    const w = await live();
    room = joinLive("town", { status: (s) => seen.push(s) });
    welcomed(last());
    last().drop();
    // A network that is up and passes nothing: the try never opens, nor closes.
    nextTry();
    const blackHoled = last();
    pass(outside.deadline - 10);
    expect([blackHoled.closed, made.length]).toEqual([null, 2]);
    pass(10);
    expect(blackHoled.closed).toBe(CLOSE.done);
    expect(seen.at(-1)).toBe("closed");
    expect(nextTry()).toBeLessThanOrEqual(1260);
    // Coming back to the page while a try has been opening for over a second: it goes again at once.
    const slow = last();
    pass(1500);
    const had = made.length;
    w.wake();
    expect([slow.closed, made.length]).toEqual([CLOSE.done, had + 1]);
    // The old one closing late is nothing to the page.
    slow.drop();
    welcomed(last());
    expect(seen.at(-1)).toBe("open");
  });

  test("a try that opened starts the count of tries that did not again", async () => {
    const w = await live(() => ({ status: 401, body: { code: "unauthorized" } }));
    room = joinLive("town");
    welcomed(last());
    last().drop();
    for (let i = 0; i < 2; i++) {
      nextTry();
      last().drop();
    }
    // The third opens, and drops before any welcome.
    nextTry();
    last().open();
    last().drop();
    for (let i = 0; i < 2; i++) {
      nextTry();
      last().drop();
    }
    await settle();
    expect(w.sent.filter((x) => x.path === "/v1/game/me").length).toBe(1);
  });
});
