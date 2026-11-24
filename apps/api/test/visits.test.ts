import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type PlayerId, playerId } from "@sequoia-leaf/core";
import { Effect, Schema } from "effect";

import { type Here, hereFrom } from "../src/activity/here.ts";
import { Visits } from "../src/activity/visits.ts";
import { type Backend, DAY, fakeBackend, HOUR, MINUTE, noNetwork, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
const dave = playerId("10000000-0000-0000-0000-000000000004");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const SECOND = 1000;

const clock = { now: T0 };
let backend: Backend;
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

beforeEach(() => {
  clock.now = T0;
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
    "carol-token": () => Response.json(sessionOf(carol, "Carol", null)),
    // A website admin, the guild's staff, though not in the guild.
    "dave-token": () => Response.json({ ...sessionOf(dave, "Dave", null), website_admin: true }),
  });
  backend = fake.backend;
  services = testLeaf(clock, fake.fetcher);
  app = services.app();
});

afterEach(async () => {
  await app.dispose();
  await services.dispose();
});

type Who = "alice" | "bob" | "carol" | "dave";

/** Alice, as a room or her page has her. */
const inTownAlice = { playerId: alice, username: "Alice", guest: false, device: null };

/** A player's page saying where they are, at the clock's time. */
async function call(who: Who, place: string, device?: string) {
  const response = await app.request("/v1/game/presence", {
    method: "PUT",
    headers: { Authorization: `Bearer ${who}-token`, "Content-Type": "application/json" },
    body: JSON.stringify(device === undefined ? { place } : { place, device }),
  });
  expect(response.status).toBe(200);
}

/** A page saying where its player is every `every` from `from`, for `minutes`, as a page left open does. */
async function stay(who: Who, place: string, from: number, minutes: number, every = MINUTE, device?: string) {
  for (let at = from; at <= from + minutes * MINUTE; at += every) {
    clock.now = at;
    // oxlint-disable-next-line no-await-in-loop -- one call after another, as time passes
    await call(who, place, device);
  }
}

const VisitRow = Schema.Struct({
  player_id: Schema.String,
  place: Schema.String,
  source: Schema.String,
  entered_at: Schema.Number,
  left_at: Schema.NullOr(Schema.Number),
  seconds: Schema.Number,
  session_id: Schema.Number,
});
const visits = async () =>
  Schema.decodeUnknownSync(Schema.Array(VisitRow))(
    await services.query(
      (sql) => sql`SELECT player_id, place, source, entered_at, left_at, seconds, session_id FROM visits ORDER BY id`,
    ),
  );
const SessionRow = Schema.Struct({
  id: Schema.Number,
  player_id: Schema.String,
  guest: Schema.Number,
  started_at: Schema.Number,
  ended_at: Schema.NullOr(Schema.Number),
  seconds: Schema.Number,
  device: Schema.NullOr(Schema.String),
  places: Schema.fromJsonString(Schema.Record(Schema.String, Schema.Number)),
});
const sessions = async () =>
  Schema.decodeUnknownSync(Schema.Array(SessionRow))(
    await services.query(
      (sql) =>
        sql`SELECT id, player_id, guest, started_at, ended_at, seconds, device, places FROM sessions ORDER BY id`,
    ),
  );
const playersSeen = () =>
  services.query(
    (sql) => sql`
      SELECT player_id, name, guest, first_seen_at, last_seen_at, seconds_total, sessions FROM players_seen
      ORDER BY player_id
    `,
  );

/** The staff's report, as Dave asks for it. */
async function report(query = "") {
  const response = await app.request(`/v1/game/admin/activity${query}`, {
    headers: { Authorization: "Bearer dave-token" },
  });
  const body: unknown = await response.json();
  return { status: response.status, body };
}

