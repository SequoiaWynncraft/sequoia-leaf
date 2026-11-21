import { afterEach, describe, expect, it } from "bun:test";

import { CLOSE, encodeMove, Flag, type Motion, playerId } from "@sequoia-leaf/core";
import { Schema } from "effect";

import { Live, type LiveTuning } from "../src/live/live.ts";
import { LiveClient, type Opening } from "./live-client.ts";
import { type Backend, fakeBackend, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
const ORIGIN = "https://leaf.seqwawa.com";

// The real clock, which a test may move ahead: Live's tick and its waits keep time by it.
let ahead = 0;
const clock = {
  get now() {
    return Date.now() + ahead;
  },
  set now(_: number) {},
};
let backend: Backend;
let services: ReturnType<typeof testLeaf> | null = null;
let server: Awaited<ReturnType<ReturnType<typeof testLeaf>["serve"]>> | null = null;
const open: LiveClient[] = [];

/** Leaf on a free port, with Live tuned as the test needs. */
async function start(live: Partial<LiveTuning> = {}): Promise<string> {
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
    "carol-token": () => Response.json(sessionOf(carol, "Carol", null)),
  });
  backend = fake.backend;
  services = testLeaf(clock, fake.fetcher, {}, { live });
  server = await services.serve();
  return server.origin;
}

afterEach(async () => {
  ahead = 0;
  for (const c of open.splice(0)) c.close();
  await server?.close();
  await services?.dispose();
  server = null;
  services = null;
});

/** A player's game opening the live connection, as a browser on Leaf's page does by default. */
async function connect(sent: Opening): Promise<LiveClient> {
  const client = await LiveClient.open(server?.origin ?? "", sent);
  open.push(client);
  return client;
}

const census = () => services?.run(Live.use((live) => live.census));

const codeOf = async (response: Response) =>
  Schema.decodeUnknownSync(Schema.Struct({ code: Schema.String }))(await response.json()).code;

const page = (who: "alice" | "bob" | "carol"): Opening => ({ cookie: `${who}-token`, origin: ORIGIN });
const at = (x: number, y: number, flags: number = Flag.Moving, jump = 0): Motion => ({
  x,
  y,
  vx: 64,
  vy: 0,
  facing: 2,
  pose: 1,
  flags,
  jump,
});

