import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { leaf, MAX_SAVE_BYTES, type PlayerId, playerId } from "@sequoia-leaf/core";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";

import { Events, type PlayerEvent } from "../src/events/store.ts";
import { API_POLICY } from "../src/http/headers.ts";
import { StreamTuning } from "../src/http/streams.ts";
import { Ledger } from "../src/ledger/store.ts";
import type { questJson } from "../src/quests/json.ts";
import {
  type Backend,
  DAY,
  fakeBackend,
  type FakeMojang,
  fakeMojang,
  type Fetcher,
  HOUR,
  MINUTE,
  plainPng,
  sessionOf,
  skinPng,
  testLeaf,
} from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
const dave = playerId("10000000-0000-0000-0000-000000000004");
/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const ORIGIN = "https://leaf.seqwawa.com";

/** A quest as events carry it. */
const questLike: ReturnType<typeof questJson> = {
  id: "daily:1",
  slot: "daily",
  title: "Complete 2 raids",
  objective: { type: "raids", raid: null },
  progress: 0,
  target: 2,
  goals: [],
  reward: { leaf: 200, xp: 100 },
  started_at: "2026-11-25T00:00:00.000Z",
  expires_at: null,
  completed_at: null,
};

const clock = { now: T0 };
let backend: Backend;
let fetcher: Fetcher;
let mojang: FakeMojang;
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

beforeEach(() => {
  clock.now = T0;
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
    "carol-token": () => Response.json(sessionOf(carol, "Carol", null)),
  });
  backend = fake.backend;
  fetcher = fake.fetcher;
  mojang = fakeMojang();
  services = testLeaf(clock, fake.fetcher, {}, { mojang: mojang.service });
  // A stream that looks for events every 5 ms, keeps quiet connections alive every 20 ms and closes after 300 ms.
  app = services.app(Layer.succeed(StreamTuning)({ pollMs: 5, heartbeatMs: 20, maxMs: 300 }));
});

afterEach(async () => {
  await app.dispose();
});

interface Sent {
  /** The `seq_session` cookie. */
  readonly cookie?: string;
  /** The Bearer token. */
  readonly bearer?: string;
  readonly origin?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/** A request as a browser or the mod would send it. */
function send(method: string, path: string, sent: Sent = {}): Promise<Response> {
  const headers: Record<string, string> = { ...sent.headers };
  if (sent.cookie !== undefined) {
    headers["Cookie"] = `seq_session=${sent.cookie}`;
  }
  if (sent.bearer !== undefined) {
    headers["Authorization"] = `Bearer ${sent.bearer}`;
  }
  if (sent.origin !== undefined) {
    headers["Origin"] = sent.origin;
  }
  if (sent.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      ...(sent.body === undefined
        ? {}
        : { body: typeof sent.body === "string" ? sent.body : JSON.stringify(sent.body) }),
    }),
  );
}

const ErrorAnswer = Schema.decodeUnknownSync(Schema.Struct({ code: Schema.String }));

/** The `code` of an error answer. */
async function codeOf(response: Response): Promise<string> {
  return ErrorAnswer(await response.json()).code;
}

/** The ids of the events in an answer. */
const eventIds = (answer: unknown) =>
  Schema.decodeUnknownSync(Schema.Struct({ events: Schema.Array(Schema.Struct({ id: Schema.Number })) }))(
    answer,
  ).events.map((event) => event.id);

/** Alice in the game: her cookie, from Leaf's own page. */
const alicesPage = { cookie: "alice-token", origin: ORIGIN };

function get(path: string, sent: Sent = { cookie: "alice-token" }) {
  return send("GET", path, sent);
}

/** Who each session belongs to. */
const signedIn: Readonly<Record<string, PlayerId>> = { "alice-token": alice, "bob-token": bob, "carol-token": carol };

/** A save as the game sends it: as the member the page believes it is, by default whoever it is signed in as. */
function save(slot: string, version: number, data: unknown, sent: Sent = alicesPage, player?: string) {
  const as = player ?? signedIn[sent.bearer ?? sent.cookie ?? ""] ?? "nobody";
  return send("PUT", `/v1/game/saves/${slot}`, { ...sent, body: { player: as, version, data } });
}

function happened(player: PlayerId, event: PlayerEvent): Promise<void> {
  return services.run(Events.use((events) => events.insert(player, event, clock.now)));
}

/** Pays a player for a raid in the ledger, without its event, so Leaf knows them. */
function paid(player: PlayerId): Promise<unknown> {
  return services.post(
    { kind: "earn", playerId: player, amount: leaf(110), source: "raid", idempotencyKey: `raid:0:${player}` },
    clock.now,
  );
}

function raided(player: PlayerId, amount: number, detail = "The Nameless Anomaly") {
  return happened(player, {
    type: "leaf_earned",
    data: { source: "raid", leaf: amount, xp: amount, detail, occurred_at: "2026-11-25T11:58:00.000Z" },
  });
}

/** Reads a stream until its text contains every one of the strings, and returns the text. */
async function readUntil(response: Response, ...wanted: string[]): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error("The response has no body");
  }
  const decoder = new TextDecoder();
  let text = "";
  /* oxlint-disable no-await-in-loop -- chunks arrive one after another */
  while (!wanted.every((part) => text.includes(part))) {
    const { done, value } = await reader.read();
    if (done) {
      throw new Error(`The stream ended before sending ${JSON.stringify(wanted)}. It sent: ${text}`);
    }
    text += decoder.decode(value, { stream: true });
  }
  /* oxlint-enable no-await-in-loop */
  await reader.cancel();
  return text;
}