/** A player's commands to a game, at the clock's time, as their page sends them: the game opened, then one batch. */
async function command(who: Who, game: string, commands: readonly object[]) {
  const headers = { Authorization: `Bearer ${who}-token`, "Content-Type": "application/json" };
  expect((await app.request(`/v1/game/play/${game}`, { headers })).status).toBe(200);
  const player = { alice, bob, carol, dave }[who];
  const ided = commands.map((c, i) => ({ ...c, id: `${who}-${clock.now}-${i}` }));
  const response = await app.request(`/v1/game/play/${game}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ player, commands: ided }),
  });
  expect(response.status).toBe(200);
}

/** Each player's time in each game, played and AFK, in milliseconds. */
const timeIn = () =>
  services.query(
    (sql) => sql`SELECT player_id, game, played_ms AS played, afk_ms AS afk FROM time_in ORDER BY player_id, game`,
  );

describe("time in each game", () => {
  it("is played for each stretch of a visit begun within five minutes of something the player did, and AFK from then", async () => {
    await call("alice", "table");
    // A minute at the table before she does anything: AFK.
    await stay("alice", "table", T0 + MINUTE, 0);
    await command("alice", "raid", [{ do: "start", trail: 0 }]);
    await stay("alice", "table", T0 + 2 * MINUTE, 6);
    // The five stretches begun up to five minutes after the start are played; the two after, AFK.
    expect(await timeIn()).toEqual([{ player_id: alice, game: "raid", played: 5 * MINUTE, afk: 3 * MINUTE }]);
    // What she did is kept on the visit, for a Leaf that takes over in a deploy.
    expect(await services.query((sql) => sql`SELECT acted_at FROM visits`)).toEqual([{ acted_at: T0 + MINUTE }]);
  });

  it("is in Leaf's list of who is about: when each of those here last did something, as their time counts it", async () => {
    await call("alice", "table");
    clock.now = T0 + MINUTE;
    await command("alice", "raid", [{ do: "start", trail: 0 }]);
    clock.now = T0 + 2 * MINUTE;
    await call("alice", "table");
    await call("bob", "town");
    // Bob's page says where he is; that is not Bob doing anything.
    await command("bob", "town", [{ do: "here", cursor: null }]);
    clock.now = T0 + 3 * MINUTE;
    const response = await app.request("/v1/game/presence", { headers: { Authorization: "Bearer bob-token" } });

    expect(await response.json()).toMatchObject({
      present: [
        { username: "Alice", acted_at: new Date(T0 + MINUTE).toISOString() },
        { username: "Bob", acted_at: null },
      ],
    });
  });

  it("counts nothing a page sends by itself as the player doing something: the town's page saying they are here", async () => {
    await call("bob", "town");
    await command("bob", "town", [{ do: "here", cursor: null }]);
    await stay("bob", "town", T0 + MINUTE, 2);
    expect(await timeIn()).toEqual([{ player_id: bob, game: "town", played: 0, afk: 3 * MINUTE }]);
  });

  it("counts no batch Leaf refused for coming too fast as the player doing something", async () => {
    await call("alice", "table");
    const headers = { Authorization: "Bearer alice-token", "Content-Type": "application/json" };
    const batch = (commands: readonly object[]) =>
      app.request("/v1/game/play/raid", { method: "POST", headers, body: JSON.stringify({ player: alice, commands }) });
    // Twenty batches at once, the most Leaf takes, each with nothing in it; the next is refused.
    for (let n = 0; n < 20; n++) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      expect((await batch([])).status).toBe(200);
    }
    expect((await batch([{ id: "a-1", do: "start", trail: 0 }])).status).toBe(429);
    const about = await app.request("/v1/game/presence", { headers: { Authorization: "Bearer alice-token" } });
    expect(await about.json()).toMatchObject({ present: [{ username: "Alice", acted_at: null }] });
  });

  it("counts a camp as the town's, the time up to a visit's close, and nothing for the silence before a silent one closes", async () => {
    await command("alice", "raid", [{ do: "start", trail: 0 }]);
    await stay("alice", "town", T0, 1);
    // Two minutes in town, up to when she comes to the camp; a minute there.
    await stay("alice", "camp", T0 + 2 * MINUTE, 1);
    // Nothing heard for long enough: the camp's visit closes at its last call.
    clock.now = T0 + 10 * MINUTE;
    await call("bob", "works");
    expect(await timeIn()).toEqual([{ player_id: alice, game: "town", played: 3 * MINUTE, afk: 0 }]);
  });

  it("is on the card: each game's in whole seconds, and all of them together", async () => {
    await call("carol", "works");
    clock.now = T0 + 30 * SECOND;
    await command("carol", "raid", [{ do: "start", trail: 0 }]);
    await stay("carol", "works", T0 + MINUTE, 7);
    const response = await app.request(`/v1/game/people/${carol}`, {
      headers: { Authorization: "Bearer carol-token" },
    });
    expect(await response.json()).toMatchObject({
      games: { works: { played: (6 * MINUTE) / SECOND, afk: (2 * MINUTE) / SECOND, spent: 0 } },
      played: (6 * MINUTE) / SECOND,
      afk: (2 * MINUTE) / SECOND,
    });
  });
});

describe("visits from the presence calls", () => {
  it("opens a visit at the first call, moves it on with each, and closes it at the last after 90 silent seconds", async () => {
    await call("alice", "camp");
    clock.now = T0 + 30 * SECOND;
    await call("alice", "camp");
    clock.now = T0 + 60 * SECOND;
    await call("alice", "camp");
    expect(await visits()).toMatchObject([{ place: "camp", source: "call", entered_at: T0, left_at: null }]);

    // Someone else's call, 89 seconds after Alice's last, finds hers still open; at 90 it is closed at that last call.
    clock.now = T0 + 149 * SECOND;
    await call("bob", "town");
    expect((await visits())[0]?.left_at).toBeNull();
    clock.now = T0 + 150 * SECOND;
    await call("bob", "town");

    expect((await visits())[0]).toMatchObject({ place: "camp", left_at: T0 + 60 * SECOND, seconds: 60 });
  });

  it("never moves a player back on word older than what Leaf heard since: a room's heartbeat written late", async () => {
    // Alice is in the town's live room; her page then says the Works, and the room's heartbeat from
    // before it, which Live had waiting, is written after.
    const inTown = { playerId: alice, username: "Alice", guest: false, device: null };
    await services.run(Visits.use((v) => v.inRoom([inTown], "town", T0)));
    clock.now = T0 + 20 * SECOND;
    await call("alice", "works");
    await services.run(Visits.use((v) => v.inRoom([inTown], "town", T0 + 10 * SECOND)));
    await services.run(Visits.use((v) => v.leftRoom(alice, "town", T0 + 15 * SECOND)));

    expect(await visits()).toMatchObject([
      { place: "town", source: "room", entered_at: T0, left_at: T0 + 20 * SECOND },
      { place: "works", source: "call", entered_at: T0 + 20 * SECOND, left_at: null },
    ]);
    const about = await services.run(Visits.use((v) => v.about(T0 + 21 * SECOND)));
    expect(about.present).toEqual([
      { playerId: alice, username: "Alice", place: "works", guest: false, seenAt: T0 + 20 * SECOND },
    ]);
  });

  it("in a deploy, lets no word older than what Leaf heard since give a player's visit back to the Leaf stopping", async () => {
    const directory = mkdtempSync(join(tmpdir(), "leaf-visits-"));
    const databasePath = join(directory, "leaf.db");
    const old = testLeaf(clock, noNetwork, { databasePath }, { instance: "old" });
    const next = testLeaf(clock, noNetwork, { databasePath }, { instance: "new" });
    const inTown = { playerId: alice, username: "Alice", guest: false, device: null };
    const instance = async () =>
      (await next.query<{ instance: string }>((sql) => sql`SELECT instance FROM visits WHERE left_at IS NULL`)).map(
        (v) => v.instance,
      );
    try {
      await old.run(Visits.use((v) => v.inRoom([inTown], "town", T0)));
      await next.run(Visits.use((v) => v.inRoom([inTown], "town", T0 + 20 * SECOND)));
      // The old Leaf's room word from before, written late, as it stops.
      await old.run(Visits.use((v) => v.inRoom([inTown], "town", T0 + 10 * SECOND)));
      const afterLate = await instance();
      await old.run(Visits.use((v) => v.closeAll(T0 + 30 * SECOND)));

      expect(afterLate).toEqual(["new"]);
      expect(await instance()).toEqual(["new"]);
      expect(
        await next.query((sql) => sql`SELECT entered_at, heard_at FROM visits WHERE player_id = ${alice}`),
      ).toEqual([{ entered_at: T0, heard_at: T0 + 20 * SECOND }]);
    } finally {
      await old.dispose();
      await next.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("in a deploy, gives a player's visit to whichever Leaf heard of them last", async () => {
    const directory = mkdtempSync(join(tmpdir(), "leaf-visits-"));
    const databasePath = join(directory, "leaf.db");
    const old = testLeaf(clock, noNetwork, { databasePath }, { instance: "old" });
    const next = testLeaf(clock, noNetwork, { databasePath }, { instance: "new" });
    const inTown = { playerId: alice, username: "Alice", guest: false, device: null };
    try {
      await next.run(Visits.use((v) => v.inRoom([inTown], "town", T0)));
      await old.run(Visits.use((v) => v.inRoom([inTown], "town", T0 + 10 * SECOND)));

      expect(await next.query((sql) => sql`SELECT instance, heard_at FROM visits`)).toEqual([
        { instance: "old", heard_at: T0 + 10 * SECOND },
      ]);
    } finally {
      await old.dispose();
      await next.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // A player in one Leaf's town room leaves it at 30 seconds; word of them stamped 10 seconds, which
  // the other Leaf had waiting, comes after, from the town's room or from a page in the camp; the
  // other Leaf then stops at 31 seconds. Their one stay was 30 seconds, and stays so.
  for (const [said, word] of [
    ["the room they left", (v: Visits["Service"]) => v.inRoom([inTownAlice], "town", T0 + 10 * SECOND)],
    ["a page in another place", (v: Visits["Service"]) => v.called(inTownAlice, "camp", null, T0 + 10 * SECOND)],
  ] as const) {
    it(`opens no visit on word from ${said} older than when the player last left`, async () => {
      const directory = mkdtempSync(join(tmpdir(), "leaf-visits-"));
      const databasePath = join(directory, "leaf.db");
      const here = testLeaf(clock, noNetwork, { databasePath }, { instance: "here" });
      const other = testLeaf(clock, noNetwork, { databasePath }, { instance: "other" });
      try {
        await here.run(Visits.use((v) => v.inRoom([inTownAlice], "town", T0)));
        await here.run(Visits.use((v) => v.leftRoom(alice, "town", T0 + 30 * SECOND)));
        await other.run(Visits.use(word));
        await other.run(Visits.use((v) => v.closeAll(T0 + 31 * SECOND)));

        expect(await here.query((sql) => sql`SELECT place, entered_at, left_at, seconds FROM visits`)).toEqual([
          { place: "town", entered_at: T0, left_at: T0 + 30 * SECOND, seconds: 30 },
        ]);
        expect(await here.query((sql) => sql`SELECT seconds_total FROM players_seen`)).toEqual([{ seconds_total: 30 }]);
        expect(await here.query((sql) => sql`SELECT game, played_ms + afk_ms AS ms FROM time_in`)).toEqual([
          { game: "town", ms: 30 * SECOND },
        ]);
      } finally {
        await here.dispose();
        await other.dispose();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  it("keeps a player in the game their page calls from while a town room on another page says the town; a call moves them", async () => {
    // Alice has the Works open, and the town open on her phone, whose room says so now and then.
    const inTown = { playerId: alice, username: "Alice", guest: false, device: null };
    const room = (at: number) => services.run(Visits.use((v) => v.inRoom([inTown], "town", at)));
    await call("alice", "works");
    await room(T0 + 10 * SECOND);
    clock.now = T0 + 30 * SECOND;
    await call("alice", "works");
    await room(T0 + 40 * SECOND);
    expect(await visits()).toMatchObject([{ place: "works", source: "call", entered_at: T0, left_at: null }]);
    const about = await services.run(Visits.use((v) => v.about(T0 + 41 * SECOND)));
    expect(about.present.map((p) => p.place)).toEqual(["works"]);

    // Out of the Works, the town's page says so itself, at once.
    clock.now = T0 + 50 * SECOND;
    await call("alice", "town");
    expect(await visits()).toMatchObject([
      { place: "works", left_at: T0 + 50 * SECOND },
      { place: "town", source: "call", entered_at: T0 + 50 * SECOND, left_at: null },
    ]);
  });

  it("lets a town room have a player whose game's page has gone silent, and one in their camp at once", async () => {
    const inTown = { playerId: alice, username: "Alice", guest: false, device: null };
    await call("alice", "works");
    // 90 seconds on, the Works' visit is closed at its last call, and the room has her.
    await services.run(Visits.use((v) => v.inRoom([inTown], "town", T0 + 90 * SECOND)));
    expect(await visits()).toMatchObject([
      { place: "works", left_at: T0 },
      { place: "town", source: "room", entered_at: T0 + 90 * SECOND, left_at: null },
    ]);
    // A camp is the town's own page, not a game: the room takes her from it.
    clock.now = T0 + 100 * SECOND;
    await call("alice", "camp");
    await services.run(Visits.use((v) => v.inRoom([inTown], "town", T0 + 110 * SECOND)));
    expect((await visits()).map((v) => [v.place, v.left_at])).toEqual([
      ["works", T0],
      ["town", T0 + 100 * SECOND],
      ["camp", T0 + 110 * SECOND],
      ["town", null],
    ]);
  });

  it("closes a visit gone silent at its last call when the page calls again from the same place, and opens another", async () => {
    await call("alice", "town");
    clock.now = T0 + 30 * SECOND;
    await call("alice", "town");
    // Ninety seconds after her last call, her page calls again: the silence is no time in town.
    clock.now = T0 + 120 * SECOND;
    await call("alice", "town");

    expect(await visits()).toMatchObject([
      { place: "town", entered_at: T0, left_at: T0 + 30 * SECOND, seconds: 30 },
      { place: "town", entered_at: T0 + 120 * SECOND, left_at: null },
    ]);
    expect(await timeIn()).toEqual([{ player_id: alice, game: "town", played: 0, afk: 30 * SECOND }]);
  });

  it("closes a room's visit gone silent at the last time it was heard of, when the player leaves the room after", async () => {
    const inTown = { playerId: alice, username: "Alice", guest: false, device: null };
    await services.run(Visits.use((v) => v.inRoom([inTown], "town", T0)));
    await services.run(Visits.use((v) => v.leftRoom(alice, "town", T0 + 100 * SECOND)));

    expect(await visits()).toMatchObject([{ place: "town", source: "room", left_at: T0, seconds: 0 }]);
  });

  it("closes a visit gone silent at its last call when Leaf stops, and the others then", async () => {
    await call("alice", "town");
    clock.now = T0 + 60 * SECOND;
    await call("bob", "works");
    await services.run(Visits.use((v) => v.closeAll(T0 + 100 * SECOND)));

    expect((await visits()).map((v) => [v.player_id, v.left_at])).toEqual([
      [alice, T0],
      [bob, T0 + 100 * SECOND],
    ]);
  });

  it("hears a room's word of many players at once as it would each alone, a game's player staying in the game", async () => {
    const many = Array.from({ length: 250 }, (_, n) => ({
      playerId: playerId(`20000000-0000-0000-0000-${String(n).padStart(12, "0")}`),
      username: `Member${n}`,
      guest: false,
      device: null,
    }));
    // One of them has the Works open, which says so; the room has them in town on another page.
    const gamer = many[137];
    if (gamer === undefined) throw new Error("No player 137");
    await services.run(Visits.use((v) => v.called(gamer, "works", null, T0)));
    await services.run(Visits.use((v) => v.inRoom(many, "town", T0)));
    await services.run(Visits.use((v) => v.inRoom(many, "town", T0 + 30 * SECOND)));

    const open = await services.query(
      (sql) => sql`SELECT place, heard_at, count(*) AS n FROM visits WHERE left_at IS NULL GROUP BY 1, 2 ORDER BY 1`,
    );
    expect(open).toEqual([
      { place: "town", heard_at: T0 + 30 * SECOND, n: 249 },
      { place: "works", heard_at: T0, n: 1 },
    ]);
    const time = await services.query(
      (sql) => sql`SELECT game, count(*) AS n, sum(played_ms) AS played, sum(afk_ms) AS afk FROM time_in GROUP BY 1`,
    );
    expect(time).toEqual([{ game: "town", n: 249, played: 0, afk: 249 * 30 * SECOND }]);
  });

  it("closes the visit in one place when the player comes to another, in the same session", async () => {
    await call("alice", "camp");
    clock.now = T0 + 40 * SECOND;
    await call("alice", "works");

    const [camp, works] = await visits();
    expect(camp).toMatchObject({ place: "camp", left_at: T0 + 40 * SECOND, seconds: 40 });
    expect(works).toMatchObject({ place: "works", entered_at: T0 + 40 * SECOND, left_at: null });
    expect(works?.session_id).toBe(camp?.session_id ?? -1);
  });

  it("joins visits less than five minutes apart into one session, and begins another at five", async () => {
    await stay("bob", "camp", T0, 1, 30 * SECOND, "desktop");
    // 4 minutes 59 seconds after the last call: the same sitting.
    await stay("bob", "table", T0 + MINUTE + 4 * MINUTE + 59 * SECOND, 1, 30 * SECOND);
    const lastCall = T0 + MINUTE + 4 * MINUTE + 59 * SECOND + MINUTE;
    // Exactly five minutes after: a new one, on a phone this time.
    await stay("bob", "camp", lastCall + 5 * MINUTE, 2, MINUTE, "phone");
    clock.now = lastCall + 5 * MINUTE + 2 * MINUTE + 90 * SECOND;
    await call("alice", "town");

    expect(await visits()).toMatchObject([
      { player_id: bob, place: "camp", seconds: 60, session_id: 1 },
      { player_id: bob, place: "table", seconds: 60, session_id: 1 },
      { player_id: bob, place: "camp", seconds: 120, session_id: 2 },
      { player_id: alice, place: "town", left_at: null, session_id: 3 },
    ]);
    expect((await sessions()).slice(0, 2)).toEqual([
      {
        id: 1,
        player_id: bob,
        guest: 0,
        started_at: T0,
        ended_at: lastCall,
        seconds: 120,
        device: "desktop",
        places: { camp: 60, table: 60 },
      },
      {
        id: 2,
        player_id: bob,
        guest: 0,
        started_at: lastCall + 5 * MINUTE,
        ended_at: lastCall + 7 * MINUTE,
        seconds: 120,
        device: "phone",
        places: { camp: 120 },
      },
    ]);
  });

  it("keeps one row a player: first and last seen, all their time, their sessions, and their name and guest as last known", async () => {
    await stay("carol", "town", T0, 3);
    await stay("carol", "works", T0 + HOUR, 2, MINUTE, "phone");
    clock.now = T0 + 2 * HOUR;
    await call("alice", "town");

    expect(await playersSeen()).toEqual([
      {
        player_id: alice,
        name: "Alice",
        guest: 0,
        first_seen_at: T0 + 2 * HOUR,
        last_seen_at: T0 + 2 * HOUR,
        seconds_total: 0,
        sessions: 1,
      },
      {
        player_id: carol,
        name: "Carol",
        guest: 1,
        first_seen_at: T0,
        last_seen_at: T0 + HOUR + 2 * MINUTE,
        seconds_total: 5 * 60,
        sessions: 2,
      },
    ]);
  });

  it("removes in the minute's upkeep the visits and sessions that ended 180 days ago, and keeps the players", async () => {
    clock.now = T0 - 181 * DAY;
    await call("bob", "camp");
    clock.now = T0 - 179 * DAY;
    await call("carol", "camp");
    clock.now = T0;
    await call("alice", "town");
    const written = (await visits()).map((v) => v.player_id);
    await services.run(Visits.use((v) => v.removeOld(T0)));

    expect(written).toEqual([bob, carol, alice]);
    expect((await visits()).map((v) => v.player_id)).toEqual([carol, alice]);
    expect((await sessions()).map((s) => s.player_id)).toEqual([carol, alice]);
    expect((await playersSeen()).map((p) => p.player_id)).toEqual([alice, bob, carol]);
  });

  it("keeps nothing of where a player was once their newest visit is removed, 180 days on", async () => {
    clock.now = T0 - 181 * DAY;
    await call("bob", "camp");
    clock.now = T0 - 179 * DAY;
    await call("carol", "camp");
    await services.run(Visits.use((v) => v.removeOld(T0)));

    expect(await services.query((sql) => sql`SELECT player_id, place FROM last_visits ORDER BY player_id`)).toEqual([
      { player_id: carol, place: "camp" },
    ]);
  });

  it("removes at most 1,000 old visits and 1,000 old sessions a minute, the oldest first", async () => {
    // 1,200 sittings of one visit each, ended 200 days ago, a second apart.
    await services.query((sql) =>
      Effect.forEach(
        Array.from({ length: 1200 }, (_, n) => n),
        (n) =>
          Effect.gen(function* () {
            const ended = T0 - 200 * DAY + n * SECOND;
            const [session] = yield* sql<{ id: number }>`
            INSERT INTO sessions (player_id, guest, started_at, ended_at) VALUES (${bob}, 0, ${ended}, ${ended}) RETURNING id
          `;
            yield* sql`
            INSERT INTO visits (session_id, player_id, guest, place, source, entered_at, heard_at, left_at, instance)
            VALUES (${session?.id ?? 0}, ${bob}, 0, 'town', 'call', ${ended}, ${ended}, ${ended}, 'earlier')
          `;
          }),
      ).pipe(Effect.as([])),
    );
    const left = () =>
      services.query(
        (sql) => sql`SELECT (SELECT count(*) FROM visits) AS visits, (SELECT count(*) FROM sessions) AS sessions`,
      );

    await services.run(Visits.use((v) => v.removeOld(T0)));
    const once = await left();
    await services.run(Visits.use((v) => v.removeOld(T0 + MINUTE)));

    expect(once).toEqual([{ visits: 200, sessions: 200 }]);
    expect(await left()).toEqual([{ visits: 0, sessions: 0 }]);
  });

  it("closes at most a hundred visits gone silent before each write, the longest silent first, and the rest in the minute's upkeep", async () => {
    const many = Array.from({ length: 250 }, (_, n) => ({
      playerId: playerId(`20000000-0000-0000-0000-${String(n).padStart(12, "0")}`),
      username: `Member${n}`,
      guest: false,
      device: null,
    }));
    // Each comes into the town's room a tenth of a second after the one before, and none is heard of again.
    for (const [n, who] of many.entries()) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      await services.run(Visits.use((v) => v.inRoom([who], "town", T0 + n * 100)));
    }
    clock.now = T0 + HOUR;
    await call("alice", "town");
    const afterWrite = await services.query(
      (sql) =>
        sql`SELECT count(*) AS n, max(left_at) AS last FROM visits WHERE player_id <> ${alice} AND left_at IS NOT NULL`,
    );
    await services.run(Visits.use((v) => v.closeSilent(T0 + HOUR)));

    expect(afterWrite).toEqual([{ n: 100, last: T0 + 99 * 100 }]);
    expect(
      await services.query(
        (sql) =>
          sql`SELECT count(*) AS n FROM visits WHERE player_id <> ${alice} AND left_at = heard_at AND seconds = 0`,
      ),
    ).toEqual([{ n: 250 }]);
  });

  it("takes a device only as phone or desktop", async () => {
    const response = await app.request("/v1/game/presence", {
      method: "PUT",
      headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" },
      body: JSON.stringify({ place: "town", device: "tablet" }),
    });

    expect(response.status).toBe(400);
    expect(await visits()).toEqual([]);
  });
});

/** A die that falls the same way every run: a whole number from 0 up to `n` (mulberry32, in exact 32-bit steps). */
function die(seed: number) {
  let state = seed >>> 0;
  return (n: number) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}

/** One visit as `history` writes it. */
interface Stay {
  readonly place: string;
  readonly entered: number;
  readonly heard: number;
  readonly left: number | null;
}

/**
 * One to four visits of a player over the last 26 hours as of `T0`, whole minutes apart so that some
 * are seen at the same moment: the newest open (heard of in the last few minutes) or closed, some
 * closed as they moved on, some silent at the last time they were heard of, and now and then one
 * closed before it was last heard of (as Leaf's farewell may, racing a page's call).
 */
function staysOf(roll: (n: number) => number): Stay[] {
  const stays: Stay[] = [];
  let at = T0 - 26 * HOUR + roll(20 * 60) * MINUTE;
  const count = 1 + roll(4);
  for (let k = 0; k < count; k++) {
    const open = k === count - 1 && roll(2) === 0;
    const heard = open ? T0 - roll(6) * 30 * SECOND : at + roll(30) * MINUTE;
    const left = open ? null : heard + (roll(4) - 1) * MINUTE;
    const entered = Math.min(at, heard, left ?? heard);
    stays.push({ place: ["town", "works", "camp", "table"][roll(4)] ?? "town", entered, heard, left });
    at = Math.max(left ?? heard, heard) + roll(3 * 60) * MINUTE;
  }
  return stays;
}

/**
 * `players` players with the visits `staysOf` makes them, names that repeat, a guest in four and one
 * in three who would rather not stay; and two whose only visit was last heard of just after the
 * start of `T0`'s day and closed just before it, one who stays and one who does not.
 */
async function history(players: number) {
  const roll = die(7);
  const everyone = [
    ...Array.from({ length: players }, (_, n) => ({
      id: `60000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
      name: `P${n % 40}`,
      guest: roll(4) === 0 ? 1 : 0,
      stay: roll(3) === 0 ? 0 : 1,
      stays: staysOf(roll),
    })),
    ...[1, 0].map((stays) => ({
      id: `70000000-0000-0000-0000-00000000000${stays}`,
      name: `Edge${stays}`,
      guest: 0,
      stay: stays,
      stays: [{ place: "town", entered: T0 - DAY - HOUR, heard: T0 - DAY + 30 * SECOND, left: T0 - DAY - 30 * SECOND }],
    })),
  ];
  await services.query((sql) =>
    Effect.forEach(everyone, (p) =>
      Effect.gen(function* () {
        const [session] = yield* sql<{ id: number }>`
          INSERT INTO sessions (player_id, guest, started_at) VALUES (${p.id}, ${p.guest}, ${T0 - DAY}) RETURNING id
        `;
        for (const v of p.stays) {
          yield* sql`
            INSERT INTO visits (session_id, player_id, guest, place, source, entered_at, heard_at, left_at, instance)
            VALUES (${session?.id ?? 0}, ${p.id}, ${p.guest}, ${v.place}, 'call', ${v.entered}, ${v.heard}, ${v.left}, 'earlier')
          `;
        }
        yield* sql`
          INSERT INTO players_seen (player_id, name, guest, first_seen_at, last_seen_at, stay)
          VALUES (${p.id}, ${p.name}, ${p.guest}, ${T0 - DAY}, ${T0}, ${p.stay})
        `;
      }),
    ).pipe(Effect.as([])),
  );
}