/** The answer to a request to open a live connection that is refused before it is upgraded. */
async function refused(path: string, headers: Record<string, string>) {
  const response = await fetch(`${server?.origin ?? ""}${path}`, {
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
    const origin = await start();
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
    const plain = await fetch(`${origin}/v1/game/live?v=1`, { headers: { Authorization: "Bearer alice-token" } });
    expect([plain.status, await codeOf(plain)]).toEqual([400, "not_websocket"]);
  });

  it("opens for a member or a guest by the cookie from Leaf's page, and by a Bearer from anywhere", async () => {
    await start();
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

  it("turns a player away who opens connections too often, and anybody new when Live is full", async () => {
    await start({ mostPlayers: 2 });
    // The first is free; then ten more in a burst.
    const tabs = await Promise.all(Array.from({ length: 11 }, () => connect(page("alice"))));
    for (const tab of tabs) tab.close();
    expect(await refused("/v1/game/live?v=1", { Authorization: "Bearer alice-token" })).toEqual([429, "slow_down"]);

    await connect(page("bob"));
    expect(await refused("/v1/game/live?v=1", { Authorization: "Bearer carol-token" })).toEqual([503, "live_full"]);
  });
});

describe("a live room", () => {
  it("welcomes a player with who is there, and tells the others they came, member or guest", async () => {
    await start();
    const a = await connect(page("alice"));
    const welcome = await a.join();
    const c = await connect(page("carol"));
    const carols = await c.join();

    expect(welcome).toMatchObject({
      t: "welcome",
      v: 1,
      you: 1,
      room: "town/1",
      hz: 30,
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
    await start();
    const a = await connect(page("alice"));
    const b = await connect(page("bob"));
    await a.join();
    const { you: bobsId } = await b.join();

    const sentAt = performance.now();
    const seq = b.move(at(200, 120));
    const seen = await a.snapshot((s) => s.entries.some((e) => e.id === bobsId));
    const took = performance.now() - sentAt;

    expect(seen.entries).toEqual([{ id: bobsId, seq, ...at(200, 120) }]);
    expect(took).toBeLessThan(150);
  });

  it("shows a newcomer where everybody already is, at once, and keeps a player inside the room", async () => {
    await start();
    const a = await connect(page("alice"));
    const { you } = await a.join();
    a.move({ ...at(-40, 1e6, 0), jump: 2 });
    await a.snapshot();
    const b = await connect(page("bob"));
    await b.join();

    expect((await b.snapshot()).entries.map((e) => [e.id, e.x, e.y, e.jump])).toEqual([[you, 0, 352, 2]]);
  });

  it("passes on only the actions there are", async () => {
    await start();
    const a = await connect(page("alice"));
    const b = await connect(page("bob"));
    const { you } = await a.join();
    await b.join();
    a.send({ t: "act", kind: "emote", arg: "wave" });
    a.send({ t: "act", kind: "emote", arg: "you_are_dumb" });

    expect(await b.next("act")).toEqual({ t: "act", id: you, kind: "emote", arg: "wave" });
    expect(await a.next("error")).toEqual({ t: "error", code: "bad_act" });
    expect(b.texts.filter((m) => m.t === "act")).toEqual([]);
  });

  it("answers a ping with the game's clock and its own, and says what it cannot do", async () => {
    await start();
    const a = await connect(page("alice"));
    a.send({ t: "ping", c: 123.5 });
    a.send({ t: "act", kind: "emote", arg: "wave" });
    a.send({ t: "join", room: "hall" });

    expect(await a.next("pong")).toMatchObject({ t: "pong", c: 123.5 });
    expect(await a.next("error")).toEqual({ t: "error", code: "not_in_room" });
    expect(await a.next("error")).toEqual({ t: "error", code: "unknown_room" });
  });

  it("greets a player who joins the room they are in again, keeping their place, and nobody else hears", async () => {
    await start();
    const a = await connect(page("alice"));
    const first = await a.join();
    const b = await connect(page("bob"));
    await b.join();
    await a.next("joined");
    const again = await a.join();

    expect([again.room, again.you]).toEqual([first.room, first.you]);
    expect(again.roster.map((m) => m.name)).toEqual(["Alice", "Bob"]);
    await Bun.sleep(100);
    expect(b.texts.filter((m) => m.t === "joined" || m.t === "left")).toEqual([]);
    expect(await census()).toMatchObject({ players: 2, rooms: { "town/1": 2 } });
  });

  it("tells the others when somebody leaves the room", async () => {
    await start();
    const a = await connect(page("alice"));
    const b = await connect(page("bob"));
    await a.join();
    const { you: bobsId } = await b.join();
    b.send({ t: "leave" });

    expect(await a.next("left")).toEqual({ t: "left", id: bobsId });
    expect(await census()).toMatchObject({ players: 2, rooms: { "town/1": 1 } });
  });
});

describe("a player, whatever their connection", () => {
  it("keeps their place through a second tab, which takes it over without anybody seeing them go", async () => {
    await start();
    const watchers = await Promise.all(
      (["bob", "carol"] as const).map(async (who) => {
        const w = await connect(page(who));
        await w.join();
        return w;
      }),
    );
    const first = await connect(page("alice"));
    const { you } = await first.join();
    const second = await connect({ bearer: "alice-token" });
    const again = await second.join();

    expect((await first.ended()).code).toBe(CLOSE.replaced);
    expect(again.you).toBe(you);
    await Bun.sleep(100);
    for (const w of watchers) expect(w.texts.filter((m) => m.t === "left")).toEqual([]);
    expect(await census()).toEqual({ players: 3, connected: 3, rooms: { "town/1": 3 } });
  });

  it("stands still in their place for a while after a drop, keeps it if they come back, and leaves if not", async () => {
    await start({ graceMs: 300 });
    const b = await connect(page("bob"));
    await b.join();
    const a = await connect(page("alice"));
    const { you } = await a.join();
    await b.next("joined");
    a.move(at(100, 100, Flag.Moving));
    await b.snapshot((s) => s.entries.some((e) => e.id === you && e.flags === Flag.Moving));
    a.close();

    // They are seen to stop, not to go.
    const stopped = await b.snapshot((s) => s.entries.some((e) => e.id === you));
    expect(stopped.entries.find((e) => e.id === you)).toMatchObject({ x: 100, vx: 0, flags: 0 });
    const back = await connect(page("alice"));
    expect((await back.join()).you).toBe(you);
    back.close();

    expect(await b.next("left", (m) => m.id === you, 2000)).toEqual({ t: "left", id: you });
    expect(b.texts.filter((m) => m.t === "joined")).toEqual([]);
    expect(await census()).toEqual({ players: 1, connected: 1, rooms: { "town/1": 1 } });
  });

  it("is gone at once, the connection closed as signed out, when their session ends", async () => {
    await start({ recheckMs: 100 });
    const b = await connect(page("bob"));
    await b.join();
    const a = await connect(page("alice"));
    const { you } = await a.join();
    backend.sessions["alice-token"] = () => Response.json({ error: "unauthorized" }, { status: 401 });
    // A confirmed session is remembered for a minute; once that is up, it is asked about again.
    await Bun.sleep(300);
    expect(a.closed).toBeNull();
    ahead = 61_000;

    expect((await a.ended()).code).toBe(CLOSE.signedOut);
    expect(await b.next("left", (m) => m.id === you)).toEqual({ t: "left", id: you });
    expect(await census()).toEqual({ players: 1, connected: 1, rooms: { "town/1": 1 } });
  });
});

describe("what a connection may send", () => {
  it("drops what it cannot read and keeps going, and closes one that keeps sending it", async () => {
    await start();
    const a = await connect(page("alice"));
    a.sendRaw(new Uint8Array([1, 2, 3]));
    a.sendRaw("{ not json");
    a.sendRaw(JSON.stringify({ t: "teleport", x: 1 }));
    a.send({ t: "ping", c: 1 });
    expect(await a.next("pong")).toMatchObject({ c: 1 });

    for (let i = 0; i < 260; i++) a.sendRaw(new Uint8Array([9]));
    expect((await a.ended()).code).toBe(CLOSE.policy);
  });

  it("drops moves over its allowance, and closes a connection that floods", async () => {
    await start();
    const a = await connect(page("alice"));
    const b = await connect(page("bob"));
    await a.join();
    const { you } = await b.join();
    // Sixty at once: the first burst of forty is taken, the rest dropped.
    for (let seq = 1; seq <= 60; seq++) b.sendRaw(encodeMove(seq, at(seq, 10)));
    const seen = await a.snapshot((s) => s.entries.some((e) => e.id === you));
    expect(seen.entries.find((e) => e.id === you)?.seq).toBe(40);

    for (let seq = 61; seq <= 400; seq++) b.sendRaw(encodeMove(seq, at(seq, 10)));
    expect((await b.ended()).code).toBe(CLOSE.policy);
  });

  it("closes a frame larger than 4 KiB at once", async () => {
    await start();
    const a = await connect(page("alice"));
    a.sendRaw("x".repeat(5000));

    expect((await a.ended()).code).toBe(CLOSE.tooBig);
  });
});

describe("when Leaf stops", () => {
  it("closes every connection as restarting, for the game to come back", async () => {
    await start();
    const a = await connect(page("alice"));
    await a.join();
    await server?.close();

    expect(await a.ended()).toEqual({ code: CLOSE.restart, reason: "restart" });
  });
});
