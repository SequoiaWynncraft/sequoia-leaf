import { afterEach, describe, expect, it } from "bun:test";

import { CLOSE, encodeMove, Flag, LIVE_PATH, LIVE_VERSION, livePath, type Motion, playerId } from "@sequoia-leaf/core";
import { Deferred, Effect, Fiber, Redacted, Schema } from "effect";
import { Socket } from "effect/socket";

import { Live, type LiveTuning } from "../src/live/live.ts";
import { LiveClient, type Opening } from "./live-client.ts";
import { type Backend, fakeBackend, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
const ORIGIN = "https://leaf.seqwawa.com";
const LIVE = livePath("town");

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
    // Alice signed in a second time, on another device.
    "alice-2-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
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

    expect(await refused(LIVE, {})).toEqual([401, "unauthorized"]);
    expect(await refused(LIVE, { Cookie: "seq_session=stale", Origin: ORIGIN })).toEqual([401, "unauthorized"]);
    // A page on another site can open a WebSocket to Leaf with the cookie, so it must be Leaf's own.
    expect(await refused(LIVE, { Cookie: "seq_session=alice-token" })).toEqual([403, "bad_origin"]);
    expect(await refused(LIVE, { Cookie: "seq_session=alice-token", Origin: "https://seqwawa.com" })).toEqual([
      403,
      "bad_origin",
    ]);
    expect(await refused(LIVE, { Authorization: "Bearer down-token" })).toEqual([503, "identity_unavailable"]);
    expect(await refused("/v1/game/live", { Authorization: "Bearer alice-token" })).toEqual([
      400,
      "unsupported_version",
    ]);
    // Version 1 had no jump count; nothing speaks it.
    expect(await refused(`${LIVE_PATH}?v=1&room=town`, { Authorization: "Bearer alice-token" })).toEqual([
      400,
      "unsupported_version",
    ]);
    // A connection is into a room, one there is.
    expect(await refused(`${LIVE_PATH}?v=${LIVE_VERSION}`, { Authorization: "Bearer alice-token" })).toEqual([
      400,
      "unknown_room",
    ]);
    expect(await refused(livePath("hall"), { Authorization: "Bearer alice-token" })).toEqual([400, "unknown_room"]);
    const plain = await fetch(`${origin}${LIVE}`, { headers: { Authorization: "Bearer alice-token" } });
    expect([plain.status, await codeOf(plain)]).toEqual([400, "not_websocket"]);
  });

  it("counts every opening it turns away, by its code, for the minute's log line", async () => {
    await start();
    await refused(LIVE, {});
    await refused(LIVE, { Cookie: "seq_session=stale", Origin: ORIGIN });
    await refused(LIVE, { Cookie: "seq_session=alice-token" });
    await refused(livePath("hall"), { Authorization: "Bearer alice-token" });
    const tabs = await Promise.all(Array.from({ length: 10 }, () => connect(page("alice"))));
    await refused(LIVE, { Authorization: "Bearer alice-token" });
    for (const tab of tabs) tab.close();

    expect(await services?.run(Live.use((live) => live.line))).toMatchObject({
      opened: 10,
      refused: { unauthorized: 2, bad_origin: 1, unknown_room: 1, slow_down: 1 },
    });
  });

  it("opens for a member or a guest by the cookie from Leaf's page, and by a Bearer from anywhere", async () => {
    await start();
    const byCookie = await connect(page("alice"));
    const guest = await connect(page("carol"));
    const byBearer = await connect({ bearer: "bob-token" });

    expect((await byCookie.welcome()).roster.map((m) => m.name)).toEqual(["Alice"]);
    expect((await guest.welcome()).roster.map((m) => [m.name, m.guest])).toEqual([
      ["Alice", false],
      ["Carol", true],
    ]);
    expect((await byBearer.welcome()).roster.map((m) => m.name)).toEqual(["Alice", "Carol", "Bob"]);
  });

  it("charges every connection a player opens, and turns them away past ten at once", async () => {
    await start();
    const tabs = await Promise.all(Array.from({ length: 10 }, () => connect(page("alice"))));
    for (const tab of tabs) tab.close();

    expect(await refused(LIVE, { Authorization: "Bearer alice-token" })).toEqual([429, "slow_down"]);
  });

  it("keeps what a player owes after they have left, so that leaving refills nothing", async () => {
    await start({ graceMs: 50 });
    const tabs = await Promise.all(Array.from({ length: 10 }, () => connect(page("alice"))));
    await tabs.at(-1)?.welcome();
    for (const tab of tabs) tab.close();
    await Bun.sleep(300);

    expect(await census()).toMatchObject({ connected: 0, rooms: {} });
    expect(await refused(LIVE, { Authorization: "Bearer alice-token" })).toEqual([429, "slow_down"]);
  });

  it("never lets in more players than it holds, however many open at once", async () => {
    await start({ mostPlayers: 2 });
    const opened = await Promise.allSettled(
      (["alice", "bob", "carol"] as const).map((who) => LiveClient.open(server?.origin ?? "", page(who))),
    );
    for (const o of opened) if (o.status === "fulfilled") open.push(o.value);

    expect(opened.filter((o) => o.status === "fulfilled").length).toBe(2);
    expect(await census()).toMatchObject({ players: 2, connected: 2 });
  });
});