/** What `history` wrote, as counts: players with more than one visit, newest visits open and closed, who stay and who do not, and visits closed before they were last heard of. */
const mix = async () =>
  services.query<{ several: number; open: number; closed: number; stay: number; go: number; early: number }>(
    (sql) => sql`
      SELECT
        (SELECT count(*) FROM (SELECT player_id FROM visits GROUP BY player_id HAVING count(*) > 1)) AS several,
        (SELECT count(*) FROM last_visits WHERE left_at IS NULL) AS open,
        (SELECT count(*) FROM last_visits WHERE left_at IS NOT NULL) AS closed,
        (SELECT count(*) FROM players_seen WHERE stay = 1) AS stay,
        (SELECT count(*) FROM players_seen WHERE stay = 0) AS go,
        (SELECT count(*) FROM visits WHERE left_at < heard_at) AS early
    `,
  );

/** Each player's newest visit of the day before `now`, read from every visit of the day, as Leaf first did. */
const Newest = Schema.Struct({
  playerId: Schema.String,
  username: Schema.String,
  place: Schema.String,
  guest: Schema.BooleanFromBit,
  heardAt: Schema.Number,
  leftAt: Schema.NullOr(Schema.Number),
  stay: Schema.BooleanFromBit,
});
const newestOfTheDay = async (now: number) =>
  Schema.decodeUnknownSync(Schema.Array(Newest))(
    await services.query(
      (sql) => sql`
        SELECT v.player_id AS playerId, p.name AS username, v.place, v.guest, v.heard_at AS heardAt,
               v.left_at AS leftAt, p.stay
        FROM visits AS v JOIN players_seen AS p ON p.player_id = v.player_id
        WHERE v.id IN (SELECT max(id) FROM visits WHERE heard_at >= ${now - DAY} GROUP BY player_id)
      `,
    ),
  );

