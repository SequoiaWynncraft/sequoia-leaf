import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyAbout, campRoom, type Motion, playerId, readWho, type Who } from "@sequoia-leaf/core";
import { type Duration, Schema } from "effect";

import { Live, type LiveTuning, TICK } from "../src/live/live.ts";
import { LiveClient, type Opening } from "./live-client.ts";
import { asPage, fakeBackend, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const ORIGIN = "https://leaf.seqwawa.com";

/** Where each Leaf's test clock starts: Live's ticks and waits pass only as a test moves them on (`pass`). */
const T0 = Date.UTC(2026, 10, 25, 12);
const clock = { now: T0 };
type Served = Awaited<ReturnType<ReturnType<typeof testLeaf>["serve"]>>;
let services: ReturnType<typeof testLeaf> | null = null;
let server: Served | null = null;
const open: LiveClient[] = [];
/** A second Leaf, beside the first on its database file, as in a deploy; and that file's directory. */
let beside: { readonly services: ReturnType<typeof testLeaf>; readonly server: Served } | null = null;
let directory: string | null = null;

const sessions = () =>
  fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
  });

/** Leaf on a free port, with Live tuned as the test needs. */
async function start(live: Partial<LiveTuning> = {}): Promise<void> {
  services = testLeaf(clock, sessions().fetcher, {}, { live, testClock: true });
  server = await services.serve();
}

/** The old Leaf and the new, each on a free port and both on one database file, as during a deploy. */
async function deploying(): Promise<{ readonly old: Served; readonly next: Served }> {
  directory = mkdtempSync(join(tmpdir(), "leaf-visits-"));
  const databasePath = join(directory, "leaf.db");
  services = testLeaf(clock, sessions().fetcher, { databasePath }, { instance: "old", testClock: true });
  server = await services.serve();
  const next = testLeaf(clock, sessions().fetcher, { databasePath }, { instance: "new", testClock: true });
  beside = { services: next, server: await next.serve() };
  return { old: server, next: beside.server };
}

afterEach(async () => {
  for (const c of open.splice(0)) c.close();
  await server?.close();
  await services?.dispose();
  await beside?.server.close();
  await beside?.services.dispose();
  if (directory !== null) rmSync(directory, { recursive: true, force: true });
  server = null;
  services = null;
  beside = null;
  directory = null;
});

async function connect(sent: Opening, to: Served | null = server, room?: string): Promise<LiveClient> {
  const client = await LiveClient.open(to?.origin ?? "", sent, room);
  open.push(client);
  return client;
}

/** A player's page saying where they are, as `PUT /v1/game/presence`. */
const sayHere = (token: string, place: string, to: Served | null = server) =>
  fetch(`${to?.origin ?? ""}/v1/game/presence`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ place }),
  });

const Visit = Schema.Struct({
  player_id: Schema.String,
  place: Schema.String,
  source: Schema.String,
  entered_at: Schema.Number,
  heard_at: Schema.Number,
  left_at: Schema.NullOr(Schema.Number),
  seconds: Schema.Number,
  session_id: Schema.Number,
});
type Visit = typeof Visit.Type;
const visits = async (): Promise<readonly Visit[]> =>
  Schema.decodeUnknownSync(Schema.Array(Visit))(
    (await services?.query(
      (sql) =>
        sql`SELECT player_id, place, source, entered_at, heard_at, left_at, seconds, session_id FROM visits ORDER BY id`,
    )) ?? [],
  );
/**
 * The visits once they pass `which`: Live writes them on a fiber of its own, which nothing answers
 * for, so they are looked for again each turn of the event loop.
 */
