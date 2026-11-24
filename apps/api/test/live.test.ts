import { afterEach, describe, expect, it } from "bun:test";

import {
  applyAbout,
  CLOSE,
  encodeMove,
  Flag,
  LIVE_OLDEST,
  LIVE_PATH,
  LIVE_VERSION,
  livePath,
  type Motion,
  playerId,
  readWho,
  type Who,
} from "@sequoia-leaf/core";
import { Deferred, type Duration, Effect, Fiber, Redacted, Schema } from "effect";
import { Socket } from "effect/socket";

import { Live, type LiveTuning, TICK } from "../src/live/live.ts";
import { LiveClient, type Opening } from "./live-client.ts";
import { type Backend, fakeBackend, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
const ORIGIN = "https://leaf.seqwawa.com";
const LIVE = livePath("town");

/** Where Leaf's test clock starts: Live's ticks and waits pass only as a test moves it on (`pass`). */
const T0 = Date.UTC(2026, 10, 25, 12);
const clock = { now: T0 };
/** The real clock, for the few tests whose point is how long something really takes. */
const realClock = {
  get now() {
    return Date.now();
  },
  set now(_: number) {},
};
let backend: Backend;
let services: ReturnType<typeof testLeaf> | null = null;
let server: Awaited<ReturnType<ReturnType<typeof testLeaf>["serve"]>> | null = null;
const open: LiveClient[] = [];

/** Leaf on a free port, with Live tuned as the test needs, on its test clock or the real one. */
async function start(live: Partial<LiveTuning> = {}, real = false): Promise<string> {
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
    "carol-token": () => Response.json(sessionOf(carol, "Carol", null)),
    // Alice signed in a second time, on another device.
    "alice-2-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
  });
  backend = fake.backend;
  services = testLeaf(real ? realClock : clock, fake.fetcher, {}, { live, testClock: !real });
  server = await services.serve();
  return server.origin;
}

