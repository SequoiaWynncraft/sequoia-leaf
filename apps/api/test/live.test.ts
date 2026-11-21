import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { encodeMove, Flag, type Motion, playerId } from "@sequoia-leaf/core";
import { Schema } from "effect";

import { Live } from "../src/live/live.ts";
import { LiveClient, type Opening } from "./live-client.ts";
import { type Backend, fakeBackend, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const ORIGIN = "https://leaf.seqwawa.com";

const clock = { now: T0 };
let backend: Backend;
let services: ReturnType<typeof testLeaf>;
let server: Awaited<ReturnType<(typeof services)["serve"]>>;
const open: LiveClient[] = [];

beforeEach(async () => {
  clock.now = T0;
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
    "carol-token": () => Response.json(sessionOf(carol, "Carol", null)),
  });
  backend = fake.backend;
  services = testLeaf(clock, fake.fetcher);
  server = await services.serve();
});

afterEach(async () => {
  for (const c of open.splice(0)) c.close();
  await server.close();
  await services.dispose();
});

/** A player's game opening the live connection, as a browser on Leaf's page does by default. */
async function connect(sent: Opening = { cookie: "alice-token", origin: ORIGIN }): Promise<LiveClient> {
  const client = await LiveClient.open(server.origin, sent);
  open.push(client);
  return client;
}

const codeOf = async (response: Response) =>
  Schema.decodeUnknownSync(Schema.Struct({ code: Schema.String }))(await response.json()).code;

const page = (who: "alice" | "bob" | "carol"): Opening => ({ cookie: `${who}-token`, origin: ORIGIN });
const at = (x: number, y: number, flags: number = Flag.Moving): Motion => ({
  x,
  y,
  vx: 64,
  vy: 0,
  facing: 2,
  pose: 1,
  flags,
});

/** The answer to a request to open a live connection that is refused before it is upgraded. */
async function refused(path: string, headers: Record<string, string>) {
  const response = await fetch(`${server.origin}${path}`, {
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      ...headers,
    },
  });
  return [response.status, await codeOf(response)];
}

describe("opening a live connection", () => {
  it("is refused, before it is upgraded, as the API refuses", async () => {
    backend.sessions["down-token"] = () => new Response("down", { status: 502 });

    expect(await refused("/v1/game/live?v=1", {})).toEqual([401, "unauthorized"]);
    expect(await refused("/v1/game/live?v=1", { Cookie: "seq_session=stale", Origin: ORIGIN })).toEqual([
      401,
      "unauthorized",
    ]);
    // A page on another site can open a WebSocket to Leaf with the cookie, so it must be Leaf's own.
    expect(await refused("/v1/game/live?v=1", { Cookie: "seq_session=alice-token" })).toEqual([403, "bad_origin"]);
    expect(
      await refused("/v1/game/live?v=1", { Cookie: "seq_session=alice-token", Origin: "https://seqwawa.com" }),
    ).toEqual([403, "bad_origin"]);
    expect(await refused("/v1/game/live?v=1", { Authorization: "Bearer down-token" })).toEqual([
      503,
      "identity_unavailable",
    ]);
    expect(await refused("/v1/game/live", { Authorization: "Bearer alice-token" })).toEqual([
      400,
      "unsupported_version",
    ]);
    expect(await refused("/v1/game/live?v=2", { Authorization: "Bearer alice-token" })).toEqual([
      400,
      "unsupported_version",
    ]);
    const plain = await fetch(`${server.origin}/v1/game/live?v=1`, {
      headers: { Authorization: "Bearer alice-token" },
    });
    expect([plain.status, await codeOf(plain)]).toEqual([400, "not_websocket"]);
  });

  it("opens for a member or a guest by the cookie from Leaf's page, and by a Bearer from anywhere", async () => {
    const byCookie = await connect(page("alice"));
    const guest = await connect(page("carol"));
    const byBearer = await connect({ bearer: "bob-token" });

    expect((await byCookie.join()).roster.map((m) => m.name)).toEqual(["Alice"]);
    expect((await guest.join()).roster.map((m) => [m.name, m.guest])).toEqual([
      ["Alice", false],
      ["Carol", true],
    ]);
    expect((await byBearer.join()).roster.map((m) => m.name)).toEqual(["Alice", "Carol", "Bob"]);
  });
});

