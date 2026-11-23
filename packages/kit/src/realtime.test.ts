import { afterEach, describe, expect, jest, test } from "bun:test";

import {
  CLOSE,
  encodeSnapshot,
  Flag,
  livePath,
  type Motion,
  playerId,
  type ToClient,
  visitRoom,
} from "@sequoia-leaf/core";

import { restart, start } from "./live.ts";
import { onWake, pretend } from "./net.ts";
import { here } from "./presence.ts";
import { forgetLedger } from "./purse.ts";
import {
  askWhy,
  ClockSync,
  firstTry,
  joinLive,
  type LiveRoom,
  type LiveStatus,
  retryAfter,
  sendIn,
  silent,
  type Step,
  Track,
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

  test("goes on as they were for a little while past the newest, if they were moving, and no further", () => {
    const t = new Track();
    t.add(1000, at(100, 50, Flag.Moving, 0, 64));
    expect(t.at(1100)).toMatchObject({ x: 106.4, y: 50 });
    expect(t.at(5000)).toMatchObject({ x: 112.8 });
    const still = new Track();
    still.add(1000, at(100, 50, 0, 0, 64));
    expect(still.at(1500)).toMatchObject({ x: 100 });
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

  test("keeps about a second, and takes no snapshot older than the newest", () => {
    const t = new Track();
    for (let time = 0; time <= 3000; time += 100) t.add(time, at(time, 0));
    t.add(2000, at(-1, -1));
    expect(t.at(1000)).toMatchObject({ x: 1900 });
    expect(t.at(2950)).toMatchObject({ x: 2950 });
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
  test("waits a quarter second, then half, then a second for thirty seconds, two for a minute, then five", () => {
    const waits = (
      [
        [0, 0],
        [1, 300],
        [2, 900],
        [20, 29_999],
        [21, 30_000],
        [40, 89_999],
        [41, 90_000],
        [99, 3_600_000],
      ] as const
    ).map(([tries, down]) => retryAfter(tries, down, 0));
    expect(waits).toEqual([250, 500, 1000, 1000, 2000, 2000, 5000, 5000]);
  });

  test("each with up to a quarter more by chance", () => {
    expect([retryAfter(0, 0, 1), retryAfter(2, 0, 0.5), retryAfter(9, 100_000, 1)]).toEqual([312.5, 1125, 6250]);
  });

  test("starts at half a second when Leaf said it is restarting", () => {
    expect(retryAfter(firstTry(CLOSE.restart), 0, 0)).toBe(500);
    expect([1006, CLOSE.done, CLOSE.policy].map((code) => retryAfter(firstTry(code), 0, 0))).toEqual([250, 250, 250]);
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

const ALICE = { id: 2, player: "a", name: "Alice", rank: "Captain", guest: false };
const welcome = (you: number, time: number, roster = [{ ...ALICE, id: you }]): ToClient => ({
  t: "welcome",
  v: 1,
  you,
  room: "town/1",
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
    // Alice walks right: two snapshots 100 ms apart by Leaf's clock; the player's own figure (1) is not followed.
    s.sends(
      encodeSnapshot(1, now + 5000 - 200, [
        { id: 2, seq: 1, ...at(0, 10, Flag.Moving) },
        { id: 1, seq: 1, ...at(9, 9) },
      ]),
    );
    s.sends(encodeSnapshot(2, now + 5000 - 100, [{ id: 2, seq: 2, ...at(20, 10, Flag.Moving) }]));

    expect(room.you()).toBe(1);
    expect([...room.members().keys()]).toEqual([1, 2]);
    // Drawn 100 ms behind Leaf's clock, which is 5 s ahead of the page's.
    expect(room.serverNow()).toBe(now + 5000);
    expect(room.sample(2)).toMatchObject({ x: 20, y: 10 });
    expect(room.sample(1)).toBeNull();

    s.says({ t: "left", id: 2 });
    expect(room.sample(2)).toBeNull();
    expect(heard).toEqual(["welcome 1 town/1 1", "joined Alice", "act 2 emote wave", "left 2"]);
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
    s.says(welcome(1, w.clock.now));
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

  test("asks who is about again at each welcome, and whenever the room says who is where has changed", async () => {
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
    here(null);

    // Said before the room welcomed the page; then asked at the welcome, and again at the room's word.
    expect(w.sent.filter((x) => x.path === "/v1/game/presence").map((x) => x.method)).toEqual(["PUT", "GET", "GET"]);
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

/** The wait after a drop, by how long the connection has been down, before chance adds to it. */
const baseWait = (since: number): number => (since < 30_000 ? 1000 : since < 90_000 ? 2000 : 5000);

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

  test("tries again after a quarter second, then half, then every second, with up to a quarter more", async () => {
    await live();
    room = joinLive("town");
    welcomed(last());
    last().drop();
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      waits.push(nextTry());
      last().drop();
    }
    const [a = 0, b = 0, ...rest] = waits;
    expect(a).toBeGreaterThanOrEqual(250);
    expect(a).toBeLessThanOrEqual(320);
    expect(b).toBeGreaterThanOrEqual(500);
    expect(b).toBeLessThanOrEqual(630);
    for (const w of rest) {
      expect(w).toBeGreaterThanOrEqual(1000);
      expect(w).toBeLessThanOrEqual(1260);
    }
  });

  test("every two seconds after the first thirty, every five after ninety, and from the start again after a welcome", async () => {
    const w = await live();
    room = joinLive("town");
    welcomed(last());
    const down = w.clock.now;
    last().drop();
    const seen: [number, number][] = [];
    while (w.clock.now - down < 120_000) {
      const since = w.clock.now - down;
      seen.push([since, nextTry()]);
      last().drop();
    }
    for (const [since, wait] of seen.slice(2)) {
      expect(wait).toBeGreaterThanOrEqual(baseWait(since));
      expect(wait).toBeLessThanOrEqual(baseWait(since) * 1.25 + 10);
    }
    expect(seen.some(([since]) => since >= 90_000)).toBe(true);

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