describe("a live room", () => {
  it("welcomes a player with who is there, and tells the others they came, member or guest", async () => {
    await start();
    const a = await connect(page("alice"));
    const welcome = await a.welcome();
    const c = await connect(page("carol"));
    const carols = await c.welcome();

    expect(welcome).toMatchObject({
      t: "welcome",
      v: LIVE_VERSION,
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
    await a.welcome();
    const { you: bobsId } = await b.welcome();

    const sentAt = performance.now();
    const seq = b.move(at(200, 120));
    const seen = await a.snapshot((s) => s.entries.some((e) => e.id === bobsId));
    const took = performance.now() - sentAt;

    // Their first move, and so a jump to everybody else.
    expect(seen.entries).toEqual([{ id: bobsId, seq, ...at(200, 120, Flag.Moving, 1) }]);
    expect(took).toBeLessThan(150);
  });

  it("shows a newcomer where everybody already is, at once, and keeps a player inside the room", async () => {
    await start();
    const a = await connect(page("alice"));
    const { you } = await a.welcome();
    a.move({ ...at(-40, 1e6, 0), jump: 2 });
    await a.snapshot();
    const b = await connect(page("bob"));
    await b.welcome();

    // Leaf counts the jumps everybody is shown: their first move is one.
    expect((await b.snapshot()).entries.map((e) => [e.id, e.x, e.y, e.jump])).toEqual([[you, 0, 352, 1]]);
  });

  it("passes on only the actions there are", async () => {
    await start();
    const a = await connect(page("alice"));
    const b = await connect(page("bob"));
    const { you } = await a.welcome();
    await b.welcome();
    a.send({ t: "act", kind: "emote", arg: "wave" });
    a.send({ t: "act", kind: "emote", arg: "you_are_dumb" });

    expect(await b.next("act")).toEqual({ t: "act", id: you, kind: "emote", arg: "wave" });
    expect(await a.next("error")).toEqual({ t: "error", code: "bad_act" });
    expect(b.texts.filter((m) => m.t === "act")).toEqual([]);
  });

  it("passes on a touch to everybody else and not back, refuses a name there is not, and holds the rate", async () => {
    await start();
    const a = await connect(page("alice"));
    const b = await connect(page("bob"));
    const { you } = await a.welcome();
    await b.welcome();
    a.send({ t: "act", kind: "touch", arg: "post:174,100" });
    a.send({ t: "act", kind: "touch", arg: "dragon:1,2" });

    expect(await b.next("act")).toEqual({ t: "act", id: you, kind: "touch", arg: "post:174,100" });
    expect(await a.next("error")).toEqual({ t: "error", code: "bad_act" });
    // Six at once, then three a second: after the post, five of eight sent together pass.
    for (let i = 0; i < 8; i++) a.send({ t: "act", kind: "touch", arg: `crab:${i + 1}` });
    await Bun.sleep(200);
    expect(b.texts.filter((m) => m.t === "act").map((m) => m.arg)).toEqual([
      "crab:1",
      "crab:2",
      "crab:3",
      "crab:4",
      "crab:5",
    ]);
    expect(a.texts.filter((m) => m.t === "act")).toEqual([]);
  });

  it("answers a ping with the game's clock and its own, and says what it cannot do", async () => {
    await start();
    const a = await connect(page("alice"));
    await a.welcome();
    a.send({ t: "ping", c: 123.5 });
    a.send({ t: "leave" });
    a.send({ t: "act", kind: "emote", arg: "wave" });
    a.send({ t: "join", room: "hall" });

    expect(await a.next("pong")).toMatchObject({ t: "pong", c: 123.5 });
    expect(await a.next("error")).toEqual({ t: "error", code: "not_in_room" });
    expect(await a.next("error")).toEqual({ t: "error", code: "unknown_room" });
  });

  it("greets a player who joins the room they are in again, keeping their place, and nobody else hears", async () => {
    await start();
    const a = await connect(page("alice"));
    const first = await a.welcome();
    const b = await connect(page("bob"));
    await b.welcome();
    await a.next("joined");
    const again = await a.join("town");

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
    await a.welcome();
    const { you: bobsId } = await b.welcome();
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
        await w.welcome();
        return w;
      }),
    );
    const first = await connect(page("alice"));
    const { you } = await first.welcome();
    const second = await connect({ bearer: "alice-token" });
    const again = await second.welcome();

    expect((await first.ended()).code).toBe(CLOSE.replaced);
    expect(again.you).toBe(you);
    await Bun.sleep(100);
    for (const w of watchers) expect(w.texts.filter((m) => m.t === "left")).toEqual([]);
    expect(await census()).toEqual({ players: 3, connected: 3, rooms: { "town/1": 3 } });
  });

  it("follows a second tab's moves at once, though it numbers them from the start, and shows it as a jump", async () => {
    await start();
    const b = await connect(page("bob"));
    await b.welcome();
    const first = await connect(page("alice"));
    const { you } = await first.welcome();
    for (let i = 0; i < 30; i++) first.move(at(i, 10));
    const before = await b.snapshot((s) => s.entries.some((e) => e.id === you && e.x === 29));
    const second = await connect({ bearer: "alice-token" });
    await second.welcome();
    const seq = second.move(at(300, 200, 0));

    const after = await b.snapshot((s) => s.entries.some((e) => e.id === you && e.x === 300));
    const was = before.entries.find((e) => e.id === you);
    const now = after.entries.find((e) => e.id === you);
    expect(now?.seq).toBe(seq);
    expect(now?.jump).not.toBe(was?.jump);
  });

  it("is not let go by an old connection's session ending once a new one has taken over", async () => {
    await start({ recheckMs: 50 });
    const b = await connect(page("bob"));
    await b.welcome();
    const first = await connect(page("alice"));
    const { you } = await first.welcome();
    const second = await connect({ bearer: "alice-2-token" });
    await second.welcome();
    // The first device's session is revoked; the second's is not.
    backend.sessions["alice-token"] = () => Response.json({ error: "unauthorized" }, { status: 401 });
    ahead = 61_000;
    await Bun.sleep(300);

    expect(second.closed).toBeNull();
    expect(b.texts.filter((m) => m.t === "left" && m.id === you)).toEqual([]);
    expect(await census()).toEqual({ players: 2, connected: 2, rooms: { "town/1": 2 } });
  });

  it("stands still in their place for a while after a drop, keeps it if they come back, and leaves if not", async () => {
    await start({ graceMs: 300 });
    const b = await connect(page("bob"));
    await b.welcome();
    const a = await connect(page("alice"));
    const { you } = await a.welcome();
    await b.next("joined");
    a.move(at(100, 100, Flag.Moving));
    await b.snapshot((s) => s.entries.some((e) => e.id === you && e.flags === Flag.Moving));
    a.close();

    // They are seen to stop, not to go.
    const stopped = await b.snapshot((s) => s.entries.some((e) => e.id === you));
    expect(stopped.entries.find((e) => e.id === you)).toMatchObject({ x: 100, vx: 0, flags: 0 });
    const back = await connect(page("alice"));
    expect((await back.welcome()).you).toBe(you);
    back.close();

    expect(await b.next("left", (m) => m.id === you, 2000)).toEqual({ t: "left", id: you });
    expect(b.texts.filter((m) => m.t === "joined")).toEqual([]);
    // Alice's record stays a while yet, for what she owes on opening connections; she is in no room.
    expect(await census()).toMatchObject({ connected: 1, rooms: { "town/1": 1 } });
  });

  it("is gone at once, the connection closed as signed out, when their session ends", async () => {
    await start({ recheckMs: 100 });
    const b = await connect(page("bob"));
    await b.welcome();
    const a = await connect(page("alice"));
    const { you } = await a.welcome();
    backend.sessions["alice-token"] = () => Response.json({ error: "unauthorized" }, { status: 401 });
    // A confirmed session is remembered for a minute; once that is up, it is asked about again.
    await Bun.sleep(300);
    expect(a.closed).toBeNull();
    ahead = 61_000;

    expect((await a.ended()).code).toBe(CLOSE.signedOut);
    expect(await b.next("left", (m) => m.id === you)).toEqual({ t: "left", id: you });
    expect(await census()).toMatchObject({ connected: 1, rooms: { "town/1": 1 } });
  });
});