describe("a live room", () => {
  it("welcomes a player with who is there, and tells the others they came, member or guest", async () => {
    const a = await connect(page("alice"));
    const welcome = await a.join();
    const c = await connect(page("carol"));
    const carols = await c.join();

    expect(welcome).toEqual({
      t: "welcome",
      v: 1,
      you: 1,
      room: "town/1",
      hz: 30,
      time: T0,
      roster: [{ id: 1, player: alice, name: "Alice", rank: "CAPTAIN", guest: false }],
    });
    expect(carols.roster).toEqual([
      { id: 1, player: alice, name: "Alice", rank: "CAPTAIN", guest: false },
      { id: 2, player: carol, name: "Carol", rank: null, guest: true },
    ]);
    expect(await a.next("joined")).toEqual({
      t: "joined",
      member: { id: 2, player: carol, name: "Carol", rank: null, guest: true },
    });
  });

  it("sends a player's motion to everybody in the room within a tick or two", async () => {
    const a = await connect(page("alice"));
    const b = await connect(page("bob"));
    await a.join();
    const { you: bobsId } = await b.join();

    const sentAt = performance.now();
    const seq = b.move(at(200, 120));
    const seen = await a.snapshot((s) => s.entries.some((e) => e.id === bobsId));
    const took = performance.now() - sentAt;

    expect(seen.entries).toEqual([{ id: bobsId, seq, ...at(200, 120) }]);
    expect(seen.time).toBe(T0);
    // A tick is 33 ms; on this machine the rest is next to nothing.
    expect(took).toBeLessThan(150);
  });

  it("shows a newcomer where everybody already is, at once", async () => {
    const a = await connect(page("alice"));
    const { you } = await a.join();
    a.move(at(40, 300, 0));
    await a.snapshot();
    const b = await connect(page("bob"));
    await b.join();

    expect((await b.snapshot()).entries.map((e) => [e.id, e.x, e.y])).toEqual([[you, 40, 300]]);
  });

  it("keeps a player inside the room", async () => {
    const a = await connect(page("alice"));
    const b = await connect(page("bob"));
    await a.join();
    await b.join();
    b.move({ x: -30, y: 1e6, vx: 0, vy: 0, facing: 0, pose: 0, flags: Flag.Snap });

    expect((await a.snapshot()).entries.map((e) => [e.x, e.y, e.flags])).toEqual([[0, 352, Flag.Snap]]);
  });

  it("passes on what somebody did to the others, as short tokens only", async () => {
    const a = await connect(page("alice"));
    const b = await connect(page("bob"));
    const { you } = await a.join();
    await b.join();
    a.send({ t: "act", kind: "emote", arg: "wave" });
    a.send({ t: "act", kind: "say", arg: "Hello there, anybody about?" });

    expect(await b.next("act")).toEqual({ t: "act", id: you, kind: "emote", arg: "wave" });
    expect(await a.next("error")).toEqual({ t: "error", code: "bad_act" });
    expect(b.texts.filter((m) => m.t === "act")).toEqual([]);
  });

  it("answers a ping with the game's clock and its own, and says what it cannot do", async () => {
    const a = await connect(page("alice"));
    a.send({ t: "ping", c: 123.5 });
    a.send({ t: "act", kind: "emote", arg: "wave" });
    a.send({ t: "join", room: "hall" });

    expect(await a.next("pong")).toEqual({ t: "pong", c: 123.5, s: T0 });
    expect(await a.next("error")).toEqual({ t: "error", code: "not_in_room" });
    expect(await a.next("error")).toEqual({ t: "error", code: "unknown_room" });
  });

  it("tells the others when somebody leaves the room or closes the connection", async () => {
    const a = await connect(page("alice"));
    const b = await connect(page("bob"));
    const c = await connect(page("carol"));
    await a.join();
    const { you: bobsId } = await b.join();
    const { you: carolsId } = await c.join();
    b.send({ t: "leave" });
    c.close();

    expect(await a.next("left", (m) => m.id === bobsId)).toEqual({ t: "left", id: bobsId });
    expect(await a.next("left", (m) => m.id === carolsId)).toEqual({ t: "left", id: carolsId });
    expect(await services.run(Live.use((live) => live.census))).toMatchObject({ rooms: { "town/1": 1 } });
  });
});

describe("one connection a player", () => {
  it("closes the first when the same player opens a second, saying why, and keeps one figure in the room", async () => {
    const watcher = await connect(page("bob"));
    await watcher.join();
    const first = await connect(page("alice"));
    const { you: firstId } = await first.join();
    const second = await connect({ bearer: "alice-token" });
    await second.join();

    expect(await first.next("bye")).toEqual({ t: "bye", code: "replaced" });
    expect(await first.ended()).toEqual({ code: 4001, reason: "replaced" });
    expect(await watcher.next("left", (m) => m.id === firstId)).toBeDefined();
    expect(await services.run(Live.use((live) => live.census))).toEqual({ players: 2, rooms: { "town/1": 2 } });
  });
});

describe("what a connection may send", () => {
  it("drops what it cannot read and keeps going, and closes one that keeps sending it", async () => {
    const a = await connect(page("alice"));
    a.sendRaw(new Uint8Array([1, 2, 3]));
    a.sendRaw("{ not json");
    a.sendRaw(JSON.stringify({ t: "teleport", x: 1 }));
    a.send({ t: "ping", c: 1 });
    expect(await a.next("pong")).toMatchObject({ c: 1 });

    for (let i = 0; i < 260; i++) a.sendRaw(new Uint8Array([9]));
    expect(await a.next("bye")).toEqual({ t: "bye", code: "invalid" });
    expect((await a.ended()).code).toBe(1008);
  });

  it("drops moves over its allowance, and closes a connection that floods", async () => {
    const a = await connect(page("alice"));
    const b = await connect(page("bob"));
    await a.join();
    const { you } = await b.join();
    // Sixty at once: the first burst of forty is taken, the rest dropped.
    for (let seq = 1; seq <= 60; seq++) b.sendRaw(encodeMove(seq, at(seq, 10)));
    const seen = await a.snapshot((s) => s.entries.some((e) => e.id === you));

    expect(seen.entries.find((e) => e.id === you)?.seq).toBe(40);

    for (let seq = 61; seq <= 400; seq++) b.sendRaw(encodeMove(seq, at(seq, 10)));
    expect(await b.next("bye")).toEqual({ t: "bye", code: "rate" });
    expect((await b.ended()).code).toBe(1008);
  });

  it("closes a frame larger than 4 KiB at once", async () => {
    const a = await connect(page("alice"));
    a.sendRaw("x".repeat(5000));

    expect((await a.ended()).code).toBe(1009);
  });
});

describe("when Leaf stops", () => {
  it("tells everybody it is restarting, and closes their connections to come back", async () => {
    const a = await connect(page("alice"));
    await a.join();
    await server.close();

    expect(await a.next("bye")).toEqual({ t: "bye", code: "restart" });
    expect(await a.ended()).toEqual({ code: 1012, reason: "restart" });
  });
});