/** Who is about, as Bob's page is given it now. */
async function lists() {
  const response = await app.request("/v1/game/presence", { headers: { Authorization: "Bearer bob-token" } });
  const body: unknown = await response.json();
  return body;
}

describe("who is about, as every page is given it", () => {
  it("is read once a second for everybody: a page heard of again within it shows the time it was heard before", async () => {
    await call("alice", "town");
    clock.now = T0 + 500;
    await call("alice", "town");
    const within = await lists();
    clock.now = T0 + SECOND;
    const after = await lists();

    expect(within).toMatchObject({ at: iso(T0), present: [{ username: "Alice", seen_at: iso(T0) }] });
    expect(after).toMatchObject({ at: iso(T0 + SECOND), present: [{ username: "Alice", seen_at: iso(T0 + 500) }] });
  });

  it("is read again at once after a change: somebody comes, moves, or says otherwise about staying", async () => {
    await call("alice", "town");
    clock.now = T0 + 100;
    await call("bob", "works");
    const came = await lists();
    clock.now = T0 + 200;
    await call("alice", "camp");
    const moved = await lists();

    expect(came).toMatchObject({ at: iso(T0 + 100), present: [{ username: "Alice" }, { username: "Bob" }] });
    expect(moved).toMatchObject({
      at: iso(T0 + 200),
      present: [{ username: "Alice", place: "camp" }, { username: "Bob" }],
    });
  });
});

