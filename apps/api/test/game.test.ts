import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { leaf, MAX_SAVE_BYTES, type PlayerId, playerId } from "@sequoia-leaf/core";
import { Layer, Schema } from "effect";

import { Events, type PlayerEvent } from "../src/events/store.ts";
import { API_POLICY } from "../src/http/headers.ts";
import { StreamTuning } from "../src/http/streams.ts";
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

  it("refuses a cookie the backend does not accept, a non-member's, and says so when the backend is down", async () => {
    const stale = await get("/v1/game/me", { cookie: "stale-token" });
    const visitor = await get("/v1/game/me", { cookie: "carol-token" });
    backend.sessions["alice-token"] = () => new Response("down", { status: 502 });
    const down = await get("/v1/game/me", { cookie: "alice-token" });

    expect([stale.status, visitor.status, down.status]).toEqual([401, 403, 503]);
    expect(await visitor.json()).toMatchObject({ code: "not_a_member" });
    expect(await down.json()).toMatchObject({ code: "identity_unavailable" });
  });

  it("with both, goes by a Bearer the backend accepts, and by the cookie otherwise", async () => {
    const bearerWins = await get("/v1/game/me", { cookie: "alice-token", bearer: "bob-token" });
    const staleBearer = await get("/v1/game/me", { cookie: "alice-token", bearer: "stale-token" });
    const visitorsBearer = await get("/v1/game/me", { cookie: "alice-token", bearer: "carol-token" });
    const bothRefused = await get("/v1/game/me", { cookie: "carol-token", bearer: "stale-token" });

    expect(await bearerWins.json()).toMatchObject({ player: { id: bob } });
    expect(await staleBearer.json()).toMatchObject({ player: { id: alice } });
    expect(await visitorsBearer.json()).toMatchObject({ player: { id: alice } });
    // When neither lets the request in, the cookie's refusal is the answer.
    expect(bothRefused.status).toBe(403);
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
    const bothNoOrigin = await save("raid", 0, { saved_at: 1 }, { bearer: "alice-token", cookie: "alice-token" });

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
  ] as const;

  it("refuses everyone signed out, and everyone who is not a member, on every route but hello", async () => {
    const answers = await Promise.all(
      routes.flatMap(([method, path]) =>
        [{}, { cookie: "carol-token", origin: ORIGIN }, { bearer: "carol-token" }].map(async (sent) => {
          const response = await send(method, path, sent);
          return [method, path, response.status, await codeOf(response)];
        }),
      ),
    );

    expect(answers).toEqual(
      routes.flatMap(([method, path]) => [
        [method, path, 401, "unauthorized"],
        [method, path, 403, "not_a_member"],
        [method, path, 403, "not_a_member"],
      ]),
    );
    expect(mojang.calls).toEqual([]);
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
  it("shows the member with their rank, Leaf, XP, level and where their events are up to", async () => {
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
      leaf: 1300,
      xp: 1300,
      level: { number: 2, xp_into_level: 300, xp_for_next_level: 1250 },
      event_cursor: 1,
    });
  });

  it("starts a member with no events at cursor 0", async () => {
    await raided(bob, 220);

    expect(await (await get("/v1/game/me")).json()).toMatchObject({ event_cursor: 0 });
  });
});

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
    await save("purse", 0, { coins: 1 });
    clock.now = T0 + HOUR;
    const second = await save("purse", 1, { coins: 2 });
    const stale = await save("purse", 1, { coins: 99 });
    const fresh = await save("purse", 0, { coins: 99 });

    expect(await second.json()).toEqual({ version: 2, updated_at: "2026-11-25T13:00:00.000Z" });
    expect([stale.status, fresh.status]).toEqual([409, 409]);
    expect(await stale.json()).toMatchObject({ code: "version_conflict" });
    expect(await (await get("/v1/game/saves/purse")).json()).toMatchObject({ version: 2, data: { coins: 2 } });
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
    await save("purse", 0, { coins: 300 });

    // Alice's page, left open after Bob signed in in another tab: Bob's cookie, Alice's state.
    const alicesOldPage = await save("purse", 0, { coins: 300 }, { cookie: "bob-token", origin: ORIGIN }, alice);
    const overAlice = await save("purse", 1, { coins: 5 }, alicesPage, bob);
    const nobody = await save("works", 0, { coins: 5 }, { bearer: "alice-token" }, "");

    expect([alicesOldPage.status, overAlice.status, nobody.status]).toEqual([409, 409, 409]);
    expect(await alicesOldPage.json()).toEqual({
      code: "not_you",
      message: "This page is signed in as someone else now. Load it again",
    });
    expect([await codeOf(overAlice), await codeOf(nobody)]).toEqual(["not_you", "not_you"]);
    expect(await (await get("/v1/game/saves", { bearer: "bob-token" })).json()).toEqual({ saves: [] });
    expect(await (await get("/v1/game/saves/purse")).json()).toMatchObject({ version: 1, data: { coins: 300 } });
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

function arrive(place: string, sent: Sent = alicesPage) {
  return send("PUT", "/v1/game/presence", { ...sent, body: { place } });
}

describe("PUT /v1/game/presence", () => {
  it("lists the caller and everyone else seen in the last 90 seconds, and nobody older", async () => {
    await arrive("works", { bearer: "bob-token" });
    clock.now = T0 + 60_000;
    const first = await arrive("town");
    clock.now = T0 + 91_000;
    const later = await arrive("camp");

    expect(await first.json()).toEqual({
      present: [
        { id: alice, username: "Alice", place: "town" },
        { id: bob, username: "Bob", place: "works" },
      ],
    });
    expect(await later.json()).toEqual({ present: [{ id: alice, username: "Alice", place: "camp" }] });
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
