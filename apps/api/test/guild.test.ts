import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  type Activity,
  type ConePull,
  DEFAULT_RULES,
  leaf,
  openCone,
  type PlayerId,
  playerId,
  ROLL_RANGE,
} from "@sequoia-leaf/core";
import { Effect, Layer, Schema } from "effect";

import * as Body from "../src/api/schemas.ts";
import { syncCredits } from "../src/earning/sync.ts";
import { GuildEvents } from "../src/guild/store.ts";
import { StreamTuning } from "../src/http/handlers.ts";
import { digestListings } from "../src/market/digest.ts";
import { feed, HOUR, MINUTE, raid, rolling, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const carol = playerId("10000000-0000-0000-0000-000000000003");
const dave = playerId("10000000-0000-0000-0000-000000000004");
/** Wednesday 25 November 2026, 12:00 UTC: the week of Monday the 23rd, with the first banner on. */
const T0 = Date.UTC(2026, 10, 25, 12);

const members: Readonly<Record<string, { id: PlayerId; name: string }>> = {
  "alice-token": { id: alice, name: "Alice" },
  "bob-token": { id: bob, name: "Bob" },
};

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

function backend(url: string, init: RequestInit): Promise<Response> {
  const token = new Request(url, init).headers.get("Authorization")?.slice("Bearer ".length) ?? "";
  const known = members[token];
  return Promise.resolve(
    known === undefined
      ? Response.json({ error: "unauthorized" }, { status: 401 })
      : Response.json({ minecraft_uuid: known.id, minecraft_username: known.name, guild_rank: "MEMBER" }),
  );
}

/** Opens the app, with the server's rolls loaded when a test needs to know what its cones hold. */
function openApp(rolls?: readonly number[]) {
  app = services.app(
    Layer.mergeAll(
      rolls === undefined ? Layer.empty : rolling(rolls),
      // A stream that looks for events every 5 ms, keeps quiet connections alive every 20 ms and closes after 300 ms.
      Layer.succeed(StreamTuning)({ pollMs: 5, heartbeatMs: 20, maxMs: 300 }),
    ),
  );
}

async function send(method: string, path: string, body?: unknown, token: string | null = "alice-token") {
  const answered = await app.request(path, {
    method,
    headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return answered;
}

const decodeEvents = Schema.decodeUnknownSync(Body.Events);

/** The guild feed as anyone reads it, without a session. */
async function guildFeed(query = "") {
  const answered = await send("GET", `/v1/guild/events${query}`, undefined, null);
  expect(answered.status).toBe(200);
  return decodeEvents(await answered.json()).events;
}

function give(player: PlayerId, amount: number) {
  return services.post(
    { kind: "earn", playerId: player, amount: leaf(amount), source: "staff", idempotencyKey: `grant:${player}` },
    T0,
  );
}

function war(id: number, player: PlayerId, occurredAt: number): Activity {
  return {
    kind: "war",
    sourceKey: `war:${id}:${player}`,
    eventKey: `war:${id}`,
    playerId: player,
    occurredAt,
    seasonRating: 60,
    territory: "Detlas",
    warPoints: 30,
    inClaim: true,
  };
}

/** Starts the credit feed at the start of the week, then reads what it reports up to `at`. */
async function sync(activities: readonly Activity[], at = T0 + HOUR) {
  await services.run(syncCredits(feed(activities), DEFAULT_RULES, Date.UTC(2026, 10, 23), "recent"));
  await services.run(syncCredits(feed(activities), DEFAULT_RULES, at, "recent"));
}

/** The first roll from 0 up whose cone, as a member's first, matches. */
function rollWhere(matches: (pull: ConePull) => boolean): number {
  const banner = DEFAULT_RULES.grove.banners[0];
  if (banner === undefined) {
    throw new Error("The rules have no banner");
  }
  for (let roll = 0; roll < ROLL_RANGE; roll += 1) {
    if (matches(openCone(0, roll, () => 0, banner, DEFAULT_RULES.grove))) {
      return roll;
    }
  }
  throw new Error("No roll opens such a cone");
}

/** Lists an item as Alice. */
function listing(title: string, requestId: string) {
  return send("POST", "/v1/market/listings", { kind: "item", title, price: 100, request_id: requestId });
}

/** Runs each step after the one before has finished. */
function inTurn<A>(items: readonly A[], step: (item: A) => Promise<unknown>): Promise<unknown> {
  return items.reduce<Promise<unknown>>((done, item) => done.then(() => step(item)), Promise.resolve());
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

/** Writes guild events directly, as the code that reports them does. */
function told(count: number) {
  return services.run(
    Effect.forEach(
      Array.from({ length: count }, (_, index) => index + 1),
      (index) =>
        GuildEvents.use((events) =>
          events.insert(
            `test:${index}`,
            { type: "market.listings_added", data: { count: index, from: "x", to: "y" } },
            clock.now,
          ),
        ),
      { discard: true },
    ),
  );
}

beforeEach(() => {
  clock.now = T0;
  services = testLeaf(clock, backend);
  openApp();
});

afterEach(async () => {
  await app.dispose();
  await services.dispose();
});

describe("the guild feed", () => {
  it("hangs each raid's lantern once for its party, by the names the Forest shows", async () => {
    await send("GET", "/v1/grove");
    const party = [alice, bob, carol, dave].map((member) => raid(1, member, T0 + MINUTE));

    await sync(party);
    await sync(party, T0 + 2 * HOUR);

    expect(await guildFeed()).toEqual([
      {
        id: 1,
        type: "grove.raid_lantern",
        created_at: "2026-11-25T13:00:00.000Z",
        data: {
          raid: "raid:1",
          raid_name: "The Nameless Anomaly",
          party: [
            { player_id: alice, name: "Alice" },
            { player_id: bob, name: null },
            { player_id: carol, name: null },
            { player_id: dave, name: null },
          ],
          occurred_at: "2026-11-25T12:01:00.000Z",
        },
      },
    ]);
  });

  it("tells of each war the guild won once, with who fought", async () => {
    await sync([war(9, bob, T0 + MINUTE), war(9, carol, T0 + MINUTE)]);

    expect(await guildFeed()).toEqual([
      expect.objectContaining({
        type: "guild.war_win",
        data: {
          war: "war:9",
          territory: "Detlas",
          players: [
            { player_id: bob, name: null },
            { player_id: carol, name: null },
          ],
          occurred_at: "2026-11-25T12:01:00.000Z",
          in_claim: true,
        },
      }),
    ]);
  });

  it("tells of a cone of Dryad or better, with who opened it, and not of a commoner one", async () => {
    await app.dispose();
    openApp([rollWhere((pull) => pull.rank === "leafkin"), rollWhere((pull) => pull.rank === "treant")]);
    await give(alice, 1000);
    await send("POST", "/v1/grove/cones/buy", { count: 1, request_id: "buy-1" });
    await send("POST", "/v1/grove/cones/buy", { count: 1, request_id: "buy-2" });

    await send("POST", "/v1/grove/cones/open", { count: 1, request_id: "open-1" });
    await send("POST", "/v1/grove/cones/open", { count: 1, request_id: "open-2" });
    await send("POST", "/v1/grove/cones/open", { count: 1, request_id: "open-2" });

    const events = await guildFeed();
    expect(events).toEqual([
      expect.objectContaining({
        type: "grove.cone_opened",
        data: {
          member: { player_id: alice, name: "Alice" },
          banner: "tcc",
          spirit: expect.any(String),
          rank: "treant",
          verdant: expect.any(Boolean),
        },
      }),
    ]);
  });

  it("tells of a member's tree growing, once a level, and only for members with a tree", async () => {
    await send("GET", "/v1/grove");
    // 1,000 season rating is 1,000 XP, which reaches level 2.
    await sync([raid(1, alice, T0 + MINUTE, 1000), raid(2, bob, T0 + MINUTE, 1000)]);

    const levels = (await guildFeed()).filter((event) => event.type === "grove.level_up");

    expect(levels).toEqual([
      expect.objectContaining({ data: { member: { player_id: alice, name: "Alice" }, level: 2 } }),
    ]);
  });

  it("tells once when the guild meets a Great Sequoia goal", async () => {
    await give(alice, 60_000);

    await inTurn([1, 2, 3, 4, 5, 6], (index) =>
      send("POST", "/v1/grove/great/offer", { leaf: 10_000, request_id: `offer-${index}` }),
    );

    expect(await guildFeed()).toEqual([
      expect.objectContaining({
        type: "great.goal_met",
        data: {
          goal: "offered_leaf",
          kind: "offered_leaf",
          title: "Offer 50,000 Leaf to the Great Sequoia",
          target: 50_000,
          reward: { id: "great.fairy-lights", title: "Fairy lights in the Great Sequoia's crown" },
          week_starts_at: "2026-11-23T00:00:00.000Z",
        },
      }),
    ]);
  });

  it("counts new listings an hour at a time, once each, and never says what they are", async () => {
    clock.now = T0 + 10 * MINUTE;
    await listing("Buy my spam", "a");
    clock.now = T0 + 20 * MINUTE;
    await listing("Buy more spam", "b");
    clock.now = T0 + HOUR + 5 * MINUTE;
    await listing("Arrows", "c");

    clock.now = T0 + HOUR + 30 * MINUTE;
    await services.run(digestListings(clock.now, DEFAULT_RULES.market));
    const afterOne = await guildFeed();
    clock.now = T0 + 2 * HOUR;
    await services.run(digestListings(clock.now, DEFAULT_RULES.market));
    await services.run(digestListings(clock.now, DEFAULT_RULES.market));

    expect(afterOne.map((event) => event.data)).toEqual([
      { count: 2, from: "2026-11-25T12:00:00.000Z", to: "2026-11-25T13:00:00.000Z" },
    ]);
    expect((await guildFeed()).map((event) => [event.type, event.data])).toEqual([
      ["market.listings_added", { count: 2, from: "2026-11-25T12:00:00.000Z", to: "2026-11-25T13:00:00.000Z" }],
      ["market.listings_added", { count: 1, from: "2026-11-25T13:00:00.000Z", to: "2026-11-25T14:00:00.000Z" }],
    ]);
    expect(JSON.stringify(await guildFeed())).not.toContain("spam");
  });
});

describe("GET /v1/guild/events", () => {
  it("lists the newest 50 events, oldest first, to anyone", async () => {
    await told(120);

    const events = await guildFeed();

    expect(events.map((event) => event.id)).toEqual(Array.from({ length: 50 }, (_, index) => index + 71));
  });

  it("pages forward from the event the client saw last, up to 100 at a time", async () => {
    await told(120);

    const first = await guildFeed("?after=0");
    const next = await guildFeed(`?after=${first.at(-1)?.id}`);
    const done = await guildFeed(`?after=${next.at(-1)?.id}`);

    expect(first.map((event) => event.id)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    expect(next.map((event) => event.id)).toEqual(Array.from({ length: 20 }, (_, index) => index + 101));
    expect(done).toEqual([]);
  });

  it("refuses an after that is not an event id", async () => {
    const answered = await send("GET", "/v1/guild/events?after=yesterday", undefined, null);

    expect(answered.status).toBe(400);
    expect(await answered.json()).toMatchObject({ code: "invalid_after" });
  });
});

describe("GET /v1/guild/events/stream", () => {
  it("sends an event as soon as it happens, to anyone, and nothing from before they connected", async () => {
    await told(1);
    const response = await send("GET", "/v1/guild/events/stream", undefined, null);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    await services.run(
      GuildEvents.use((events) =>
        events.insert("later", { type: "market.listings_added", data: { count: 7, from: "x", to: "y" } }, clock.now),
      ),
    );
    const text = await readUntil(response, '"count":7');

    expect(text.startsWith("id: 1\nretry: 3000\n\n")).toBe(true);
    expect(text).toContain("event: market.listings_added\n");
    expect(text).toContain("id: 2\n");
    expect(text).not.toContain('"count":1,');
  });

  it("sends what a reconnecting client missed", async () => {
    await told(3);

    const response = await app.request("/v1/guild/events/stream", { headers: { "Last-Event-ID": "1" } });
    const text = await readUntil(response, '"count":2', '"count":3');

    expect(text).not.toContain('"count":1,');
  });
});