/** Those on the lists whose only visit closed just before the day began. */
const edges = (here: Here) =>
  [...here.resting, ...here.gone].filter((p) => p.username.startsWith("Edge")).map((p) => p.username);

describe("who is about", () => {
  // With 20 players no list is full, so that the oldest of the day count; with 300 every list is.
  for (const players of [20, 300]) {
    it(`is what each player's newest visit of the day says, as every visit of the day would have it, of ${players}`, async () => {
      await history(players);
      const [counts] = await mix();
      const made: Here[] = [];
      for (const now of [T0, T0 + 45 * SECOND, T0 + 2 * MINUTE, T0 + 2 * HOUR]) {
        // oxlint-disable-next-line no-await-in-loop -- one moment after another
        const about = await services.run(Visits.use((v) => v.about(now)));
        // oxlint-disable-next-line no-await-in-loop -- one moment after another
        const expected = hereFrom(await newestOfTheDay(now), now);
        expect(about).toEqual(expected);
        made.push(expected);
      }

      expect(counts?.several ?? 0).toBeGreaterThan(players / 3);
      expect(counts?.early ?? 0).toBeGreaterThan(2);
      expect(Math.min(counts?.open ?? 0, counts?.closed ?? 0, counts?.stay ?? 0, counts?.go ?? 0)).toBeGreaterThan(
        players / 10,
      );
      // The two closed just before the day began, and last heard of after, are gone as of T0, and not 45 seconds on.
      expect(made.map(edges)).toEqual(players === 20 ? [["Edge1", "Edge0"], [], [], []] : [[], [], [], []]);
    });
  }
});