describe("signing in with the website's cookie", () => {
  it("lets a member in by the cookie, checked with the backend like a Bearer session", async () => {
    const response = await get("/v1/game/me");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ player: { id: alice, username: "Alice" } });
    expect(backend.calls).toEqual(["/auth/web/me"]);
  });

  it("still lets a member in by a Bearer header, on the game's routes and the mod's", async () => {
    expect(await (await get("/v1/game/me", { bearer: "bob-token" })).json()).toMatchObject({ player: { id: bob } });
    expect(await (await get("/v1/me", { cookie: "alice-token" })).json()).toMatchObject({ player: { id: alice } });
  });

  it("refuses a cookie the backend does not accept, lets a non-member in as a guest, and says so when the backend is down", async () => {
    const stale = await get("/v1/game/me", { cookie: "stale-token" });
    const visitor = await get("/v1/game/me", { cookie: "carol-token" });
    backend.sessions["alice-token"] = () => new Response("down", { status: 502 });
    const down = await get("/v1/game/me", { cookie: "alice-token" });

    expect([stale.status, visitor.status, down.status]).toEqual([401, 200, 503]);
    expect(await visitor.json()).toMatchObject({ player: { id: carol }, guest: true });
    expect(await down.json()).toMatchObject({ code: "identity_unavailable" });
  });

  it("with both, goes by a Bearer the backend accepts, and by the cookie otherwise", async () => {
    const bearerWins = await get("/v1/game/me", { cookie: "alice-token", bearer: "bob-token" });
    const staleBearer = await get("/v1/game/me", { cookie: "alice-token", bearer: "stale-token" });
    const guestsBearer = await get("/v1/game/me", { cookie: "alice-token", bearer: "carol-token" });
    const guestsCookie = await get("/v1/game/me", { cookie: "carol-token", bearer: "stale-token" });
    // Only members pass the mod's routes: a non-member's Bearer lets nobody in there.
    const visitorsBearer = await get("/v1/me", { cookie: "alice-token", bearer: "carol-token" });
    const bothRefused = await get("/v1/me", { cookie: "carol-token", bearer: "stale-token" });

    expect(await bearerWins.json()).toMatchObject({ player: { id: bob } });
    expect(await staleBearer.json()).toMatchObject({ player: { id: alice } });
    expect(await guestsBearer.json()).toMatchObject({ player: { id: carol }, guest: true });
    expect(await guestsCookie.json()).toMatchObject({ player: { id: carol }, guest: true });
    expect(await visitorsBearer.json()).toMatchObject({ player: { id: alice } });
    // When neither lets the request in, the cookie's refusal is the answer.
    expect(bothRefused.status).toBe(403);
    expect(await codeOf(bothRefused)).toBe("not_a_member");
  });

  it("refuses a request with two session cookies, with or without a Bearer, and asks the backend nothing", async () => {
    const twice = await get("/v1/game/me", { headers: { Cookie: "seq_session=alice-token; seq_session=bob-token" } });
    const withBearer = await get("/v1/me", {
      bearer: "alice-token",
      headers: { Cookie: "seq_session=bob-token; theme=dark; seq_session=alice-token" },
    });
    const write = await send("PUT", "/v1/game/presence", {
      origin: ORIGIN,
      body: { place: "town" },
      headers: { Cookie: "seq_session=alice-token;seq_session=alice-token" },
    });

    expect([twice.status, withBearer.status, write.status]).toEqual([401, 401, 401]);
    expect(await codeOf(twice)).toBe("unauthorized");
    expect(backend.calls).toEqual([]);
    expect(await services.query((sql) => sql`SELECT COUNT(*) AS n FROM presence`)).toEqual([{ n: 0 }]);
  });

  it("finds the session cookie among others", async () => {
    const response = await get("/v1/game/me", { headers: { Cookie: "theme=dark; seq_session=alice-token; lang=en" } });

    expect(await response.json()).toMatchObject({ player: { id: alice } });
  });

  it("refuses a write with the cookie that has no Origin or another one, and changes nothing", async () => {
    const none = await save("town", 0, { saved_at: 1 }, { cookie: "alice-token" });
    const elsewhere = await save("town", 0, { saved_at: 1 }, { cookie: "alice-token", origin: "https://seqwawa.com" });
    const presence = await send("PUT", "/v1/game/presence", {
      cookie: "alice-token",
      origin: "https://evil.example",
      body: { place: "town" },
    });
    const reroll = await send("POST", "/v1/me/quests/daily:1/reroll", { cookie: "alice-token", body: { leaf: 0 } });

    expect([none.status, elsewhere.status, presence.status, reroll.status]).toEqual([403, 403, 403, 403]);
    expect(await none.json()).toEqual({ code: "bad_origin", message: "Leaf takes this only from its own pages" });
    expect(await services.query((sql) => sql`SELECT COUNT(*) AS n FROM saves`)).toEqual([{ n: 0 }]);
    expect(await services.query((sql) => sql`SELECT COUNT(*) AS n FROM presence`)).toEqual([{ n: 0 }]);
    expect(await services.query((sql) => sql`SELECT COUNT(*) AS n FROM quest_rerolls`)).toEqual([{ n: 0 }]);
  });

  it("takes a write with the cookie from Leaf's own pages, and one with a Bearer from anywhere", async () => {
    const fromPage = await save("town", 0, { saved_at: 1 }, alicesPage);
    const fromMod = await save("works", 0, { saved_at: 1 }, { bearer: "alice-token" });
    const bothNoOrigin = await save("town", 0, { saved_at: 1 }, { bearer: "bob-token", cookie: "bob-token" }, bob);

    expect([fromPage.status, fromMod.status, bothNoOrigin.status]).toEqual([200, 200, 200]);
  });

  it("reads the origin to expect from PUBLIC_ORIGIN", async () => {
    const local = testLeaf(
      clock,
      fakeBackend({ "alice-token": () => Response.json(sessionOf(alice, "Alice")) }).fetcher,
      {
        publicOrigin: "http://127.0.0.1:4000",
      },
    ).app();
    const sent = { method: "PUT", body: JSON.stringify({ place: "town" }) };
    const headers = { Cookie: "seq_session=alice-token", "Content-Type": "application/json" };

    const fromLocal = await local.request("/v1/game/presence", {
      ...sent,
      headers: { ...headers, Origin: "http://127.0.0.1:4000" },
    });
    const fromLive = await local.request("/v1/game/presence", { ...sent, headers: { ...headers, Origin: ORIGIN } });

    expect([fromLocal.status, fromLive.status]).toEqual([200, 403]);
    await local.dispose();
  });
});

/** What a route answers a request: the method, the path, the status, and the error code if it refused. */
async function outcome(
  method: string,
  path: string,
  sent: Sent,
): Promise<readonly [string, string, number, string | null]> {
  const response = await send(method, path, sent);
  return [method, path, response.status, response.status >= 400 ? await codeOf(response) : null];
}

describe("who may use the game's routes", () => {
  const routes = [
    ["GET", "/v1/game/me"],
    ["GET", "/v1/game/saves"],
    ["GET", "/v1/game/saves/town"],
    ["PUT", "/v1/game/saves/town"],
    ["GET", `/v1/game/skins/${bob}`],
    ["GET", "/v1/game/guild/events"],
    ["GET", "/v1/game/guild/events/stream"],
    ["PUT", "/v1/game/presence"],
    ["GET", "/v1/game/presence"],
    ["GET", "/v1/game/admin/activity"],
  ] as const;

  it("refuses everyone signed out on every route but hello", async () => {
    const answers = await Promise.all(routes.map(([method, path]) => outcome(method, path, {})));

    expect(answers).toEqual(routes.map(([method, path]) => [method, path, 401, "unauthorized"]));
  });

  it("lets a non-member in as a guest on every route but the guild's news, with the cookie or a Bearer", async () => {
    const answers = await Promise.all(
      routes.flatMap(([method, path]) =>
        [{ cookie: "carol-token", origin: ORIGIN }, { bearer: "carol-token" }].map((sent) =>
          outcome(method, path, sent),
        ),
      ),
    );

    // Sent with no body, the two writes are let in and then refused for what they lack.
    const expected = {
      "/v1/game/me": [200, null],
      "/v1/game/saves": [200, null],
      "GET /v1/game/saves/town": [404, "no_save"],
      "PUT /v1/game/saves/town": [400, "invalid_save"],
      [`/v1/game/skins/${bob}`]: [404, "no_skin"],
      "/v1/game/guild/events": [403, "members_only"],
      "/v1/game/guild/events/stream": [403, "members_only"],
      "PUT /v1/game/presence": [400, "invalid_place"],
      "GET /v1/game/presence": [200, null],
      "/v1/game/admin/activity": [403, "staff_only"],
    } as Record<string, readonly [number, string | null]>;
    expect(answers).toEqual(
      routes.flatMap(([method, path]) => {
        const [status, code] = expected[path] ?? expected[`${method} ${path}`] ?? [0, null];
        return [
          [method, path, status, code],
          [method, path, status, code],
        ];
      }),
    );
    // Nobody Leaf knows is called Bob for a guest: Mojang is not asked.
    expect(mojang.calls).toEqual([]);
  });

  it("still refuses a non-member every route the mod uses", async () => {
    const mods = [
      ["GET", "/v1/me"],
      ["GET", "/v1/me/quests"],
      ["POST", "/v1/me/quests/daily:1/reroll"],
      ["GET", "/v1/me/events"],
      ["GET", "/v1/me/events/stream"],
    ] as const;

    const answers = await Promise.all(
      mods.flatMap(([method, path]) =>
        [{ cookie: "carol-token", origin: ORIGIN }, { bearer: "carol-token" }].map((sent) =>
          outcome(method, path, method === "POST" ? { ...sent, body: { leaf: 0 } } : sent),
        ),
      ),
    );

    expect(answers).toEqual(
      mods.flatMap(([method, path]) => [
        [method, path, 403, "not_a_member"],
        [method, path, 403, "not_a_member"],
      ]),
    );
  });

  it("answers hello to anyone, with where to sign in and whether Leaf may be spent", async () => {
    const response = await send("GET", "/v1/game/hello");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sign_in: "https://api.seqwawa.com/auth/web/start?return_to=",
      leaf_spending: false,
    });
    expect(backend.calls).toEqual([]);
  });

  it("says hello as configured", async () => {
    const configured = testLeaf(clock, fakeBackend().fetcher, {
      gameSignInUrl: "https://staging.seqwawa.com/auth/web/start?return_to=",
      gameLeafSpending: true,
    }).app();

    expect(await (await configured.request("/v1/game/hello")).json()).toEqual({
      sign_in: "https://staging.seqwawa.com/auth/web/start?return_to=",
      leaf_spending: true,
    });
    await configured.dispose();
  });
});

