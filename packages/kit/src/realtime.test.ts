import { afterEach, describe, expect, test } from "bun:test";

import { decodeMove, encodeSnapshot, Flag, type Motion, type ToClient } from "@sequoia-leaf/core";

import { restart, start } from "./live.ts";
import { isRecord, type LiveSocket, pretend } from "./net.ts";
import { forgetLedger } from "./purse.ts";
import { ClockSync, joinLive, type LiveRoom, type LiveStatus, retryAfter, Track } from "./realtime.ts";
import { HELLO, type Standin, standin, TESTER } from "./standin.ts";

const at = (x: number, y: number, flags = 0, vx = 0, vy = 0): Motion => ({ x, y, vx, vy, facing: 1, pose: 0, flags });

describe("Leaf's clock", () => {
  test("is the offset the quickest ping saw, and the welcome's until a ping comes back", () => {
    const c = new ClockSync();
    c.guess(10_000, 1000);
    expect(c.server(1500)).toBe(10_500);
    expect(c.rtt()).toBeNull();

    // Sent at 2000, back at 2100: Leaf said 11_060, so it is 9010 ahead, give or take 50.
    c.add(2000, 11_060, 2100);
    // A slow one (400 ms) says something else; the quick one is believed.
    c.add(3000, 12_500, 3400);
    expect(c.server(4000)).toBe(13_010);
    expect(c.rtt()).toBe(100);
    c.guess(0, 0);
    expect(c.server(4000)).toBe(13_010);
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
    t.add(1000, at(100, 50, Flag.Moving, 64, 0));
    expect(t.at(1100)).toMatchObject({ x: 106.4, y: 50 });
    expect(t.at(5000)).toMatchObject({ x: 112.8 });
    const still = new Track();
    still.add(1000, at(100, 50, 0, 64, 0));
    expect(still.at(1500)).toMatchObject({ x: 100 });
  });

  test("is not drawn on the way across a jump", () => {
    const t = new Track();
    t.add(1000, at(0, 0));
    t.add(1100, at(400, 300, Flag.Snap));
    expect(t.at(1099)).toMatchObject({ x: 0, y: 0 });
    expect(t.at(1100)).toMatchObject({ x: 400, y: 300 });
  });

  test("keeps about a second, and takes no snapshot older than the newest", () => {
    const t = new Track();
    for (let time = 0; time <= 3000; time += 100) t.add(time, at(time, 0));
    t.add(2000, at(-1, -1));
    expect(t.at(1000)).toMatchObject({ x: 1900 });
    expect(t.at(2950)).toMatchObject({ x: 2950 });
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
  closed = false;
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
  close(): void {
    this.closed = true;
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

  async function live(): Promise<void> {
    world = standin({ "GET /v1/game/hello": HELLO, "GET /v1/game/me": { status: 200, body: TESTER } });
    await start();
    undo = pretend({
      socket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
  }

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
    room.move(at(1, 1));
    expect(opened).toBe(0);
    expect(room.members().size).toBe(0);
  });

  test("joins the room next to the page, learns who is there, and follows them", async () => {
    await live();
    const heard: string[] = [];
    room = joinLive("town", {
      welcome: (you, name, roster) => heard.push(`welcome ${you} ${name} ${roster.length}`),
      joined: (m) => heard.push(`joined ${m.name}`),
      left: (id) => heard.push(`left ${id}`),
      act: (id, kind, arg) => heard.push(`act ${id} ${kind} ${arg}`),
    });
    const s = sockets[0];
    if (!s) throw new Error("no socket");
    expect(s.url).toBe("wss://leaf.example/v1/game/live?v=1");
    s.open();
    expect(s.texts().map((m) => m.t)).toEqual(["join", "ping"]);
    expect(s.texts()[0]).toEqual({ t: "join", room: "town" });

    const now = world?.clock.now ?? 0;
    s.says({ t: "welcome", v: 1, you: 1, room: "town/1", hz: 30, time: now + 5000, roster: [{ ...ALICE, id: 1 }] });
    s.says({ t: "joined", member: ALICE });
    s.says({ t: "act", id: 2, kind: "emote", arg: "wave" });
    // Alice walks right: two snapshots 100 ms apart by Leaf's clock; Leaf's own figure (1) is not followed.
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

  test("sends motion at most twenty times a second, the last change always, and starting or stopping at once", async () => {
    await live();
    room = joinLive("town");
    const s = sockets[0];
    if (!s || !world) throw new Error("no socket");
    s.open();
    room.move(at(0, 0, Flag.Moving));
    world.clock.now += 10;
    room.move(at(1, 0, Flag.Moving));
    room.move(at(2, 0, Flag.Moving));
    expect(s.moves().map((m) => m?.motion.x)).toEqual([0]);
    await Bun.sleep(70);
    expect(s.moves().map((m) => m?.motion.x)).toEqual([0, 2]);

    world.clock.now += 10;
    room.move(at(2, 0, 0));
    room.move(at(2, 0, 0));
    expect(s.moves().map((m) => [m?.seq, m?.motion.flags])).toEqual([
      [1, Flag.Moving],
      [2, Flag.Moving],
      [3, 0],
    ]);
  });

  test("after a drop, connects again, joins again, and says where the player is as a jump", async () => {
    await live();
    const seen: LiveStatus[] = [];
    room = joinLive("town", { status: (st) => seen.push(st) });
    const first = sockets[0];
    if (!first) throw new Error("no socket");
    first.open();
    room.move(at(30, 40, 0));
    first.drop();
    expect(seen).toEqual(["connecting", "open", "closed"]);

    await Bun.sleep(800);
    const second = sockets[1];
    if (!second) throw new Error("did not connect again");
    second.open();
    second.says({ t: "welcome", v: 1, you: 5, room: "town/1", hz: 30, time: 0, roster: [] });
    expect(second.texts()[0]).toEqual({ t: "join", room: "town" });
    expect(second.moves().map((m) => [m?.motion.x, m?.motion.flags])).toEqual([[30, Flag.Snap]]);
    expect(seen).toEqual(["connecting", "open", "closed", "connecting", "open"]);
  });

  test("lets go for good when the player opened the game live somewhere else", async () => {
    await live();
    const seen: LiveStatus[] = [];
    room = joinLive("town", { status: (st) => seen.push(st) });
    const s = sockets[0];
    if (!s) throw new Error("no socket");
    s.open();
    s.says({ t: "bye", code: "replaced" });
    s.drop(4001);
    await Bun.sleep(800);
    expect(sockets.length).toBe(1);
    expect(seen).toEqual(["connecting", "open", "replaced"]);
  });

  test("leaves and closes when the page is done with it", async () => {
    await live();
    room = joinLive("town");
    const s = sockets[0];
    if (!s) throw new Error("no socket");
    s.open();
    room.close();
    expect(s.texts().at(-1)).toEqual({ t: "leave" });
    expect(s.closed).toBe(true);
  });
});