interface Row {
  player_id: string;
  username: string;
  place: string;
  seen_at: number;
  stay: number;
  guest: number;
}
const rows = () =>
  services?.query<Row>(
    (sql) => sql`SELECT player_id, username, place, seen_at, stay, guest FROM presence ORDER BY username`,
  ) ?? Promise.resolve([]);
/** The presence rows once they pass `which`, waiting a little for Live to write them. */
async function rowsWhen(which: (rows: readonly Row[]) => boolean, ms = 2000): Promise<readonly Row[]> {
  const until = Date.now() + ms;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- looking again until Live has written
    const now = await rows();
    if (which(now)) return now;
    if (Date.now() > until) throw new Error(`Waited ${ms} ms in vain: ${JSON.stringify(now)}`);
    // oxlint-disable-next-line no-await-in-loop -- as above
    await Bun.sleep(20);
  }
}
/** A player's page saying where they are, as `PUT /v1/game/presence`. */
const sayHere = (token: string, place: string, stay?: boolean) =>
  fetch(`${server?.origin ?? ""}/v1/game/presence`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(stay === undefined ? { place } : { place, stay }),
  });

describe("where players are, from the room", () => {
  it("writes a player into the town as they come in, as their game would, keeping what they said about staying", async () => {
    await start();
    expect((await sayHere("alice-token", "camp", false)).status).toBe(200);
    ahead = 60_000;
    const from = Date.now() + ahead;
    const a = await connect(page("alice"));
    await a.welcome();
    const c = await connect(page("carol"));
    await c.welcome();

    const written = await rowsWhen((r) => r.length === 2 && r.every((row) => row.place === "town"));
    expect(written.map((row) => [row.player_id, row.username, row.place, row.stay, row.guest])).toEqual([
      [alice, "Alice", "town", 0, 0],
      // Never seen before: they stay, as a game that says nothing about it has them.
      [carol, "Carol", "town", 1, 1],
    ]);
    expect(written.every((row) => row.seen_at >= from)).toBe(true);
    // Another page asking who is here hears them there, though neither page has said so.
    const heard: unknown = await (await sayHere("bob-token", "works")).json();
    expect(heard).toMatchObject({
      present: [
        { username: "Alice", place: "town" },
        { username: "Bob", place: "works" },
        { username: "Carol", place: "town", guest: true },
      ],
    });
  });

  it("writes them again while they stay, so they are never taken to have gone", async () => {
    await start({ presenceMs: 100 });
    const a = await connect(page("alice"));
    await a.welcome();
    const first = (await rowsWhen((r) => r.length === 1))[0]?.seen_at ?? 0;
    ahead = 80_000;

    const again = await rowsWhen((r) => (r[0]?.seen_at ?? 0) >= first + 80_000);
    expect(again.map((row) => row.place)).toEqual(["town"]);
  });

  it("writes when they go that they were last seen there then, unless their game has said since where else they are", async () => {
    await start({ graceMs: 100 });
    const a = await connect(page("alice"));
    await a.welcome();
    const b = await connect(page("bob"));
    await b.welcome();
    await rowsWhen((r) => r.length === 2);
    ahead = 40_000;
    const left = Date.now() + ahead;
    // Alice's page leaves the room and closes; Bob's game says he has gone to the Works, then closes.
    a.send({ t: "leave" });
    a.close();
    expect((await sayHere("bob-token", "works")).status).toBe(200);
    b.close();

    const after = await rowsWhen((r) => (r[0]?.seen_at ?? 0) >= left);
    await Bun.sleep(300);
    expect((await rows()).map((row) => [row.username, row.place])).toEqual([
      ["Alice", "town"],
      ["Bob", "works"],
    ]);
    expect(after[0]?.seen_at).toBeLessThan(left + 1000);
  });

  it("lists somebody who leaves the room as gone at once, from then, and as here again when they come back", async () => {
    await start();
    const a = await connect(page("alice"));
    await a.welcome();
    await rowsWhen((r) => r.length === 1);
    ahead = 20_000;
    const left = Date.now() + ahead;
    a.send({ t: "leave" });
    await rowsWhen((r) => (r[0]?.seen_at ?? 0) >= left);

    const gone: unknown = await (await sayHere("bob-token", "works")).json();
    expect(gone).toMatchObject({ present: [{ username: "Bob", place: "works" }], resting: [{ username: "Alice" }] });
    const seen = Date.parse(
      Schema.decodeUnknownSync(Schema.Struct({ resting: Schema.Tuple([Schema.Struct({ seen_at: Schema.String })]) }))(
        gone,
      ).resting[0].seen_at,
    );
    expect(seen - left).toBeLessThan(1000);
    expect(seen).toBeGreaterThanOrEqual(left);

    a.send({ t: "join", room: "town" });
    await a.welcome();
    await rowsWhen((r) => r.length === 2 && r.every((row) => row.place !== "camp"));
    const back: unknown = await (await sayHere("bob-token", "works")).json();
    expect(back).toMatchObject({ present: [{ username: "Alice", place: "town" }, { username: "Bob" }], resting: [] });
  });

  it("tells everybody in every room when who is where changes, once it is written, and not when it is only said again", async () => {
    await start();
    const a = await connect(page("alice"));
    await a.welcome();
    await rowsWhen((r) => r.length === 1);
    await Bun.sleep(100);
    a.texts.length = 0;
    const b = await connect(page("bob"));
    await b.welcome();
    // Bob coming in is a change: Alice hears of it, and so does Bob.
    await a.next("about");
    await b.next("about");
    await Bun.sleep(100);
    expect([...a.texts, ...b.texts].filter((m) => m.t === "about")).toEqual([]);

    // Carol's game says she is at the Works: a change; saying it again is not.
    expect((await sayHere("carol-token", "works")).status).toBe(200);
    await a.next("about");
    await b.next("about");
    expect((await sayHere("carol-token", "works")).status).toBe(200);
    await Bun.sleep(150);
    expect(a.texts.filter((m) => m.t === "about")).toEqual([]);

    // Bob leaves the room: Alice hears it, and Leaf's list says so by the time she does.
    b.send({ t: "leave" });
    await a.next("about");
    const now: unknown = await (
      await fetch(`${server?.origin ?? ""}/v1/game/presence`, {
        headers: { Authorization: "Bearer alice-token" },
      })
    ).json();
    expect(now).toMatchObject({
      present: [{ username: "Alice" }, { username: "Carol" }],
      resting: [{ username: "Bob" }],
    });
  });

  it("tells everybody in every room when somebody away does something again, and not at every move", async () => {
    await start();
    const a = await connect(page("alice"));
    await a.welcome();
    const b = await connect(page("bob"));
    await b.welcome();
    b.move(at(100, 100, 0));
    await rowsWhen((r) => r.length === 2);
    await Bun.sleep(150);
    a.texts.length = 0;

    // Bob has done nothing Leaf heard of yet: away. His first move somewhere brings him back.
    b.move(at(110, 100));
    await a.next("about");
    b.move(at(120, 100));
    await Bun.sleep(150);
    expect(a.texts.filter((m) => m.t === "about")).toEqual([]);
  });

  it("writes them gone at the end of their grace when the connection drops", async () => {
    await start({ graceMs: 150 });
    const a = await connect(page("alice"));
    await a.welcome();
    const first = (await rowsWhen((r) => r.length === 1))[0]?.seen_at ?? 0;
    a.close();
    ahead = 30_000;

    const gone = await rowsWhen((r) => (r[0]?.seen_at ?? 0) >= first + 30_000);
    expect(gone.map((row) => row.place)).toEqual(["town"]);
    expect(await census()).toMatchObject({ connected: 0, rooms: {} });
  });
});