describe("GET /v1/game/me", () => {
  it("shows the member with their rank, Leaf, XP, level, Coins and where their events are up to", async () => {
    await services.post(
      { kind: "earn", playerId: alice, amount: leaf(1300), source: "staff", idempotencyKey: "a" },
      T0,
    );
    await raided(alice, 110);
    await raided(bob, 220);

    const response = await get("/v1/game/me");

    expect(await response.json()).toEqual({
      player: { id: alice, username: "Alice" },
      rank: "CAPTAIN",
      guest: false,
      leaf: 1300,
      xp: 1300,
      level: { number: 2, xp_into_level: 300, xp_for_next_level: 1250 },
      event_cursor: 1,
      coins: 300,
    });
  });

  it("answers a guest with no Leaf, XP or cursor and a new member's level, reading nothing of the ledger, and their Coins", async () => {
    // Carol was a member once: the ledger still holds her Leaf, and her news.
    await paid(carol);
    await raided(carol, 110);
    const asked: string[] = [];
    const watched = testLeaf(
      clock,
      fetcher,
      {},
      {
        mojang: mojang.service,
        ledger: (real) => ({
          ...real,
          account: (player) => Effect.suspend(() => (asked.push(`ledger ${player}`), real.account(player))),
        }),
        events: (real) => ({
          ...real,
          latestIdOf: (player) => Effect.suspend(() => (asked.push(`events ${player}`), real.latestIdOf(player))),
        }),
      },
    );
    const watchedApp = watched.app();

    const guest = await watchedApp.request("/v1/game/me", { headers: { Cookie: "seq_session=carol-token" } });
    const member = await watchedApp.request("/v1/game/me", { headers: { Cookie: "seq_session=alice-token" } });
    const names = await watched.query((sql) => sql`SELECT username FROM player_names ORDER BY username`);
    await watchedApp.dispose();
    await watched.dispose();

    expect(await guest.json()).toEqual({
      player: { id: carol, username: "Carol" },
      rank: null,
      guest: true,
      leaf: 0,
      xp: 0,
      level: { number: 1, xp_into_level: 0, xp_for_next_level: 1000 },
      event_cursor: 0,
      coins: 300,
    });
    expect(await member.json()).toMatchObject({ guest: false });
    // Only the member's answer read the ledger and the news; and only the member's name is kept for the guild's news.
    expect(asked).toEqual([`events ${alice}`, `ledger ${alice}`]);
    expect(names).toEqual([{ username: "Alice" }]);
  });

  it("starts a member with no events at cursor 0", async () => {
    await raided(bob, 220);

    expect(await (await get("/v1/game/me")).json()).toMatchObject({ event_cursor: 0 });
  });

  it("never gives a cursor past what the Leaf beside it holds, though a raid is paid between its two reads", async () => {
    /** Alice's raid, paid as the credit sync pays one: its Leaf and its event in one transaction. */
    const payout = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const ledger = yield* Ledger;
      const events = yield* Events;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* ledger.post(
            { kind: "earn", playerId: alice, amount: leaf(110), source: "raid", idempotencyKey: "raid:2:alice" },
            clock.now,
          );
          yield* events.insert(
            alice,
            {
              type: "leaf_earned",
              data: {
                source: "raid",
                leaf: 110,
                xp: 110,
                detail: "The Nameless Anomaly",
                occurred_at: "2026-11-25T11:58:00.000Z",
              },
            },
            clock.now,
          );
        }),
      );
    }).pipe(Effect.orDie);
    const paying = { landed: false, pay: (): Promise<void> => Promise.resolve() };
    // Whichever of the two reads comes first, the raid is paid, from elsewhere, the moment it has its answer.
    const thenPaid = <A>(read: Effect.Effect<A>): Effect.Effect<A> =>
      Effect.tap(read, () => {
        if (paying.landed) {
          return Effect.void;
        }
        paying.landed = true;
        return Effect.promise(() => paying.pay());
      });
    const raced = testLeaf(
      clock,
      fetcher,
      {},
      {
        mojang: mojang.service,
        ledger: (real) => ({ ...real, account: (player) => thenPaid(real.account(player)) }),
        events: (real) => ({ ...real, latestIdOf: (player) => thenPaid(real.latestIdOf(player)) }),
      },
    );
    paying.pay = () => raced.run(payout);
    const racedApp = raced.app();
    await raced.post(
      { kind: "earn", playerId: alice, amount: leaf(1300), source: "staff", idempotencyKey: "a" },
      clock.now,
    );
    await raced.run(
      Events.use((events) =>
        events.insert(
          alice,
          {
            type: "leaf_earned",
            data: {
              source: "raid",
              leaf: 110,
              xp: 110,
              detail: "The Nameless Anomaly",
              occurred_at: "2026-11-25T11:00:00.000Z",
            },
          },
          clock.now,
        ),
      ),
    );

    const response = await racedApp.request("/v1/game/me", { headers: { Cookie: "seq_session=alice-token" } });
    const body = Schema.decodeUnknownSync(Schema.Struct({ leaf: Schema.Number, event_cursor: Schema.Number }))(
      await response.json(),
    );
    await racedApp.dispose();
    await raced.dispose();

    expect(paying.landed).toBe(true);
    // Event 2 is the raid paid in between, and its 110 Leaf. Up to event 1, the balance is 1300.
    // The cursor may be older than the balance, which only makes the game ask again; never newer.
    expect([
      { event_cursor: 1, leaf: 1300 },
      { event_cursor: 1, leaf: 1410 },
      { event_cursor: 2, leaf: 1410 },
    ]).toContainEqual(body);
  });
});

/** The earlier and refused copies of saves Leaf keeps, oldest first. */
const keptCopies = () =>
  services.query(
    (sql) => sql`SELECT slot, kind, version, data, saved_at AS savedAt FROM save_history ORDER BY kept_at, slot`,
  );