async function visitsWhen(which: (rows: readonly Visit[]) => boolean, turns = 10_000): Promise<readonly Visit[]> {
  const now = await visits();
  if (which(now)) return now;
  if (turns === 0) throw new Error(`Never written: ${JSON.stringify(now)}`);
  await new Promise((resolve) => setImmediate(resolve));
  return visitsWhen(which, turns - 1);
}
/** Every Leaf's clock moved on together, with whatever fell due meanwhile done up to its next wait. */
async function pass(duration: Duration.Input): Promise<void> {
  await services?.adjust(duration);
  await beside?.services.adjust(duration);
}
/** Waits until Leaf has no connection open: the last close, which comes off the socket, is through. */
async function closedThrough(turns = 10_000): Promise<void> {
  if ((await services?.run(Live.use((live) => live.census)))?.connected === 0) return;
  if (turns === 0) throw new Error("a connection never closed");
  await new Promise((resolve) => setImmediate(resolve));
  return closedThrough(turns - 1);
}
const closed = (v: Visit | undefined) => v !== undefined && v.left_at !== null;

describe("visits from the live rooms", () => {
  it("opens a visit as a player comes into the room, with the page's device, and closes it as they leave", async () => {
    await start();
    const a = await connect({ cookie: "alice-token", origin: ORIGIN, device: "phone" });
    await a.welcome();
    const [came] = await visitsWhen((r) => r.length === 1);
    expect(came).toMatchObject({ player_id: alice, place: "town", source: "room", left_at: null });
    await pass("40 seconds");
    a.send({ t: "leave" });

    const [went] = await visitsWhen((r) => closed(r[0]));
    expect(went?.seconds).toBeGreaterThanOrEqual(40);
    expect(went?.seconds).toBeLessThan(42);
    expect(
      await services?.query((sql) => sql`SELECT device, seconds, places, ended_at IS NOT NULL AS ended FROM sessions`),
    ).toEqual([{ device: "phone", seconds: went?.seconds, places: `{"town":${went?.seconds}}`, ended: 1 }]);
  });

  it("closes it when the grace after a dropped connection runs out", async () => {
    await start({ graceMs: 150 });
    const a = await connect({ bearer: "alice-token" });
    await a.welcome();
    await visitsWhen((r) => r.length === 1);
    await pass("30 seconds");
    a.close();
    await closedThrough();
    await pass(150);
    await pass(TICK);

    const [gone] = await visitsWhen((r) => closed(r[0]));
    expect(gone?.seconds).toBeGreaterThanOrEqual(30);
    expect(gone?.seconds).toBeLessThan(32);
  });

  it("closes the room's visit when the page says it is somewhere else, and leaving the room after changes nothing", async () => {
    await start();
    const a = await connect({ bearer: "alice-token" });
    await a.welcome();
    await visitsWhen((r) => r.length === 1);
    await pass("20 seconds");
    expect((await sayHere("alice-token", "works")).status).toBe(200);
    a.send({ t: "leave" });
    // What Live writes is written in the order it happens: once Bob's coming in is, so is her leaving.
    await a.settled();
    const b = await connect({ bearer: "bob-token" });
    await b.welcome();
    await visitsWhen((r) => r.some((v) => v.player_id === bob));

    const [town, works] = (await visits()).filter((v) => v.player_id === alice);
    expect(town).toMatchObject({ place: "town", source: "room" });
    expect(town?.seconds).toBeGreaterThanOrEqual(20);
    expect(works).toMatchObject({ place: "works", source: "call", left_at: null, session_id: town?.session_id });
  });

  it("closes the visit a page's calls opened when the player comes into the room", async () => {
    await start();
    expect((await sayHere("bob-token", "camp")).status).toBe(200);
    await pass("10 seconds");
    const b = await connect({ bearer: "bob-token" });
    await b.welcome();

    const [camp, town] = await visitsWhen((r) => r.length === 2);
    expect(camp).toMatchObject({ place: "camp", source: "call" });
    expect(closed(camp)).toBe(true);
    expect(town).toMatchObject({ place: "town", source: "room", left_at: null, session_id: camp?.session_id });
  });

  it("keeps the visit a page's call opened in the town when the player comes into the town's room", async () => {
    await start();
    expect((await sayHere("bob-token", "town")).status).toBe(200);
    const b = await connect({ bearer: "bob-token" });
    await b.welcome();
    // Once the room's word of him is written, the call's visit is the room's: one, and open.
    await visitsWhen((r) => r[0]?.source === "room");

    expect(await visits()).toMatchObject([{ place: "town", source: "room", left_at: null }]);
  });
});

