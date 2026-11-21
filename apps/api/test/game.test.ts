import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { leaf, MAX_SAVE_BYTES, type PlayerId, playerId } from "@sequoia-leaf/core";
import { Layer, Schema } from "effect";

import { Events, type PlayerEvent } from "../src/events/store.ts";
import { StreamTuning } from "../src/http/handlers.ts";
import type { questJson } from "../src/quests/json.ts";
import { type Backend, DAY, fakeBackend, type FakeMojang, fakeMojang, HOUR, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
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

function save(slot: string, version: number, data: unknown, sent: Sent = alicesPage) {
  return send("PUT", `/v1/game/saves/${slot}`, { ...sent, body: { version, data } });
}

function happened(player: PlayerId, event: PlayerEvent): Promise<void> {
  return services.run(Events.use((events) => events.insert(player, event, clock.now)));
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
        { version: 0, data: [1, 2] },
        { version: 0, data: "text" },
        { version: 0, data: null },
        { version: 0 },
        { version: -1, data: {} },
        { version: 1.5, data: {} },
        "{ not json",
      ].map(async (body) => {
        const response = await send("PUT", "/v1/game/saves/town", { ...alicesPage, body });
        return [response.status, await codeOf(response)];
      }),
    );

    expect(answers).toEqual(Array.from({ length: 7 }, () => [400, "invalid_save"]));
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
const bobsPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const newPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);

describe("GET /v1/game/skins/{uuid}", () => {
  beforeEach(() => {
    mojang.profiles.set(bob, { name: "Bob", skin: BOBS_SKIN });
    mojang.textures.set("https://textures.minecraft.net/texture/b0b5", bobsPng);
  });

  it("serves a player's skin sheet from Mojang's texture server, fetched over HTTPS, for a day", async () => {
    const response = await get(`/v1/game/skins/${bob}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bobsPng);
    expect(mojang.calls).toEqual([`profile ${bob}`, "texture https://textures.minecraft.net/texture/b0b5"]);
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
    mojang.textures.set("https://textures.minecraft.net/texture/b0b5", newPng);

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

    expect(await skin(alice)).toEqual([404, "no_skin"]);
    expect(await skin(carol)).toEqual([404, "no_skin"]);
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
    }
    expect(mojang.calls.filter((call) => call.startsWith("texture"))).toEqual([]);
  });

  it("refuses what Mojang serves that is not a PNG", async () => {
    mojang.textures.set("https://textures.minecraft.net/texture/b0b5", new TextEncoder().encode("<html>"));

    expect(await skin(bob)).toEqual([404, "no_skin"]);
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
});

describe("GET /v1/game/guild/events", () => {
  beforeEach(() => {
    mojang.profiles.set(bob, { name: "Bob", skin: undefined });
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
  beforeEach(() => {
    mojang.profiles.set(bob, { name: "Bob", skin: undefined });
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

  it("refuses a Last-Event-ID that is not an event id", async () => {
    const response = await get("/v1/game/guild/events/stream", {
      cookie: "alice-token",
      headers: { "Last-Event-ID": "abc" },
    });

    expect(response.status).toBe(400);
  });
});

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
});