describe("saves", () => {
  it("lists nothing at first, and refuses to read a slot never written", async () => {
    const list = await get("/v1/game/saves");
    const one = await get("/v1/game/saves/town");

    expect(await list.json()).toEqual({ saves: [] });
    expect(one.status).toBe(404);
    expect(await one.json()).toMatchObject({ code: "no_save" });
  });

  it("writes a first save over version 0, and reads it back as it was written", async () => {
    const data = { saved_at: 1_764_072_000_000, keys: { "town.save.v1": '{"v":1}' } };

    const written = await save("town", 0, data);

    expect(written.status).toBe(200);
    expect(await written.json()).toEqual({ version: 1, updated_at: "2026-11-25T12:00:00.000Z" });
    expect(await (await get("/v1/game/saves/town")).json()).toEqual({
      slot: "town",
      version: 1,
      updated_at: "2026-11-25T12:00:00.000Z",
      data,
    });
    expect(await (await get("/v1/game/saves")).json()).toEqual({
      saves: [{ slot: "town", version: 1, updated_at: "2026-11-25T12:00:00.000Z" }],
    });
  });

  it("writes over the version last read, and refuses a stale one with version_conflict, changing nothing", async () => {
    await save("works", 0, { coins: 1 });
    clock.now = T0 + HOUR;
    const second = await save("works", 1, { coins: 2 });
    const stale = await save("works", 1, { coins: 99 });
    const fresh = await save("works", 0, { coins: 99 });

    expect(await second.json()).toEqual({ version: 2, updated_at: "2026-11-25T13:00:00.000Z" });
    expect([stale.status, fresh.status]).toEqual([409, 409]);
    expect(await stale.json()).toMatchObject({ code: "version_conflict" });
    expect(await (await get("/v1/game/saves/works")).json()).toMatchObject({ version: 2, data: { coins: 2 } });
  });

  it("takes no more writes to the battler's slot, whose game Leaf plays now: 410 moved, storing nothing; it can still be read", async () => {
    // What was there before the game moved stays as it was.
    await services.query(
      (sql) => sql`
        INSERT INTO saves (player_id, slot, version, data, updated_at, guest)
        VALUES (${alice}, 'raid', 3, '{"saved_at":1,"keys":{"raid.run.v1":"a run"}}', ${T0 - DAY}, 0)
      `,
    );
    const written = await save("raid", 3, { saved_at: 2, keys: { "raid.run.v1": "a better run" } });
    const first = await save("raid", 0, { saved_at: 2, keys: {} }, { cookie: "bob-token", origin: ORIGIN });

    expect([written.status, first.status]).toEqual([410, 410]);
    expect(await written.json()).toEqual({
      code: "moved",
      message: "This game is kept on Leaf now, and its old save takes no more writes",
    });
    expect(await (await get("/v1/game/saves/raid")).json()).toMatchObject({
      version: 3,
      data: { keys: { "raid.run.v1": "a run" } },
    });
    expect(await services.query((sql) => sql`SELECT player_id FROM saves WHERE player_id = ${bob}`)).toEqual([]);
    expect(await services.query((sql) => sql`SELECT count(*) AS n FROM save_history`)).toEqual([{ n: 0 }]);
  });

  it("refuses a slot that is not one, reading or writing", async () => {
    const read = await get("/v1/game/saves/ledger");
    const write = await save("ledger", 0, {});

    expect([read.status, write.status]).toEqual([400, 400]);
    expect(await read.json()).toMatchObject({ code: "invalid_slot" });
    expect(await write.json()).toMatchObject({ code: "invalid_slot" });
  });

  it("refuses data that is not an object, and a body that is not a save", async () => {
    const answers = await Promise.all(
      [
        { player: alice, version: 0, data: [1, 2] },
        { player: alice, version: 0, data: "text" },
        { player: alice, version: 0, data: null },
        { player: alice, version: 0 },
        { player: alice, version: -1, data: {} },
        { player: alice, version: 1.5, data: {} },
        { version: 0, data: {} },
        { player: 1, version: 0, data: {} },
        "{ not json",
      ].map(async (body) => {
        const response = await send("PUT", "/v1/game/saves/town", { ...alicesPage, body });
        return [response.status, await codeOf(response)];
      }),
    );

    expect(answers).toEqual(Array.from({ length: 9 }, () => [400, "invalid_save"]));
    expect(await services.query((sql) => sql`SELECT COUNT(*) AS n FROM saves`)).toEqual([{ n: 0 }]);
  });

  it("refuses a save over 256 KiB", async () => {
    const over = await save("works", 0, { keys: "a".repeat(MAX_SAVE_BYTES) });
    const within = await save("works", 0, { keys: "a".repeat(MAX_SAVE_BYTES - 20) });

    expect([over.status, within.status]).toEqual([413, 200]);
    expect(await over.json()).toMatchObject({ code: "save_too_large" });
  });

  it("does not read a body more than twice that long at all, whatever it holds", async () => {
    const padded = `{"version":0,"data":{}}${" ".repeat(2 * MAX_SAVE_BYTES)}`;

    const response = await send("PUT", "/v1/game/saves/works", { ...alicesPage, body: padded });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "save_too_large" });
    expect(await services.query((sql) => sql`SELECT COUNT(*) AS n FROM saves`)).toEqual([{ n: 0 }]);
  });

  it("refuses a save from a page that believes it is someone else with not_you, storing nothing", async () => {
    await save("town", 0, { coins: 300 });

    // Alice's page, left open after Bob signed in in another tab: Bob's cookie, Alice's state.
    const alicesOldPage = await save("town", 0, { coins: 300 }, { cookie: "bob-token", origin: ORIGIN }, alice);
    const overAlice = await save("town", 1, { coins: 5 }, alicesPage, bob);
    const nobody = await save("works", 0, { coins: 5 }, { bearer: "alice-token" }, "");

    expect([alicesOldPage.status, overAlice.status, nobody.status]).toEqual([409, 409, 409]);
    expect(await alicesOldPage.json()).toEqual({
      code: "not_you",
      message: "This page is signed in as someone else now. Load it again",
    });
    expect([await codeOf(overAlice), await codeOf(nobody)]).toEqual(["not_you", "not_you"]);
    expect(await (await get("/v1/game/saves", { bearer: "bob-token" })).json()).toEqual({ saves: [] });
    expect(await (await get("/v1/game/saves/town")).json()).toMatchObject({ version: 1, data: { coins: 300 } });
    expect(await services.query((sql) => sql`SELECT COUNT(*) AS n FROM saves`)).toEqual([{ n: 1 }]);
  });

  it("keeps each member's saves their own", async () => {
    await save("town", 0, { mine: "alice" });

    const bobsList = await get("/v1/game/saves", { bearer: "bob-token" });
    const bobsRead = await get("/v1/game/saves/town", { bearer: "bob-token" });
    const bobsWrite = await save("town", 0, { mine: "bob" }, { bearer: "bob-token" });

    expect(await bobsList.json()).toEqual({ saves: [] });
    expect(bobsRead.status).toBe(404);
    expect(await bobsWrite.json()).toMatchObject({ version: 1 });
    expect(await (await get("/v1/game/saves/town")).json()).toMatchObject({ version: 1, data: { mine: "alice" } });
  });

  it("refuses a write to a slot within 2 seconds of the last with slow_down, changing nothing", async () => {
    await save("town", 0, { n: 1 });
    clock.now = T0 + 1;
    const otherSlot = await save("works", 0, { n: 1 });
    clock.now = T0 + 1999;
    const soon = await save("town", 1, { n: 2 });
    const stale = await save("town", 0, { n: 2 });
    clock.now = T0 + 2000;
    const later = await save("town", 1, { n: 3 });

    expect([otherSlot.status, soon.status, stale.status, later.status]).toEqual([200, 429, 409, 200]);
    expect(await soon.json()).toEqual({
      code: "slow_down",
      message: "That slot was saved a moment ago. Send it again in a few seconds",
    });
    // A write over a version that is not the stored one is stale, however soon it comes.
    expect(await codeOf(stale)).toBe("version_conflict");
    expect(await (await get("/v1/game/saves/town")).json()).toMatchObject({ version: 2, data: { n: 3 } });
  });

  it("keeps what each write replaced, at most once a minute a slot, for a week", async () => {
    await save("works", 0, { n: 1 });
    clock.now = T0 + 3000;
    await save("works", 1, { n: 2 });
    clock.now = T0 + 6000;
    await save("works", 2, { n: 3 });
    clock.now = T0 + MINUTE + 5000;
    await save("works", 3, { n: 4 });
    // A slot of its own has its own copies.
    await save("town", 0, { r: 1 });
    clock.now = T0 + MINUTE + 8000;
    await save("town", 1, { r: 2 });

    expect(await keptCopies()).toEqual([
      { slot: "works", kind: "earlier", version: 1, data: '{"n":1}', savedAt: T0 },
      { slot: "works", kind: "earlier", version: 3, data: '{"n":3}', savedAt: T0 + 6000 },
      { slot: "town", kind: "earlier", version: 1, data: '{"r":1}', savedAt: T0 + MINUTE + 5000 },
    ]);

    clock.now = T0 + 8 * DAY;
    await save("works", 4, { n: 5 });
    expect((await keptCopies()).map((k) => [k.slot, k.version])).toEqual([["works", 4]]);
  });

  it("keeps a copy a game sent over an older version, though it was refused", async () => {
    await save("works", 0, { n: 1 });
    clock.now = T0 + HOUR;
    await save("works", 1, { n: 2 });
    // Another device's older yard, sent over the version it last read.
    const stale = await save("works", 1, { n: "the other yard" });

    expect(stale.status).toBe(409);
    expect(
      await services.query(
        (sql) => sql`SELECT kind, version, data FROM save_history WHERE kind = 'refused' ORDER BY kept_at`,
      ),
    ).toEqual([{ kind: "refused", version: 1, data: '{"n":"the other yard"}' }]);
    expect(await (await get("/v1/game/saves/works")).json()).toMatchObject({ version: 2, data: { n: 2 } });
  });

  it("keeps a guest's saves as a member's, and removes guests' left 90 days when anything is saved", async () => {
    const carols = { cookie: "carol-token", origin: ORIGIN };
    await save("town", 0, { mine: "carol" }, carols);
    await save("works", 0, { mine: "carol" }, carols);
    await save("town", 0, { mine: "alice" });
    clock.now = T0 + 60 * DAY;
    // Carol plays the Works again: that save is fresh, her town is not.
    await save("works", 1, { mine: "carol, later" }, carols);
    const readBack = await get("/v1/game/saves/works", carols);
    clock.now = T0 + 90 * DAY;
    await save("town", 0, {}, { bearer: "bob-token" });
    const before = await services.query(
      (sql) => sql`SELECT player_id, slot, guest FROM saves ORDER BY player_id, slot`,
    );
    // Two seconds later, so that Bob's town may be saved again; Carol's town is now past 90 days.
    clock.now = T0 + 90 * DAY + 2000;
    await save("town", 1, {}, { bearer: "bob-token" });
    clock.now = T0 + 150 * DAY + 1;
    const untouched = await services.query((sql) => sql`SELECT player_id, slot FROM saves ORDER BY player_id, slot`);
    await save("works", 0, {}, { bearer: "bob-token" });

    expect(await readBack.json()).toMatchObject({ version: 2, data: { mine: "carol, later" } });
    expect(before).toEqual([
      { player_id: alice, slot: "town", guest: 0 },
      { player_id: bob, slot: "town", guest: 0 },
      { player_id: carol, slot: "town", guest: 1 },
      { player_id: carol, slot: "works", guest: 1 },
    ]);
    // Nothing is removed until something is saved.
    expect(untouched).toEqual([
      { player_id: alice, slot: "town" },
      { player_id: bob, slot: "town" },
      { player_id: carol, slot: "works" },
    ]);
    expect(await services.query((sql) => sql`SELECT player_id, slot FROM saves ORDER BY player_id, slot`)).toEqual([
      { player_id: alice, slot: "town" },
      { player_id: bob, slot: "town" },
      { player_id: bob, slot: "works" },
    ]);
  });
});

