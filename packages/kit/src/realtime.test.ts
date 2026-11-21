import { afterEach, describe, expect, test } from "bun:test";

import { CLOSE, decodeMove, encodeSnapshot, Flag, LIVE_VERSION, type Motion, type ToClient } from "@sequoia-leaf/core";

import { restart, start } from "./live.ts";
import { isRecord, type LiveSocket, pretend } from "./net.ts";
import { forgetLedger } from "./purse.ts";
import {
  ClockSync,
  joinLive,
  type LiveRoom,
  type LiveStatus,
  retryAfter,
  sendIn,
  type Step,
  Track,
} from "./realtime.ts";
import { HELLO, type Standin, standin, TESTER } from "./standin.ts";

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
  test("waits half a second, doubling to ten, with up to half again by chance", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => retryAfter(n, 0))).toEqual([500, 1000, 2000, 4000, 8000, 10_000, 10_000]);
    expect(retryAfter(0, 1)).toBe(750);
  });
});

/** A WebSocket the test plays Leaf's side of. */
class FakeSocket implements LiveSocket {
  binaryType: BinaryType = "blob";
  readonly sent: (string | Uint8Array)[] = [];
  closed: number | null = null;
  private readonly opens: ((e: Event) => void)[] = [];
  private readonly messages: ((e: MessageEvent) => void)[] = [];
  private readonly closes: ((e: CloseEvent) => void)[] = [];
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(
    ...ear: ["open", (e: Event) => void] | ["message", (e: MessageEvent) => void] | ["close", (e: CloseEvent) => void]
  ): void {
    if (ear[0] === "open") this.opens.push(ear[1]);
    else if (ear[0] === "message") this.messages.push(ear[1]);
    else this.closes.push(ear[1]);
  }
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(code: number = CLOSE.done): void {
    this.closed = code;
  }
  open(): void {
    for (const fn of this.opens) fn(new Event("open"));
  }
  says(m: ToClient): void {
    for (const fn of this.messages) fn(new MessageEvent("message", { data: JSON.stringify(m) }));
  }
  sends(bytes: Uint8Array<ArrayBuffer>): void {
    for (const fn of this.messages) fn(new MessageEvent("message", { data: bytes.buffer }));
  }
  drop(code = 1006): void {
    for (const fn of this.closes) fn(new CloseEvent("close", { code }));
  }
  /** The text frames the game sent, as JSON objects. */
  texts(): Record<string, unknown>[] {
    return this.sent.flatMap((s) => {
      if (typeof s !== "string") return [];
      const v: unknown = JSON.parse(s);
      return isRecord(v) ? [v] : [];
    });
  }
  moves() {
    return this.sent.flatMap((s) => (typeof s === "string" ? [] : [decodeMove(s)]));
  }
}

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
    expect(s.url).toBe(`wss://leaf.example/v1/game/live?v=${LIVE_VERSION}`);
    s.open();
    expect(s.texts().map((m) => m.t)).toEqual(["join", "ping"]);
    expect(s.texts()[0]).toEqual({ t: "join", room: "town" });

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
    expect(second.texts()[0]).toEqual({ t: "join", room: "town" });
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