/** Standing at `x`, `y`, facing one way or another. */
const standing = (x: number, y: number, facing = 2): Motion => ({
  x,
  y,
  vx: 0,
  vy: 0,
  facing,
  pose: 0,
  flags: 0,
  jump: 0,
});

describe("time in the town's room", () => {
  it("is played after a move that goes somewhere, and AFK after only a first move and a turn on the spot", async () => {
    await start();
    const a = await connect({ bearer: "alice-token" });
    const b = await connect({ bearer: "bob-token" });
    await a.welcome();
    await b.welcome();
    await visitsWhen((r) => r.length === 2);
    a.move(standing(10, 10));
    a.move(standing(40, 10));
    b.move(standing(10, 10));
    b.move(standing(10, 10, 3));
    await Promise.all([a.settled(), b.settled()]);
    await pass("40 seconds");
    a.send({ t: "leave" });
    b.send({ t: "leave" });
    await visitsWhen((r) => r.length === 2 && r.every(closed));
    expect(
      await services?.query(
        (sql) =>
          sql`SELECT player_id, game, played_ms > 0 AS played, afk_ms > 0 AS afk FROM time_in ORDER BY player_id`,
      ),
    ).toEqual([
      { player_id: alice, game: "town", played: 1, afk: 0 },
      { player_id: bob, game: "town", played: 0, afk: 1 },
    ]);
  });
});