/** A skin sheet's status and bytes, or its status and error code. */
async function skin(uuid: string): Promise<[number, Uint8Array | string]> {
  const response = await get(`/v1/game/skins/${uuid}`);
  return [
    response.status,
    response.status === 200 ? new Uint8Array(await response.arrayBuffer()) : await codeOf(response),
  ];
}

async function guild(path = "/v1/game/guild/events"): Promise<unknown> {
  return (await get(path)).json();
}

const BOBS_SKIN = "http://textures.minecraft.net/texture/b0b5";
const BOBS_TEXTURE = "https://textures.minecraft.net/texture/b0b5";
const bobsPng = skinPng({
  skin: [224, 172, 140, 255],
  hair: [92, 58, 33, 255],
  shirt: [52, 110, 70, 255],
  legs: [58, 62, 92, 255],
});
const newPng = skinPng({
  skin: [198, 140, 104, 255],
  hair: [30, 26, 24, 255],
  shirt: [150, 60, 48, 255],
  legs: [70, 52, 40, 255],
});

/** Gives a player a skin at Mojang, at its own address. */
function wears(player: PlayerId, name: string, png: Uint8Array) {
  const texture = `c0de${player.slice(-1)}`;
  mojang.profiles.set(player, { name, skin: `http://textures.minecraft.net/texture/${texture}` });
  mojang.textures.set(`https://textures.minecraft.net/texture/${texture}`, png);
}

/** The players whose skins Leaf keeps. */
const keptSkins = () => services.query((sql) => sql`SELECT player_id FROM skins ORDER BY player_id`);

/** The names Leaf keeps. */
const keptNames = () => services.query((sql) => sql`SELECT username FROM player_names ORDER BY username`);

