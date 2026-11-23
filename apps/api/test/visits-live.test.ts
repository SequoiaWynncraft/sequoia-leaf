import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Motion, playerId } from "@sequoia-leaf/core";
import { Schema } from "effect";

import type { LiveTuning } from "../src/live/live.ts";
import { LiveClient, type Opening } from "./live-client.ts";
import { fakeBackend, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const ORIGIN = "https://leaf.seqwawa.com";

// The real clock, which a test may move ahead: Live's tick and its waits keep time by it.
let ahead = 0;
const clock = {
  get now() {
    return Date.now() + ahead;
  },
  set now(_: number) {},
};
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
  services = testLeaf(clock, sessions().fetcher, {}, { live });
  server = await services.serve();
}

/** The old Leaf and the new, each on a free port and both on one database file, as during a deploy. */
async function deploying(): Promise<{ readonly old: Served; readonly next: Served }> {
  directory = mkdtempSync(join(tmpdir(), "leaf-visits-"));
  const databasePath = join(directory, "leaf.db");
  services = testLeaf(clock, sessions().fetcher, { databasePath }, { instance: "old" });
  server = await services.serve();
  const next = testLeaf(clock, sessions().fetcher, { databasePath }, { instance: "new" });
  beside = { services: next, server: await next.serve() };
  return { old: server, next: beside.server };
}

afterEach(async () => {
  ahead = 0;
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

async function connect(sent: Opening, to: Served | null = server): Promise<LiveClient> {
  const client = await LiveClient.open(to?.origin ?? "", sent);
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
/** The visits once they pass `which`, waiting a little for Live to write them. */
async function visitsWhen(which: (rows: readonly Visit[]) => boolean, ms = 2000): Promise<readonly Visit[]> {
  const until = Date.now() + ms;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- looking again until Live has written
    const now = await visits();
    if (which(now)) return now;
    if (Date.now() > until) throw new Error(`Waited ${ms} ms in vain: ${JSON.stringify(now)}`);
    // oxlint-disable-next-line no-await-in-loop -- as above
    await Bun.sleep(20);
  }
}
const closed = (v: Visit | undefined) => v !== undefined && v.left_at !== null;

describe("visits from the live rooms", () => {
  it("opens a visit as a player comes into the room, with the page's device, and closes it as they leave", async () => {
    await start();
    const a = await connect({ cookie: "alice-token", origin: ORIGIN, device: "phone" });
    await a.welcome();
    const [came] = await visitsWhen((r) => r.length === 1);
    expect(came).toMatchObject({ player_id: alice, place: "town", source: "room", left_at: null });
    ahead = 40_000;
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
    a.close();
    ahead = 30_000;

    const [gone] = await visitsWhen((r) => closed(r[0]));
    expect(gone?.seconds).toBeGreaterThanOrEqual(30);
    expect(gone?.seconds).toBeLessThan(32);
  });

  it("closes the room's visit when the page says it is somewhere else, and leaving the room after changes nothing", async () => {
    await start();
    const a = await connect({ bearer: "alice-token" });
    await a.welcome();
    await visitsWhen((r) => r.length === 1);
    ahead = 20_000;
    expect((await sayHere("alice-token", "works")).status).toBe(200);
    a.send({ t: "leave" });
    await Bun.sleep(300);

    const [town, works] = await visits();
    expect(town).toMatchObject({ place: "town", source: "room" });
    expect(town?.seconds).toBeGreaterThanOrEqual(20);
    expect(works).toMatchObject({ place: "works", source: "call", left_at: null, session_id: town?.session_id });
  });

  it("closes the visit a page's calls opened when the player comes into the room", async () => {
    await start();
    expect((await sayHere("bob-token", "camp")).status).toBe(200);
    ahead = 10_000;
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
    await Bun.sleep(200);

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
    await Bun.sleep(200);
    ahead = 40_000;
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

describe("when Leaf stops", () => {
  it("closes every open visit at that moment, the rooms' and the calls', before any connection", async () => {
    await start();
    const a = await connect({ bearer: "alice-token" });
    await a.welcome();
    expect((await sayHere("bob-token", "camp")).status).toBe(200);
    await visitsWhen((r) => r.length === 2);
    ahead = 50_000;
    const stopping = Date.now() + ahead;
    await server?.close();

    const after = await visits();
    expect(
      after.map((v) => [v.place, v.left_at !== null && v.left_at >= stopping && v.left_at < stopping + 1000]),
    ).toEqual([
      ["town", true],
      ["camp", true],
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
      body: JSON.stringify({ player: alice, commands: [{ id: "a-1", do: "start", trail: 0 }] }),
    });
    expect(started.status).toBe(200);
    expect((await sayHere("alice-token", "table", old)).status).toBe(200);
    // Then her page talks to the new Leaf, from the Works, for a minute.
    expect((await sayHere("alice-token", "works", next)).status).toBe(200);
    ahead = 60_000;
    expect((await sayHere("alice-token", "works", next)).status).toBe(200);
    expect(
      await services?.query(
        (sql) => sql`SELECT game, played_ms >= 60000 AS played, afk_ms FROM time_in WHERE game = 'works'`,
      ),
    ).toEqual([{ game: "works", played: 1, afk_ms: 0 }]);
  });

  it("in a deploy, closes only the visits the new Leaf has not heard of since, and leaves the others open as they began", async () => {
    const { old, next } = await deploying();
    // Alice in the old Leaf's town, Bob's page in the camp: both heard of by the old Leaf alone.
    const a = await connect({ bearer: "alice-token" }, old);
    await a.welcome();
    expect((await sayHere("bob-token", "camp", old)).status).toBe(200);
    const came = (await visitsWhen((r) => r.length === 2)).find((v) => v.player_id === alice);
    ahead = 20_000;
    // Alice's game comes into the new Leaf's town as well; Bob's page still talks to the old one.
    const again = await connect({ bearer: "alice-token" }, next);
    await again.welcome();
    await visitsWhen((r) => r.some((v) => v.player_id === alice && v.heard_at >= (came?.entered_at ?? 0) + 20_000));
    ahead = 30_000;
    await old.close();

    const after = await visits();
    expect(after.find((v) => v.player_id === alice)).toMatchObject({
      place: "town",
      entered_at: came?.entered_at,
      left_at: null,
    });
    expect(closed(after.find((v) => v.player_id === bob))).toBe(true);
  });
});