/** Those here, as a page is given them: who, where, and whether a live room has them. */
const Listed = Schema.Struct({
  present: Schema.Array(Schema.Struct({ username: Schema.String, place: Schema.String, live: Schema.Boolean })),
});
async function listedHere(token: string, from: Served | null = server): Promise<(string | boolean)[][]> {
  const answer = await fetch(`${from?.origin ?? ""}/v1/game/presence`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return Schema.decodeUnknownSync(Listed)(await answer.json()).present.map((p) => [p.username, p.place, p.live]);
}

/** Who is about as a page in the town's room has it: the lists it was given, with each change told since made to them. */
function aboutOf(c: LiveClient): Who | null {
  let who: Who | null = null;
  for (const m of c.texts) {
    if (m.t === "about" && m.who !== undefined) who = readWho(m.who);
    else if (m.t === "aboutChanged" && who !== null) who = applyAbout(who, m);
  }
  return who;
}
/** Each of a list's people as the page has them: who, and where. */
const placed = (rows: readonly Who["present"][number][] | undefined) => (rows ?? []).map((r) => [r.id, r["place"]]);

describe("one place a player, the one their live connection is in", () => {
  it("keeps a player in the town's room there, live, while another page of theirs calls from the Works: everybody reads the same", async () => {
    await start();
    const a = await connect({ bearer: "alice-token" });
    await a.welcome();
    const b = await connect({ bearer: "bob-token" });
    await b.welcome();
    await visitsWhen((r) => r.length === 2);
    // Alice's other page, with no room, says the Works, as it does every half minute.
    expect((await sayHere("alice-token", "works")).status).toBe(200);
    await pass("30 seconds");
    expect((await sayHere("alice-token", "works")).status).toBe(200);
    await pass("1 second");

    expect((await visits()).map((v) => [v.player_id, v.place, v.source, v.left_at])).toEqual([
      [alice, "town", "room", null],
      [bob, "town", "room", null],
    ]);
    // As a page asks Leaf, and as Bob's page in the room with her is told.
    expect(await listedHere("bob-token")).toEqual([
      ["Alice", "town", true],
      ["Bob", "town", true],
    ]);
    expect(placed(aboutOf(b)?.present)).toEqual([
      [alice, "town"],
      [bob, "town"],
    ]);
  });

  it("has a visitor at a camp there by the camp's room, live, whose camp it is", async () => {
    await start();
    const a = await connect({ bearer: "alice-token" }, server, campRoom(bob));
    await a.welcome();
    const [camp] = await visitsWhen((r) => r.length === 1);
    expect(camp).toMatchObject({ place: "camp", source: "room", left_at: null });
    expect(await services?.query((sql) => sql`SELECT camp_owner FROM visits`)).toEqual([{ camp_owner: bob }]);
    expect(await listedHere("bob-token")).toEqual([["Alice", "camp", true]]);

    // Her page's own word of the camp is the same place: one visit, the room's still.
    const said = await fetch(`${server?.origin ?? ""}/v1/game/presence`, {
      method: "PUT",
      headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" },
      body: JSON.stringify({ place: "camp", camp_owner: alice }),
    });
    expect(said.status).toBe(200);
    expect(await visits()).toMatchObject([{ place: "camp", source: "room", left_at: null }]);

    a.send({ t: "leave" });
    const [left] = await visitsWhen((r) => closed(r[0]));
    expect(left).toMatchObject({ place: "camp", source: "room" });
  });
});

describe("every page hears what Leaf's records say within a minute, whichever Leaf wrote it", () => {
  it("in a deploy, a page on one Leaf is told of somebody who comes into the other's town and leaves it", async () => {
    const { old, next } = await deploying();
    const b = await connect({ bearer: "bob-token" }, next);
    await b.welcome();
    const a = await connect({ bearer: "alice-token" }, old);
    await a.welcome();
    await visitsWhen((r) => r.length === 2);
    await pass("31 seconds");
    expect(placed(aboutOf(b)?.present)).toEqual([
      [alice, "town"],
      [bob, "town"],
    ]);

    // She leaves the old Leaf's room, which tells only its own pages.
    a.send({ t: "leave" });
    await visitsWhen((r) => closed(r.find((v) => v.player_id === alice)));
    await pass("31 seconds");
    const now = aboutOf(b);
    expect([placed(now?.present), placed(now?.resting)]).toEqual([[[bob, "town"]], [[alice, "town"]]]);
  });
});

describe("who a live room has", () => {
  it("is said of everybody here: live in the town's room, and not for a page that only says it is in town", async () => {
    await start();
    const a = await connect({ bearer: "alice-token" });
    await a.welcome();
    expect((await sayHere("bob-token", "town")).status).toBe(200);
    await visitsWhen((r) => r.length === 2);
    expect(await listedHere("bob-token")).toEqual([
      ["Alice", "town", true],
      ["Bob", "town", false],
    ]);

    // Bob's page comes into the room: live, in the visit he had.
    const b = await connect({ bearer: "bob-token" });
    await b.welcome();
    const both = await visitsWhen((r) => r.every((v) => v.source === "room"));
    expect(both.length).toBe(2);
    await pass("2 seconds");
    expect(await listedHere("bob-token")).toEqual([
      ["Alice", "town", true],
      ["Bob", "town", true],
    ]);
  });

  it("tells everybody in town when a page that only said so comes into the room", async () => {
    await start();
    const a = await connect({ bearer: "alice-token" });
    await a.welcome();
    expect((await sayHere("bob-token", "town")).status).toBe(200);
    await visitsWhen((r) => r.length === 2);
    await pass("1 second");
    const told = a.texts.length;
    const b = await connect({ bearer: "bob-token" });
    await b.welcome();
    await visitsWhen((r) => r.every((v) => v.source === "room"));
    await pass("1 second");

    const since = a.texts.slice(told).filter((m) => m.t === "aboutChanged" || m.t === "about");
    expect(JSON.stringify(since)).toContain('"live":true');
  });
});

describe("when Leaf stops", () => {
  it("closes no visit: each stays open for the next Leaf, a room's heard of at that moment and no room's from then, before any connection", async () => {
    await start();
    const a = await connect({ bearer: "alice-token" });
    await a.welcome();
    expect((await sayHere("bob-token", "camp")).status).toBe(200);
    await visitsWhen((r) => r.length === 2);
    await pass("50 seconds");
    const stopping = T0 + 50_000;
    await server?.close();

    const after = await visits();
    expect(after.map((v) => [v.place, v.source, v.left_at, v.heard_at >= stopping])).toEqual([
      ["town", "call", null, true],
      ["camp", "call", null, false],
    ]);
    expect((await a.ended()).code).toBe(1012);
  });

  it("in a deploy, what a player last did goes with them to another place, though only the Leaf stopping heard it", async () => {
    const { old, next } = await deploying();
    const headers = { Authorization: "Bearer alice-token", "Content-Type": "application/json" };
    expect((await sayHere("alice-token", "table", old)).status).toBe(200);
    // She starts a run on the old Leaf, which writes it on her visit as it hears of her again.
    expect((await fetch(`${old.origin}/v1/game/play/raid`, { headers })).status).toBe(200);
    const started = await fetch(`${old.origin}/v1/game/play/raid`, {
      method: "POST",
      headers,
      body: JSON.stringify(
        asPage("/v1/game/play/raid", { player: alice, commands: [{ id: "a-1", do: "start", trail: 0 }] }),
      ),
    });
    expect(started.status).toBe(200);
    expect((await sayHere("alice-token", "table", old)).status).toBe(200);
    // Then her page talks to the new Leaf, from the Works, for a minute.
    expect((await sayHere("alice-token", "works", next)).status).toBe(200);
    await pass("60 seconds");
    expect((await sayHere("alice-token", "works", next)).status).toBe(200);
    expect(
      await services?.query(
        (sql) => sql`SELECT game, played_ms >= 60000 AS played, afk_ms FROM time_in WHERE game = 'works'`,
      ),
    ).toEqual([{ game: "works", played: 1, afk_ms: 0 }]);
  });

  it("in a deploy nobody leaves: whoever comes back goes on in the visit they had, and whoever does not is gone from when they were last heard of", async () => {
    const { old, next } = await deploying();
    // Alice in the old Leaf's town, Bob's page in the camp: both heard of by the old Leaf alone.
    const a = await connect({ bearer: "alice-token" }, old);
    await a.welcome();
    expect((await sayHere("bob-token", "camp", old)).status).toBe(200);
    const before = await visitsWhen((r) => r.length === 2);
    const began = (who: string): number => before.find((v) => v.player_id === who)?.entered_at ?? Number.NaN;
    const bobHeard = before.find((v) => v.player_id === bob)?.heard_at ?? Number.NaN;
    await pass("20 seconds");
    await old.close();
    expect((await a.ended()).code).toBe(1012);
    // Alice's page comes back, to the next Leaf's town; Bob's never does.
    const again = await connect({ bearer: "alice-token" }, next);
    await again.welcome();
    const after = await visitsWhen((r) => r.some((v) => v.player_id === alice && v.source === "room"));
    expect(after.map((v) => [v.player_id, v.place, v.source, v.entered_at, v.left_at])).toEqual([
      [alice, "town", "room", began(alice), null],
      [bob, "camp", "call", began(bob), null],
    ]);
    expect(await listedHere("alice-token", next)).toEqual([
      ["Alice", "town", true],
      ["Bob", "camp", false],
    ]);

    await pass("2 minutes");
    const later = await visitsWhen((r) => r.some((v) => v.player_id === bob && v.left_at !== null));
    // Gone from his page's last call, which was before the deploy; and Alice's one visit goes on.
    expect(later.map((v) => [v.player_id, v.entered_at, v.left_at])).toEqual([
      [alice, began(alice), null],
      [bob, began(bob), bobHeard],
    ]);
  });
});