describe("GET /v1/game/skins/{uuid}", () => {
  beforeEach(async () => {
    mojang.profiles.set(bob, { name: "Bob", skin: BOBS_SKIN });
    mojang.textures.set(BOBS_TEXTURE, bobsPng);
    await paid(bob);
  });

  it("serves a player's skin sheet from Mojang's texture server, fetched over HTTPS, for a day", async () => {
    const response = await get(`/v1/game/skins/${bob}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe(API_POLICY);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bobsPng);
    expect(mojang.calls).toEqual([`profile ${bob}`, `texture ${BOBS_TEXTURE}`]);
  });

  it("serves it from the database within the day without asking Mojang", async () => {
    await skin(bob);
    clock.now = T0 + 23 * HOUR;
    mojang.calls.length = 0;

    expect(await skin(bob)).toEqual([200, bobsPng]);
    expect(mojang.calls).toEqual([]);
  });

  it("asks Mojang again after a day", async () => {
    await skin(bob);
    clock.now = T0 + DAY;
    mojang.textures.set(BOBS_TEXTURE, newPng);

    expect(await skin(bob)).toEqual([200, newPng]);
  });

  it("serves the last skin it had when Mojang can't be reached", async () => {
    await skin(bob);
    clock.now = T0 + 3 * DAY;
    mojang.down = true;

    expect(await skin(bob)).toEqual([200, bobsPng]);
  });

  it("has no skin for a player it never had one for while Mojang can't be reached", async () => {
    mojang.down = true;

    expect(await skin(bob)).toEqual([404, "no_skin"]);
  });

  it("has none for a player in a default skin, or one Mojang does not know", async () => {
    mojang.profiles.set(alice, { name: "Alice", skin: undefined });
    await paid(carol);

    expect(await skin(alice)).toEqual([404, "no_skin"]);
    expect(await skin(carol)).toEqual([404, "no_skin"]);
    expect(mojang.calls).toEqual([`profile ${alice}`, `profile ${carol}`]);
  });

  it("refuses a skin address on any other host, and never fetches it", async () => {
    for (const address of [
      "https://textures.minecraft.net.evil.example/texture/b0b5",
      "https://evil.example/texture/b0b5",
      "https://textures.minecraft.net/other/b0b5",
      "https://textures.minecraft.net/texture/b0b5?x=1",
      "ftp://textures.minecraft.net/texture/b0b5",
    ]) {
      mojang.profiles.set(bob, { name: "Bob", skin: address });
      // oxlint-disable-next-line no-await-in-loop -- each address in turn, on the same database
      expect(await skin(bob)).toEqual([404, "no_skin"]);
      // A failure is remembered for an hour.
      clock.now += HOUR;
    }
    expect(mojang.calls.filter((call) => call.startsWith("texture"))).toEqual([]);
    expect(mojang.calls).toHaveLength(5);
  });

  it("refuses what Mojang serves that is not a PNG", async () => {
    mojang.textures.set(BOBS_TEXTURE, new TextEncoder().encode("<html>"));

    expect(await skin(bob)).toEqual([404, "no_skin"]);
  });

  it("takes only a PNG whose header says 64 by 64, or 64 by 32 as older skins are", async () => {
    const answers = [];
    for (const png of [
      plainPng(128, 128, [1, 2, 3, 255]),
      plainPng(64, 63, [1, 2, 3, 255]),
      plainPng(32, 64, [1, 2, 3, 255]),
      bobsPng.slice(0, 40),
      plainPng(64, 32, [1, 2, 3, 255]),
    ]) {
      mojang.textures.set(BOBS_TEXTURE, png);
      // oxlint-disable-next-line no-await-in-loop -- each picture in turn, an hour apart, on the same database
      answers.push(await skin(bob));
      clock.now += HOUR;
    }

    expect(answers).toEqual([
      [404, "no_skin"],
      [404, "no_skin"],
      [404, "no_skin"],
      [404, "no_skin"],
      [200, plainPng(64, 32, [1, 2, 3, 255])],
    ]);
  });

  it("keeps and serves the picture only, up to the end of its last chunk, not what follows it", async () => {
    const trailing = new TextEncoder().encode("<html><script>alert(1)</script>");
    mojang.textures.set(BOBS_TEXTURE, new Uint8Array([...bobsPng, ...trailing]));

    const served = await skin(bob);
    clock.now = T0 + HOUR;
    const kept = await skin(bob);

    expect(served).toEqual([200, bobsPng]);
    expect(kept).toEqual([200, bobsPng]);
    expect(await services.query((sql) => sql`SELECT length(png) AS n FROM skins`)).toEqual([{ n: bobsPng.length }]);
  });

  it("takes a UUID with or without dashes, in any case, and refuses anything else", async () => {
    expect(await skin(bob.replaceAll("-", "").toUpperCase())).toEqual([200, bobsPng]);
    expect(await skin("not-a-uuid")).toEqual([400, "invalid_uuid"]);
    expect(await skin("10000000-0000-0000-0000-00000000000")).toEqual([400, "invalid_uuid"]);
  });

  it("learns the player's name from Mojang for the guild's news", async () => {
    await skin(bob);

    expect(await services.query((sql) => sql`SELECT player_id, username FROM player_names`)).toEqual([
      { player_id: bob, username: "Bob" },
    ]);
  });

  it("has none for a player Leaf does not know, and does not ask Mojang about them", async () => {
    wears(carol, "Carol", newPng);
    wears(dave, "Dave", newPng);

    expect(await skin(carol)).toEqual([404, "no_skin"]);
    expect(await skin(dave)).toEqual([404, "no_skin"]);
    expect(mojang.calls).toEqual([]);
    expect(await keptSkins()).toEqual([]);
    expect(await services.query((sql) => sql`SELECT COUNT(*) AS n FROM player_names`)).toEqual([{ n: 0 }]);
  });

  it("serves the asker's own skin, and that of anyone whose game said where they were in the last day", async () => {
    backend.sessions["dave-token"] = () => Response.json(sessionOf(dave, "Dave", "RECRUIT"));
    wears(alice, "Alice", newPng);
    wears(dave, "Dave", newPng);
    await arrive("works", { bearer: "dave-token" });

    const own = await skin(alice);
    const present = await skin(dave);
    clock.now = T0 + DAY + MINUTE;
    const gone = await skin(dave);

    expect([own, present, gone]).toEqual([
      [200, newPng],
      [200, newPng],
      [404, "no_skin"],
    ]);
  });

  it("remembers for an hour that Mojang had no skin for a player, or could not be asked", async () => {
    await paid(carol);
    mojang.down = true;
    await skin(bob);
    await skin(carol);
    mojang.down = false;
    mojang.calls.length = 0;
    clock.now = T0 + HOUR - 1;
    const withinTheHour = [await skin(bob), await skin(carol)];
    clock.now = T0 + HOUR;
    const afterIt = [await skin(bob), await skin(carol)];
    clock.now = T0 + HOUR + 1;
    await skin(carol);

    expect(withinTheHour).toEqual([
      [404, "no_skin"],
      [404, "no_skin"],
    ]);
    expect(afterIt).toEqual([
      [200, bobsPng],
      [404, "no_skin"],
    ]);
    expect(mojang.calls).toEqual([`profile ${bob}`, `texture ${BOBS_TEXTURE}`, `profile ${carol}`]);
  });

  it("asks Mojang once for requests about one player that arrive together", async () => {
    mojang.latencyMs = 20;

    const answers = await Promise.all([skin(bob), skin(bob), skin(bob)]);

    expect(answers).toEqual([
      [200, bobsPng],
      [200, bobsPng],
      [200, bobsPng],
    ]);
    expect(mojang.calls).toEqual([`profile ${bob}`, `texture ${BOBS_TEXTURE}`]);
  });

  it("removes the skins nobody asked for in 30 days when it keeps a new one", async () => {
    wears(alice, "Alice", newPng);
    await paid(carol);
    wears(carol, "Carol", newPng);
    await skin(bob);
    clock.now = T0 + 20 * DAY;
    await skin(alice);
    clock.now = T0 + 30 * DAY;
    const before = await keptSkins();
    clock.now = T0 + 31 * DAY;
    await skin(carol);

    expect(before).toEqual([{ player_id: alice }, { player_id: bob }]);
    expect(await keptSkins()).toEqual([{ player_id: alice }, { player_id: carol }]);
  });
});

describe("GET /v1/game/guild/events", () => {
  beforeEach(async () => {
    mojang.profiles.set(bob, { name: "Bob", skin: undefined });
    await paid(bob);
  });

  it("shows other members' raids and wars without what they paid", async () => {
    await raided(bob, 110);
    await happened(bob, {
      type: "leaf_earned",
      data: {
        source: "war",
        leaf: 73,
        xp: 73,
        detail: "Detlas",
        occurred_at: "2026-11-25T11:59:00.000Z",
        in_claim: true,
      },
    });

    expect(await guild()).toEqual({
      events: [
        {
          id: 1,
          type: "leaf_earned",
          created_at: "2026-11-25T12:00:00.000Z",
          player: { id: bob, username: "Bob" },
          data: { source: "raid", detail: "The Nameless Anomaly", occurred_at: "2026-11-25T11:58:00.000Z" },
        },
        {
          id: 2,
          type: "leaf_earned",
          created_at: "2026-11-25T12:00:00.000Z",
          player: { id: bob, username: "Bob" },
          data: { source: "war", detail: "Detlas", occurred_at: "2026-11-25T11:59:00.000Z", in_claim: true },
        },
      ],
    });
  });

  it("shows levels and milestones by what they are, and nothing else of a member's", async () => {
    await happened(bob, { type: "level_up", data: { level: 7, leaf: 250 } });
    await happened(bob, {
      type: "achievement_paid",
      data: {
        award_id: "a",
        ladder: "raid:TNA",
        milestone: "gold",
        tier: "gold",
        threshold: 100,
        label: "Gold",
        leaf: 2500,
        xp: 0,
        earned_at: "2026-11-25T11:00:00.000Z",
      },
    });
    await happened(bob, { type: "quest_completed", data: { quest: questLike } });
    await happened(bob, { type: "quest_rerolled", data: { replaced: questLike, quest: questLike, leaf: 100 } });

    expect(await guild()).toEqual({
      events: [
        expect.objectContaining({ type: "level_up", data: { level: 7 } }),
        expect.objectContaining({ type: "achievement_paid", data: { label: "Gold", tier: "gold" } }),
      ],
    });
  });

  it("names the member, from their own sign-in or from Mojang, and leaves out one no one can name yet", async () => {
    await paid(carol);
    await raided(alice, 110);
    await raided(bob, 220);
    await raided(carol, 330);
    await get("/v1/game/me");

    expect(await guild()).toEqual({
      events: [
        expect.objectContaining({ id: 1, player: { id: alice, username: "Alice" } }),
        expect.objectContaining({ id: 2, player: { id: bob, username: "Bob" } }),
      ],
    });
    expect(mojang.calls).toEqual([`profile ${bob}`, `profile ${carol}`]);
  });

  it("asks Mojang only about players Leaf knows, and leaves out the rest", async () => {
    mojang.profiles.set(dave, { name: "Dave", skin: undefined });
    await raided(dave, 110);

    expect(await guild()).toEqual({ events: [] });
    expect(mojang.calls).toEqual([]);
  });

  it("removes the names nobody asked for in 30 days when it learns a new one", async () => {
    const erin = playerId("10000000-0000-0000-0000-00000000000e");
    backend.sessions["dave-token"] = () => Response.json(sessionOf(dave, "Dave", "RECRUIT"));
    backend.sessions["erin-token"] = () => Response.json(sessionOf(erin, "Erin", "RECRUIT"));
    await get("/v1/game/me", { bearer: "bob-token" });
    await get("/v1/game/me", { bearer: "erin-token" });
    await happened(erin, { type: "level_up", data: { level: 3, leaf: 30 } });
    clock.now = T0 + 20 * DAY;
    // Erin's level is in the guild's news, which asks for her name.
    await guild();
    clock.now = T0 + 31 * DAY;
    const before = await keptNames();
    await get("/v1/game/me", { bearer: "dave-token" });

    expect(before).toEqual([{ username: "Bob" }, { username: "Erin" }]);
    expect(await keptNames()).toEqual([{ username: "Dave" }, { username: "Erin" }]);
  });

  it("asks Mojang for a name once, and leaves the event out while Mojang can't be reached", async () => {
    await raided(bob, 110);
    mojang.down = true;
    const whileDown = await guild();
    mojang.down = false;
    clock.now = T0 + HOUR;
    await guild();
    await guild();

    expect(whileDown).toEqual({ events: [] });
    expect(mojang.calls).toEqual([`profile ${bob}`, `profile ${bob}`]);
  });

  it("lists the newest 50 without a position, and up to 200 after one, oldest first", async () => {
    for (let n = 1; n <= 260; n++) {
      // oxlint-disable-next-line no-await-in-loop -- in order, so ids follow n
      await raided(bob, n);
    }

    const latest = eventIds(await guild());
    const after = eventIds(await guild("/v1/game/guild/events?after=10"));
    const end = eventIds(await guild("/v1/game/guild/events?after=250"));

    expect(latest).toEqual(Array.from({ length: 50 }, (_, index) => 211 + index));
    expect(after).toEqual(Array.from({ length: 200 }, (_, index) => 11 + index));
    expect(end).toEqual(Array.from({ length: 10 }, (_, index) => 251 + index));
  });

  it("refuses an after that is not an event id", async () => {
    const response = await get("/v1/game/guild/events?after=soon");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_after" });
  });
});

describe("GET /v1/game/guild/events/stream", () => {
  beforeEach(async () => {
    mojang.profiles.set(bob, { name: "Bob", skin: undefined });
    await paid(bob);
  });

  it("sends the guild's events as they happen, cut down, and nothing from before", async () => {
    await raided(bob, 110);
    const response = await get("/v1/game/guild/events/stream");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    await happened(bob, { type: "quest_rerolled", data: { replaced: questLike, quest: questLike, leaf: 100 } });
    await raided(bob, 440, "Nest of the Grootslangs");
    const text = await readUntil(response, "Nest of the Grootslangs");

    expect(text.startsWith("id: 1\nretry: 3000\n\n")).toBe(true);
    expect(text).toContain(
      'event: leaf_earned\ndata: {"id":3,"type":"leaf_earned","created_at":"2026-11-25T12:00:00.000Z","player":{"id":"10000000-0000-0000-0000-000000000002","username":"Bob"},"data":{"source":"raid","detail":"Nest of the Grootslangs","occurred_at":"2026-11-25T11:58:00.000Z"}}\nid: 3\n\n',
    );
    expect(text).not.toContain("The Nameless Anomaly");
    expect(text).not.toContain("quest_rerolled");
    expect(text).not.toContain("440");
  });

  it("sends what a reconnecting client missed, from Last-Event-ID or after", async () => {
    await raided(bob, 1, "First");
    await raided(bob, 2, "Second");
    await raided(bob, 3, "Third");

    const resumed = await readUntil(
      await get("/v1/game/guild/events/stream", { cookie: "alice-token", headers: { "Last-Event-ID": "1" } }),
      "Second",
      "Third",
    );
    const after = await readUntil(await get("/v1/game/guild/events/stream?after=2"), "Third");

    expect(resumed).not.toContain("First");
    expect(after).not.toContain("Second");
  });

  it("keeps a quiet connection alive, then closes it so the client reconnects", async () => {
    const text = await (await get("/v1/game/guild/events/stream")).text();

    expect(text.startsWith("id: 0\nretry: 3000\n\n")).toBe(true);
    expect(text).toContain(": keep-alive\n\n");
  });

  it("sends each of several streams what happened from where it started, once", async () => {
    await raided(bob, 1, "First");
    const fromStart = await get("/v1/game/guild/events/stream?after=0", { bearer: "alice-token" });
    const fromNow = await get("/v1/game/guild/events/stream", { bearer: "bob-token" });
    await raided(bob, 2, "Second");

    const [early, late] = await Promise.all([readUntil(fromStart, "Second"), readUntil(fromNow, "Second")]);

    expect(early.indexOf("First")).toBeLessThan(early.indexOf("Second"));
    expect(early.match(/event: leaf_earned/g)).toHaveLength(2);
    expect(late).not.toContain("First");
    expect(late.match(/event: leaf_earned/g)).toHaveLength(1);
  });

  it("refuses a Last-Event-ID that is not an event id", async () => {
    const response = await get("/v1/game/guild/events/stream", {
      cookie: "alice-token",
      headers: { "Last-Event-ID": "abc" },
    });

    expect(response.status).toBe(400);
  });
});

/** What these tests read a stream with. */
interface Reader {
  read(): Promise<{ readonly done: boolean }>;
  cancel(): Promise<void>;
}

/** A stream's reader once its first frame, which comes when it opens, has arrived. */
async function opened(response: Response): Promise<Reader> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error("The response has no body");
  }
  await reader.read();
  return reader;
}

/** Reads a stream to its end. */
async function untilEnd(reader: Reader): Promise<"ended"> {
  return (await reader.read()).done ? "ended" : untilEnd(reader);
}

/** Whether a stream ends within `ms` milliseconds. */
function endsWithin(reader: Reader, ms: number): Promise<"ended" | "open"> {
  return Promise.race([untilEnd(reader), Bun.sleep(ms).then(() => "open" as const)]);
}

describe("open streams", () => {
  it("lets a member keep six open, their own and the guild's together, closing their oldest when a seventh opens", async () => {
    // Streams that stay open for a minute unless closed.
    const own = testLeaf(clock, fetcher, {}, { mojang: mojang.service });
    const long = own.app(Layer.succeed(StreamTuning)({ pollMs: 5, heartbeatMs: 20, maxMs: 60_000 }));
    const open = async (path: string, token: string) =>
      opened(await long.request(path, { headers: { Authorization: `Bearer ${token}` } }));
    const first = await open("/v1/me/events/stream", "alice-token");
    const kept = [
      await open("/v1/game/guild/events/stream", "alice-token"),
      await open("/v1/me/events/stream", "alice-token"),
      await open("/v1/game/guild/events/stream", "alice-token"),
      await open("/v1/me/events/stream", "alice-token"),
      await open("/v1/game/guild/events/stream", "alice-token"),
    ];
    const bobs = await open("/v1/game/guild/events/stream", "bob-token");
    const seventh = await open("/v1/me/events/stream", "alice-token");

    expect(await endsWithin(first, 1_000)).toBe("ended");
    const rest = [...kept, seventh, bobs];
    expect(await Promise.all(rest.map((reader) => endsWithin(reader, 100)))).toEqual(rest.map(() => "open"));
    await Promise.all(rest.map((reader) => reader.cancel()));
    await long.dispose();
  });
});

/** A JSON body padded with a field Leaf ignores to exactly `bytes` long. */
function paddedTo(body: object, bytes: number): string {
  const text = JSON.stringify(body);
  return `${text.slice(0, -1)},"pad":"${"x".repeat(bytes - text.length - 9)}"}`;
}

/** Writes presence rows straight into the table, as games seen earlier would have left them. */
function seen(rows: readonly Record<string, string | number>[]) {
  const [first, ...rest] = rows;
  if (!first) return Promise.resolve();
  return services.query((sql) => sql`INSERT INTO presence ${sql.insert([first, ...rest])}`);
}

function arrive(place: string, sent: Sent = alicesPage, stay?: unknown) {
  return send("PUT", "/v1/game/presence", { ...sent, body: stay === undefined ? { place } : { place, stay } });
}

const iso = (at: number) => new Date(at).toISOString();
const presenceRows = () => services.query((sql) => sql`SELECT place, seen_at, stay FROM presence`);

describe("GET /v1/game/presence", () => {
  it("lists who is about as the call that says where one is does, and writes nothing", async () => {
    await arrive("works", { bearer: "bob-token" });
    clock.now = T0 + 30_000;
    await arrive("town");
    const before = await services.query((sql) => sql`SELECT * FROM presence ORDER BY player_id`);
    const visits = await services.query((sql) => sql`SELECT * FROM visits ORDER BY id`);
    clock.now = T0 + 60_000;

    const looked = await send("GET", "/v1/game/presence", alicesPage);

    expect(looked.status).toBe(200);
    expect(await looked.json()).toEqual({
      present: [
        { id: alice, username: "Alice", place: "town", guest: false },
        { id: bob, username: "Bob", place: "works", guest: false },
      ],
      resting: [],
    });
    expect(await services.query((sql) => sql`SELECT * FROM presence ORDER BY player_id`)).toEqual(before);
    expect(await services.query((sql) => sql`SELECT * FROM visits ORDER BY id`)).toEqual(visits);
  });
});

describe("PUT /v1/game/presence", () => {
  it("lists the caller and everyone else seen in the last 90 seconds, and nobody older", async () => {
    await arrive("works", { bearer: "bob-token" });
    clock.now = T0 + 60_000;
    const first = await arrive("town");
    clock.now = T0 + 91_000;
    const later = await arrive("camp");

    expect(await first.json()).toEqual({
      present: [
        { id: alice, username: "Alice", place: "town", guest: false },
        { id: bob, username: "Bob", place: "works", guest: false },
      ],
      resting: [],
    });
    expect(await later.json()).toEqual({
      present: [{ id: alice, username: "Alice", place: "camp", guest: false }],
      resting: [{ id: bob, username: "Bob", place: "works", guest: false, seen_at: iso(T0) }],
    });
  });

  it("lists as resting those seen between 90 seconds and a day ago who stay, newest first, at most 24", async () => {
    const now = T0 + DAY;
    // Thirty members seen over the last day and a bit: every third would rather not stay.
    const rows = Array.from({ length: 30 }, (_, n) => ({
      playerId: `20000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
      username: `Member${n}`,
      place: n % 2 === 0 ? "town" : "table",
      seenAt: now - 60_000 - n * 50 * MINUTE,
      stay: n % 3 === 2 ? 0 : 1,
    }));
    await seen(rows);
    clock.now = now;
    const body: unknown = await (await arrive("town")).json();

    const kept = rows
      .filter((r) => r.stay === 1 && r.seenAt <= now - 90_000 && r.seenAt >= now - DAY)
      .toSorted((a, b) => b.seenAt - a.seenAt);
    expect(kept.length).toBeGreaterThan(0);
    expect(body).toEqual({
      present: [
        { id: alice, username: "Alice", place: "town", guest: false },
        { id: rows[0]?.playerId, username: "Member0", place: "town", guest: false },
      ],
      resting: kept
        .slice(0, 24)
        .map((r) => ({ id: r.playerId, username: r.username, place: r.place, guest: false, seen_at: iso(r.seenAt) })),
    });
  });

  it("never lists more than 24 resting", async () => {
    const rows = Array.from({ length: 40 }, (_, n) => ({
      playerId: `30000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
      username: `Sleeper${n}`,
      place: "town",
      seenAt: T0 - 5 * MINUTE - n * MINUTE,
      stay: 1,
    }));
    await seen(rows);
    const body: unknown = await (await arrive("works")).json();

    const resting = typeof body === "object" && body !== null && "resting" in body ? body.resting : null;
    expect(Array.isArray(resting) ? resting.map((r: { username: string }) => r.username) : null).toEqual(
      rows.slice(0, 24).map((r) => r.username),
    );
  });

  it("keeps a member who says stay false out of the resting, until they say otherwise", async () => {
    await arrive("works", { bearer: "bob-token" }, false);
    clock.now = T0 + 5 * MINUTE;
    const without = await arrive("town");
    clock.now = T0 + 6 * MINUTE;
    await arrive("table", { bearer: "bob-token" });
    clock.now = T0 + 9 * MINUTE;
    const back = await arrive("town");

    expect(await without.json()).toEqual({
      present: [{ id: alice, username: "Alice", place: "town", guest: false }],
      resting: [],
    });
    expect(await back.json()).toEqual({
      present: [{ id: alice, username: "Alice", place: "town", guest: false }],
      resting: [{ id: bob, username: "Bob", place: "table", guest: false, seen_at: iso(T0 + 6 * MINUTE) }],
    });
    expect(await services.query((sql) => sql`SELECT stay FROM presence ORDER BY player_id`)).toEqual([
      { stay: 1 },
      { stay: 1 },
    ]);
  });

  it("lists guests beside members, each marked, here and resting", async () => {
    await arrive("table", { bearer: "carol-token" });
    clock.now = T0 + 2 * MINUTE;
    await arrive("works", { bearer: "bob-token" });
    const withGuest = await arrive("town");
    clock.now = T0 + 4 * MINUTE;
    const guestGone = await arrive("camp");

    expect(await withGuest.json()).toEqual({
      present: [
        { id: alice, username: "Alice", place: "town", guest: false },
        { id: bob, username: "Bob", place: "works", guest: false },
      ],
      resting: [{ id: carol, username: "Carol", place: "table", guest: true, seen_at: iso(T0) }],
    });
    expect(await guestGone.json()).toMatchObject({
      resting: [
        { id: bob, guest: false },
        { id: carol, guest: true },
      ],
    });
  });

  it("lists at most the 50 seen most recently as here, in name order", async () => {
    // Sixty seen in the last minute, one a second; Alice makes sixty-one.
    const rows = Array.from({ length: 60 }, (_, n) => ({
      playerId: `40000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
      username: `Here${String(n).padStart(2, "0")}`,
      place: "town",
      seenAt: T0 - 1000 - n * 1000,
      stay: 1,
      guest: n % 2,
    }));
    await seen(rows);
    const body: unknown = await (await arrive("town")).json();

    const present = typeof body === "object" && body !== null && "present" in body ? body.present : null;
    expect(Array.isArray(present) ? present.map((p: { username: string }) => p.username) : null).toEqual(
      ["Alice", ...rows.slice(0, 49).map((r) => r.username)].toSorted(),
    );
  });

  it("answers a game saying the same again within 5 seconds, without writing it down", async () => {
    await arrive("town");
    clock.now = T0 + 4999;
    const soon = await arrive("town");
    const kept = await presenceRows();
    clock.now = T0 + 5000;
    await arrive("town");

    expect(soon.status).toBe(200);
    expect(await soon.json()).toEqual({
      present: [{ id: alice, username: "Alice", place: "town", guest: false }],
      resting: [],
    });
    expect(kept).toEqual([{ place: "town", seen_at: T0, stay: 1 }]);
    expect(await presenceRows()).toEqual([{ place: "town", seen_at: T0 + 5000, stay: 1 }]);
  });

  it("writes at once a game saying it is somewhere else, or other about staying, however soon", async () => {
    await arrive("town");
    clock.now = T0 + 1000;
    const moved = await arrive("works");
    const there = await presenceRows();
    clock.now = T0 + 2000;
    await arrive("works", alicesPage, false);

    expect(await moved.json()).toMatchObject({ present: [{ id: alice, place: "works" }] });
    expect(there).toEqual([{ place: "works", seen_at: T0 + 1000, stay: 1 }]);
    expect(await presenceRows()).toEqual([{ place: "works", seen_at: T0 + 2000, stay: 0 }]);
  });

  it("refuses a stay that is not true or false", async () => {
    const response = await arrive("town", alicesPage, "yes");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_place" });
  });

  it("forgets anyone not seen for a day", async () => {
    await arrive("works", { bearer: "bob-token" });
    clock.now = T0 + DAY + 1;
    await arrive("table");

    expect(await services.query((sql) => sql`SELECT player_id FROM presence`)).toEqual([{ player_id: alice }]);
  });

  it("refuses a place that is not one", async () => {
    const response = await arrive("ledger");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_place" });
  });

  it("does not read a body over 16 KiB, here or on any route but saves", async () => {
    const over = paddedTo({ place: "town" }, 17 * 1024);
    const within = paddedTo({ place: "town" }, 16 * 1024);

    const presence = await send("PUT", "/v1/game/presence", { ...alicesPage, body: over });
    const reroll = await send("POST", "/v1/me/quests/daily:1/reroll", {
      ...alicesPage,
      body: paddedTo({ leaf: 0 }, 17 * 1024),
    });
    const fits = await send("PUT", "/v1/game/presence", { ...alicesPage, body: within });

    expect([over.length, within.length]).toEqual([17 * 1024, 16 * 1024]);
    expect([presence.status, reroll.status, fits.status]).toEqual([413, 413, 200]);
    expect(await presence.json()).toEqual({ code: "body_too_large", message: "Leaf reads a body of at most 16 KiB" });
    expect(await codeOf(reroll)).toBe("body_too_large");
    expect(await services.query((sql) => sql`SELECT COUNT(*) AS n FROM quest_rerolls`)).toEqual([{ n: 0 }]);
  });
});