/** How many days a report covers. */
const daysOf = (body: unknown) =>
  typeof body === "object" && body !== null && "days" in body && Array.isArray(body.days) ? body.days.length : -1;
/** A time in November 2026, UTC. */
const day = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h, m);
const iso = (at: number) => new Date(at).toISOString();

describe("GET /v1/game/admin/activity", () => {
  it("is for website admins alone: a guest and an ordinary member are refused, and nothing is sent", async () => {
    const asks = await Promise.all(
      ["carol-token", "alice-token", "stale-token"].map(async (token) => {
        const response = await app.request("/v1/game/admin/activity", {
          headers: { Authorization: `Bearer ${token}` },
        });
        return [response.status, await response.json()];
      }),
    );

    expect(asks).toEqual([
      [403, { code: "staff_only", message: "This is for the guild's staff" }],
      [403, { code: "staff_only", message: "This is for the guild's staff" }],
      [401, { code: "unauthorized", message: "Your session has expired. Sign in again" }],
    ]);
    expect((await report()).status).toBe(200);
  });

  it("names a player as they are now, and says whether a guest, when that changes while they stay in one place", async () => {
    await stay("carol", "town", T0, 1, 30 * SECOND);
    // Carol joins the guild and takes another name while her page is still in town.
    backend.sessions["carol-token"] = () => Response.json(sessionOf(carol, "Caroline", "RECRUIT"));
    await stay("carol", "town", T0 + 90 * SECOND, 1, 30 * SECOND);
    clock.now = T0 + 160 * SECOND;

    const { body } = await report();

    expect(await visits()).toMatchObject([{ player_id: carol, place: "town", entered_at: T0, left_at: null }]);
    expect(body).toMatchObject({
      here: [{ id: carol, name: "Caroline", guest: false, place: "town", since: iso(T0) }],
      players: [{ id: carol, name: "Caroline", guest: false }],
    });
  });

  it("covers the last 7 UTC days unless told, at most 90, and refuses a number of days that is not one", async () => {
    expect(daysOf((await report()).body)).toBe(7);
    expect(daysOf((await report("?days=1")).body)).toBe(1);
    expect(daysOf((await report("?days=500")).body)).toBe(90);
    for (const bad of ["0", "-3", "two", "1.5"]) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      expect(await report(`?days=${bad}`)).toEqual({
        status: 400,
        body: { code: "invalid_days", message: "days must be a whole number of days, 1 or more" },
      });
    }
  });

  it("reports who is where, each player's times, the days, how far players get, and what is odd, over a few days", async () => {
    // Before the period: Alice's first evening in town.
    await stay("alice", "town", day(22, 20), 30);
    // Alice in her camp across midnight into the period's second day.
    await stay("alice", "camp", day(23, 23, 30), 60);
    // Bob: the Works, then the town two minutes later, in one sitting.
    await stay("bob", "works", day(24, 10), 20, MINUTE, "desktop");
    await stay("bob", "town", day(24, 10, 22), 10);
    // Carol, a guest on a phone, sits down at the table 21 times in a day, a minute each.
    for (let n = 0; n < 21; n++) {
      // oxlint-disable-next-line no-await-in-loop -- in order, as time passes
      await stay("carol", "table", day(24, 12) + n * 6 * MINUTE, 1, MINUTE, "phone");
    }
    // Bob in town twelve and a half hours, his page saying so every 75 seconds.
    await stay("bob", "town", day(25, 5), 12 * 60 + 30, 75 * SECOND);
    // Alice is in town now.
    await stay("alice", "town", day(25, 17, 59) + 30 * SECOND, 0);

    // What the games logged, as the play service writes it.
    const logged = [
      [alice, day(20, 9), "works", "works_story", { order: 1, title: "Planks", pay: 20 }],
      [alice, day(24, 9), "works", "works_order", { order: 3, title: "Pots", pay: 90 }],
      [carol, day(24, 12, 30), "works", "works_story", { order: 1, title: "Planks", pay: 20 }],
      [carol, day(24, 12, 40), "works", "works_story", { order: 2, title: "Bricks", pay: 40 }],
      [alice, day(24, 15), "raid", "raid_started", { trail: 0 }],
      [alice, day(24, 15, 5), "raid", "raid_room", { room: 1, kind: "trouble", won: true, resolve: 3, seconds: 41 }],
      [alice, day(24, 15, 9), "raid", "raid_room", { room: 2, kind: "trouble", won: true, resolve: 3, seconds: 38.5 }],
      [alice, day(24, 15, 14), "raid", "raid_room", { room: 3, kind: "boss", won: false, resolve: 0, seconds: 63 }],
      [alice, day(24, 15, 15), "raid", "raid_ended", { trail: 0, rooms_won: 2, ended: "lost", coins: 40 }],
      [bob, day(25, 6), "raid", "raid_started", { trail: 1 }],
      [bob, day(25, 6, 4), "raid", "raid_room", { room: 1, kind: "trouble", won: true, resolve: 3, seconds: 30 }],
    ] as const;
    for (const [player, at, game, kind, data] of logged) {
      // oxlint-disable-next-line no-await-in-loop -- in order
      await services.query(
        (sql) => sql`
          INSERT INTO activity (player_id, at, game, kind, data)
          VALUES (${player}, ${at}, ${game}, ${kind}, ${JSON.stringify(data)})
        `,
      );
    }
    // The Coins ledger, as the play service keeps it.
    const coins: readonly (readonly [PlayerId, number, number])[] = [
      [alice, day(25, 9), 3000],
      [alice, day(25, 9, 40), 2500],
      [bob, day(25, 9), 4000],
    ];
    for (const [n, [player, at, amount]] of coins.entries()) {
      // oxlint-disable-next-line no-await-in-loop -- in order
      await services.query(
        (sql) => sql`
          INSERT INTO coin_entries (player_id, amount, reason, game, key, at)
          VALUES (${player}, ${amount}, 'takings', 'raid', ${`k${n}`}, ${at})
        `,
      );
    }
    clock.now = day(25, 18);

    const { status, body } = await report("?days=3");

    const done = (player: PlayerId) =>
      logged
        .filter(([p]) => p === player)
        .toSorted((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([, at, game, kind, data]) => ({ at: iso(at), game, kind, data }));
    expect(status).toBe(200);
    expect(body).toEqual({
      now: iso(day(25, 18)),
      here: [{ id: alice, name: "Alice", guest: false, place: "town", since: iso(day(25, 17, 59) + 30 * SECOND) }],
      players: [
        {
          id: bob,
          name: "Bob",
          guest: false,
          first_seen_at: iso(day(24, 10)),
          last_seen_at: iso(day(25, 17, 30)),
          seconds_total: 20 * 60 + 10 * 60 + 12.5 * 3600,
          sessions: 2,
          seconds: 20 * 60 + 10 * 60 + 12.5 * 3600,
          places: { works: 20 * 60, town: 10 * 60 + 12.5 * 3600 },
          done: done(bob),
        },
        {
          id: alice,
          name: "Alice",
          guest: false,
          first_seen_at: iso(day(22, 20)),
          last_seen_at: iso(day(25, 18)),
          // Her evening before the period counts toward all her time, and her half minute in town now.
          seconds_total: 30 * 60 + 60 * 60 + 30,
          sessions: 2,
          seconds: 60 * 60 + 30,
          places: { camp: 60 * 60, town: 30 },
          done: done(alice),
        },
        {
          id: carol,
          name: "Carol",
          guest: true,
          first_seen_at: iso(day(24, 12)),
          last_seen_at: iso(day(24, 14, 1)),
          seconds_total: 21 * 60,
          sessions: 21,
          seconds: 21 * 60,
          places: { table: 21 * 60 },
          done: done(carol),
        },
      ],
      days: [
        { day: "2026-11-23", players: 1, new_players: 0, sessions: 1, hours: 0.5, places: { camp: 0.5 } },
        {
          day: "2026-11-24",
          players: 3,
          new_players: 2,
          sessions: 22,
          hours: 1.35,
          places: { camp: 0.5, works: 0.33, town: 0.17, table: 0.35 },
        },
        { day: "2026-11-25", players: 2, new_players: 0, sessions: 2, hours: 12.51, places: { town: 12.51 } },
      ],
      raid: {
        began: 2,
        runs: [
          { rooms_won: 1, runs: 1 },
          { rooms_won: 2, runs: 1 },
        ],
      },
      works: {
        began: 1,
        players: [
          { story_orders: 1, players: 1 },
          { story_orders: 2, players: 1 },
        ],
      },
      odd: [
        { id: alice, name: "Alice", rule: "coins_in_an_hour", at: iso(day(25, 9)), value: 5500 },
        { id: bob, name: "Bob", rule: "long_visit", at: iso(day(25, 5)), value: 12.5 * 3600 },
        { id: carol, name: "Carol", rule: "sessions_in_a_day", at: iso(day(24, 0)), value: 21 },
      ],
    });
  });
});