afterEach(async () => {
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

/** Leaf's clock moved on, with whatever fell due meanwhile done up to its next wait. */
const pass = (duration: Duration.Input) => services?.adjust(duration) ?? Promise.resolve();
/** One of Live's ticks, at which each room sends what moved in it. */
const tick = () => pass(TICK);
/** Each client's ping answered (`LiveClient.settled`). */
const settled = (...clients: LiveClient[]) => Promise.all(clients.map((client) => client.settled()));

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

/**
 * Waits until Leaf has `connected` connections open, none by default: the last one's close, which
 * comes off the socket and has nothing to answer, is through. Looked for again each turn of the
 * event loop.
 */
async function closedThrough(connected = 0, turns = 10_000): Promise<void> {
  if ((await census())?.connected === connected) return;
  if (turns === 0) throw new Error("a connection never closed");
  await new Promise((resolve) => setImmediate(resolve));
  return closedThrough(connected, turns - 1);
}

/** `n` connections of Alice's, one after another, each dropping as the network drops it: openings that hand nothing over. */
async function dropped(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    // oxlint-disable-next-line no-await-in-loop -- one after another, each dropped before the next
    const tab = await connect(page("alice"));
    // oxlint-disable-next-line no-await-in-loop -- in the room before it drops
    await tab.welcome();
    tab.drop();
    // oxlint-disable-next-line no-await-in-loop -- the drop through before the next opens
    await closedThrough();
  }
}

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
    await dropped(10);
    await refused(LIVE, { Authorization: "Bearer alice-token" });

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

  it("charges every connection a player opens that hands nothing over, and turns them away past ten at once", async () => {
    await start();
    await dropped(10);

    expect(await refused(LIVE, { Authorization: "Bearer alice-token" })).toEqual([429, "slow_down"]);
  });

  it("keeps what a player owes after they have left, so that leaving refills nothing", async () => {
    await start({ graceMs: 50 });
    await dropped(10);
    // Their grace over, and the tick after it.
    await pass(50);
    await tick();

    expect(await census()).toMatchObject({ connected: 0, rooms: {} });
    expect(await refused(LIVE, { Authorization: "Bearer alice-token" })).toEqual([429, "slow_down"]);
  });

  // KIT-SERVER B2 and the Works since #157: going from the town to a game and back is one page of
  // the player's closing its connection and the next opening one. Each spent an opening, and twenty
  // in a hundred seconds ran out the allowance: a 429, "Reconnecting", and everybody gone.
  it("hands a player over between their own pages without spending their openings: twenty, five seconds apart", async () => {
    await start();
    const first = await connect(page("alice"));
    await first.welcome();
    // To a game and back: the page going closes its connection, and then the next opens one; or
    // the next opens first and takes over, as a frame put away goes a moment after. Each hop is
    // five seconds after the last.
    const hop = async (tab: LiveClient, i: number): Promise<LiveClient> => {
      if (i === 20) return tab;
      if (i % 2 === 0) {
        tab.close();
        // The close through, so that the next is no takeover.
        await closedThrough();
      }
      const next = await connect(page("alice"));
      await next.welcome();
      if (i % 2 === 1) tab.close();
      await pass("5 seconds");
      return hop(next, i + 1);
    };
    const tab = await hop(first, 0);
    tab.drop();
    await closedThrough();
    // The openings proper are all there: ten that hand nothing over, and only then a 429.
    await dropped(10);
    expect(await refused(LIVE, { Authorization: "Bearer alice-token" })).toEqual([429, "slow_down"]);
  });

  it("keeps a storm of handoffs from being free: past ten at once, they are charged as openings", async () => {
    await start();
    let tab = await connect(page("alice"));
    await tab.welcome();
    // One opening proper, then each next page taking over at once: ten as handoffs, nine as openings.
    for (let i = 0; i < 19; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one page after another
      const next = await connect(page("alice"));
      // oxlint-disable-next-line no-await-in-loop -- in the room before the next
      await next.welcome();
      tab.close();
      tab = next;
    }
    expect(await refused(LIVE, { Authorization: "Bearer alice-token" })).toEqual([429, "slow_down"]);
  });

  it("charges an opening long after the page closed its connection, and one after a drop, as any other", async () => {
    await start();
    // A page closing cleanly, and the next opening only after the few seconds a handoff has.
    const closing = async (left: number): Promise<void> => {
      if (left === 0) return;
      const tab = await connect(page("alice"));
      await tab.welcome();
      tab.close();
      await closedThrough();
      // A little over six seconds: three openings refilled over the five.
      await pass("6100 millis");
      return closing(left - 1);
    };
    await closing(5);
    // Five charged, and three refilled over the half minute moved: eight that drop, and the next is refused.
    await dropped(8);
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

  // On the real clock: how long it really takes is the point.
  it("sends a player's motion to everybody in the room within a tick or two", async () => {
    await start({}, true);
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
    await settled(a);
    await tick();
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
    await settled(b);
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
    await settled(a);
    await settled(b);
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
    await settled(b);
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
    await settled(...watchers);
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
    await settled(first);
    await tick();
    const before = await b.snapshot((s) => s.entries.some((e) => e.id === you && e.x === 29));
    const second = await connect({ bearer: "alice-token" });
    await second.welcome();
    const seq = second.move(at(300, 200, 0));
    await settled(second);
    await tick();

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
    // Past the minute a confirmed session is remembered: the second's is asked about again, and
    // its answer heard by the time each page's ping is answered.
    const asked = backend.calls.length;
    await pass("61 seconds");
    expect(backend.calls.slice(asked)).toContain("/auth/web/me");
    await settled(second, b);

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
    await settled(a);
    await tick();
    await b.snapshot((s) => s.entries.some((e) => e.id === you && e.flags === Flag.Moving));
    a.close();
    await closedThrough(1);
    await tick();

    // They are seen to stop, not to go.
    const stopped = await b.snapshot((s) => s.entries.some((e) => e.id === you));
    expect(stopped.entries.find((e) => e.id === you)).toMatchObject({ x: 100, vx: 0, flags: 0 });
    const back = await connect(page("alice"));
    expect((await back.welcome()).you).toBe(you);
    back.close();
    await closedThrough(1);
    await pass(300);
    await tick();

    expect(await b.next("left", (m) => m.id === you)).toEqual({ t: "left", id: you });
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
    await pass(300);
    await settled(a);
    expect(a.closed).toBeNull();
    await pass("61 seconds");

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
  left_at: number | null;
  stay: number;
  guest: number;
}
/** Where each player is, or was last, as everybody else sees them: their newest visit, and whether they stay. */
const rows = () =>
  services?.query<Row>(
    (sql) => sql`
      SELECT v.player_id, p.name AS username, v.place, coalesce(v.left_at, v.heard_at) AS seen_at, v.left_at, p.stay, v.guest
      FROM visits AS v JOIN players_seen AS p ON p.player_id = v.player_id
      WHERE v.id IN (SELECT max(id) FROM visits GROUP BY player_id)
      ORDER BY username
    `,
  ) ?? Promise.resolve([]);
/**
 * Where each player is once that passes `which`: Live writes it on a fiber of its own, which nothing
 * answers for, so it is looked for again each turn of the event loop.
 */
async function rowsWhen(which: (rows: readonly Row[]) => boolean, turns = 10_000): Promise<readonly Row[]> {
  const now = await rows();
  if (which(now)) return now;
  if (turns === 0) throw new Error(`Never written: ${JSON.stringify(now)}`);
  await new Promise((resolve) => setImmediate(resolve));
  return rowsWhen(which, turns - 1);
}
/** How long Live gathers changes to who is about before it tells the rooms. */
const GATHER = 200;
/** What a page was told of who is about that it has not taken yet: all of it, or a change. */
const toldAbout = (c: LiveClient) => c.texts.filter((m) => m.t === "about" || m.t === "aboutChanged");
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
    await pass("60 seconds");
    const from = T0 + 60_000;
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
    await pass("80 seconds");

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
    await pass("40 seconds");
    const left = T0 + 40_000;
    // Alice's page leaves the room and closes; Bob's game says he has gone to the Works, then closes.
    a.send({ t: "leave" });
    a.close();
    expect((await sayHere("bob-token", "works")).status).toBe(200);
    b.close();

    const after = await rowsWhen((r) => (r[0]?.seen_at ?? 0) >= left);
    // Both closes through, their grace over, and what that wrote written.
    await closedThrough();
    await pass(100);
    await tick();
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
    await pass("20 seconds");
    const left = T0 + 20_000;
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
    await pass(GATHER);
    await settled(a);
    a.texts.length = 0;
    const b = await connect(page("bob"));
    await b.welcome();
    // Bob is given all of who is about as he comes in; Bob coming in is a change, and Alice hears of
    // it, and so does Bob, once for the burst.
    await b.next("about");
    await rowsWhen((r) => r.length === 2);
    await pass(GATHER);
    await a.next("aboutChanged");
    await b.next("aboutChanged");
    await pass(GATHER);
    await settled(a, b);
    expect([...toldAbout(a), ...toldAbout(b)]).toEqual([]);

    // Carol's game says she is at the Works: a change; saying it again is not.
    expect((await sayHere("carol-token", "works")).status).toBe(200);
    await pass(GATHER);
    await a.next("aboutChanged");
    await b.next("aboutChanged");
    expect((await sayHere("carol-token", "works")).status).toBe(200);
    await pass(GATHER);
    await settled(a);
    expect(toldAbout(a)).toEqual([]);

    // Bob leaves the room: Leaf's list says so, and then Alice hears it.
    b.send({ t: "leave" });
    await rowsWhen((r) => r.some((row) => row.username === "Bob" && row.left_at !== null));
    const now: unknown = await (
      await fetch(`${server?.origin ?? ""}/v1/game/presence`, {
        headers: { Authorization: "Bearer alice-token" },
      })
    ).json();
    expect(now).toMatchObject({
      present: [{ username: "Alice" }, { username: "Carol" }],
      resting: [{ username: "Bob" }],
    });
    await pass(GATHER);
    await a.next("aboutChanged");
  });

  it("tells a page of either version the same lists: what changed to version 3, all of them to version 2", async () => {
    await start();
    const old = await connect({ ...page("alice"), speaks: LIVE_OLDEST });
    expect((await old.welcome()).v).toBe(LIVE_OLDEST);
    const now = await connect(page("bob"));
    expect((await now.welcome()).v).toBe(LIVE_VERSION);
    await rowsWhen((r) => r.length === 2);
    await pass(GATHER);
    // The first lists told are all of them, to both, numbered.
    const first = await now.next("about");
    let made = { v: first.v ?? 0, who: readWho(first.who) };
    expect((await old.next("about")).who).toEqual(made.who);

    const changes = [
      () => sayHere("carol-token", "works"),
      () => sayHere("carol-token", "camp", false),
      () => sayHere("alice-2-token", "works"),
      () => sayHere("carol-token", "town", true),
    ];
    for (const change of changes) {
      // oxlint-disable-next-line no-await-in-loop -- one change after another, each told
      expect((await change()).status).toBe(200);
      // oxlint-disable-next-line no-await-in-loop -- told once the burst is gathered
      await pass(GATHER);
      // oxlint-disable-next-line no-await-in-loop -- as version 3 hears it
      const changed = await now.next("aboutChanged");
      // oxlint-disable-next-line no-await-in-loop -- as version 2 hears it
      const whole = await old.next("about");
      expect(changed.v).toBe(made.v + 1);
      const before: Who | null = made.who;
      made = { v: changed.v, who: before === null ? null : applyAbout(before, changed) };
      expect(made.who).toEqual(readWho(whole.who));
      expect(whole.v).toBe(changed.v);
    }
    // Somebody coming in now is given the lists as they stand, numbered as the last change.
    const late = await connect(page("carol"));
    await late.welcome();
    const given = await late.next("about");
    expect([given.v, readWho(given.who)]).toEqual([made.v, made.who]);
  });

  it("gives a page all of who is about again when it asks, having missed a change", async () => {
    await start();
    const a = await connect(page("alice"));
    await a.welcome();
    await rowsWhen((r) => r.length === 1);
    await pass(GATHER);
    const told = await a.next("about");
    a.send({ t: "about" });
    expect(await a.next("about")).toEqual(told);
    // Out of every room, nothing is given.
    a.send({ t: "leave" });
    a.send({ t: "about" });
    await settled(a);
    expect(toldAbout(a)).toEqual([]);
  });

  it("tells everybody in every room when somebody away does something again, and not at every move", async () => {
    await start();
    const a = await connect(page("alice"));
    await a.welcome();
    const b = await connect(page("bob"));
    await b.welcome();
    b.move(at(100, 100, 0));
    await rowsWhen((r) => r.length === 2);
    await pass(GATHER);
    await settled(a, b);
    a.texts.length = 0;

    // Bob has done nothing Leaf heard of yet: away. His first move somewhere brings him back.
    b.move(at(110, 100));
    await settled(b);
    await pass(GATHER);
    await a.next("aboutChanged");
    b.move(at(120, 100));
    await settled(b);
    await pass(GATHER);
    await settled(a);
    expect(toldAbout(a)).toEqual([]);
  });

  it("writes them gone at the end of their grace when the connection drops", async () => {
    await start({ graceMs: 150 });
    const a = await connect(page("alice"));
    await a.welcome();
    const first = (await rowsWhen((r) => r.length === 1))[0]?.seen_at ?? 0;
    a.close();
    await closedThrough();
    await pass(150);
    await tick();

    const gone = await rowsWhen((r) => (r[0]?.seen_at ?? 0) >= first + 150);
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
    await settled(b);
    const a = await connect(page("alice"));
    await tick();
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
    expect(await census()).toMatchObject({ players: 1, connected: 0 });
    await pass("60 seconds");

    expect(await census()).toMatchObject({ players: 1, connected: 0 });
    // Her place is held: nobody else gets it meanwhile.
    expect(
      await services?.run(
        Effect.scoped(Live.use((live) => live.open(bobsIdentity, "town", Deferred.await(opening), sessionOk))),
      ),
    ).toBe("full");

    await Effect.runPromise(Deferred.fail(opening, new Error("never opened")));
    await pending;
    // Nothing is left of her: she is forgotten within the second.
    await pass("1 second");
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
    await settled(b);
    await tick();
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
        // Opening, waiting for its socket.
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);
      }),
    );
    // Long enough for her open's charge to refill, and nothing left of her.
    await pass("60 seconds");

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
        // Opening, waiting for its socket.
        yield* Effect.yieldNow;
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