describe("opening a connection", () => {
  it("is entering the room: the welcome is the first thing it says, before anything of the room", async () => {
    await start();
    const b = await connect(page("bob"));
    const { you: bobsId } = await b.welcome();
    for (let i = 0; i < 30; i++) b.move(at(i, 0));
    const a = await connect(page("alice"));
    await b.snapshot((s) => s.entries.some((e) => e.id === bobsId && e.x === 29));

    expect(a.arrived.slice(0, 2)).toEqual(["welcome", "snapshot"]);
    expect((await a.welcome()).roster.map((m) => m.name)).toEqual(["Bob", "Alice"]);
  });

  it("holds a player's place among the players while their socket opens, however long that takes", async () => {
    await start({ mostPlayers: 1 });
    const sessionOk = Effect.succeed(true);
    const session = Redacted.make("a session");
    const alicesIdentity = { playerId: alice, username: "Alice", guildRank: "CAPTAIN", admin: false, session };
    const bobsIdentity = { playerId: bob, username: "Bob", guildRank: "RECRUIT", admin: false, session };
    const opening = await Effect.runPromise(Deferred.make<Socket.Socket, Error>());
    // Alice's socket is slow to open: past the time her open's charge refills.
    const pending = services?.run(
      Effect.scoped(Live.use((live) => live.open(alicesIdentity, "town", Deferred.await(opening), sessionOk))).pipe(
        Effect.exit,
      ),
    );
    await Bun.sleep(50);
    ahead = 60_000;
    await Bun.sleep(100);

    expect(await census()).toMatchObject({ players: 1, connected: 0 });
    // Her place is held: nobody else gets it meanwhile.
    expect(
      await services?.run(
        Effect.scoped(Live.use((live) => live.open(bobsIdentity, "town", Deferred.await(opening), sessionOk))),
      ),
    ).toBe("full");

    await Effect.runPromise(Deferred.fail(opening, new Error("never opened")));
    await pending;
    await Bun.sleep(100);
    expect(await census()).toMatchObject({ players: 0, connected: 0, rooms: {} });
  });

  it("shows a player as they are now when a new connection of theirs takes over", async () => {
    await start();
    const b = await connect(page("bob"));
    await b.welcome();
    const first = await connect(page("alice"));
    const { you } = await first.welcome();
    await b.next("joined");
    // Alice is a recruit now, as her second device's session says.
    backend.sessions["alice-2-token"] = () => Response.json(sessionOf(alice, "Alice", "RECRUIT"));
    const second = await connect({ bearer: "alice-2-token" });
    const again = await second.welcome();

    expect(await b.next("left")).toEqual({ t: "left", id: you });
    expect(await b.next("joined")).toEqual({
      t: "joined",
      member: { id: again.you, player: alice, name: "Alice", rank: "RECRUIT", guest: false },
    });
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
    await a.welcome();
    const { you } = await b.welcome();
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

/** A socket standing in for Bun's, writing down what Leaf writes to it. It is never read. */
function standInSocket(written: unknown[]): Socket.Socket {
  return Socket.make({
    reader: Effect.succeed({ pull: Effect.never, upgrade: () => Effect.void }),
    writer: Effect.succeed({
      write: (chunk) => Effect.sync(() => void written.push(chunk)),
      writeAll: (chunks) => Effect.sync(() => void written.push(...chunks)),
    }),
  });
}

const alicesIdentity = {
  playerId: alice,
  username: "Alice",
  guildRank: "CAPTAIN",
  admin: false,
  session: Redacted.make("alice"),
};
const signedIn = Effect.succeed(true);

describe("an open interrupted while its socket opens", () => {
  it("lets go of the player's place, however it was interrupted", async () => {
    await start();
    await services?.run(
      Effect.gen(function* () {
        const live = yield* Live;
        const opening = yield* Deferred.make<Socket.Socket, Error>();
        const fiber = yield* Effect.forkChild(
          Effect.scoped(live.open(alicesIdentity, "town", Deferred.await(opening), signedIn)),
        );
        yield* Effect.sleep("50 millis");
        yield* Fiber.interrupt(fiber);
      }),
    );
    ahead = 60_000;
    await Bun.sleep(100);

    expect(await census()).toEqual({ players: 0, connected: 0, rooms: {} });
  });
});

describe("when Leaf stops", () => {
  it("closes every connection as restarting, for the game to come back", async () => {
    await start();
    const a = await connect(page("alice"));
    await a.welcome();
    await server?.close();

    expect(await a.ended()).toEqual({ code: CLOSE.restart, reason: "restart" });
  });

  it("lets nobody in after its farewell, and tells a socket that finishes opening after it to come back", async () => {
    await start();
    const written: unknown[] = [];
    const outcome = await services?.run(
      Effect.gen(function* () {
        const live = yield* Live;
        const opening = yield* Deferred.make<Socket.Socket, Error>();
        const slow = yield* Effect.forkChild(
          Effect.scoped(live.open(alicesIdentity, "town", Deferred.await(opening), signedIn)),
        );
        yield* Effect.sleep("50 millis");
        yield* live.farewell;
        const late = yield* Effect.scoped(
          live.open({ ...alicesIdentity, playerId: bob, username: "Bob" }, "town", Deferred.await(opening), signedIn),
        );
        yield* Deferred.succeed(opening, standInSocket(written));
        return { late, slow: yield* Fiber.join(slow), census: yield* live.census };
      }),
    );

    expect(outcome?.late).toBe("stopping");
    expect(outcome?.slow).toBe("served");
    expect(written).toEqual([new Socket.CloseEvent(CLOSE.restart, "restart")]);
    expect(outcome?.census).toMatchObject({ connected: 0, rooms: {} });
  });
});
