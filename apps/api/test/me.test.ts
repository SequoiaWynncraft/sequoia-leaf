import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { leaf, playerId, RAIDS } from "@sequoia-leaf/core";
import { Effect, Fiber, Layer, Logger, References } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";

import { Identities } from "../src/auth/session.ts";
import { AppConfig } from "../src/config.ts";
import { runCreditSync } from "../src/earning/run.ts";
import { type LogLine, MINUTE, testConfig, testLeaf, unanswered } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
/** Wednesday 4 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 4, 12);

const member = {
  discord_id: "1",
  discord_username: "alice",
  minecraft_uuid: alice,
  minecraft_username: "Alice",
  expires_at: "2026-12-01T00:00:00Z",
  guild_rank: "CAPTAIN",
  website_admin: false,
};

/** What the stand-in backend answers, by bearer token and for the credit feed. */
let sessions: Record<string, () => Response | Promise<Response>>;
let credits: unknown;
let backendCalls: string[];
/** While set, the credit feed answers only once the test lets it (`holdFeed`). */
let feedHeld: { readonly asked: () => void; readonly answer: Promise<void> } | null;
const clock = { now: T0 };
/** Leaf's warnings and errors. */
let logged: LogLine[];
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

function backend(url: string, init: RequestInit): Promise<Response> {
  const request = new Request(url, init);
  const path = new URL(request.url).pathname;
  backendCalls.push(path);
  if (path === "/auth/web/me") {
    const token = request.headers.get("Authorization")?.slice("Bearer ".length) ?? "";
    const answer = sessions[token] ?? (() => Response.json({ error: "unauthorized" }, { status: 401 }));
    return Promise.resolve(answer());
  }
  if (path === "/internal/player-credits") {
    if (feedHeld === null) {
      return Promise.resolve(Response.json(credits));
    }
    feedHeld.asked();
    return feedHeld.answer.then(() => Response.json(credits));
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

/** Holds the credit feed's next answers: `asked` once Leaf has asked it, and they go once `answer` is called. */
function holdFeed() {
  const asked = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<void>();
  feedHeld = { asked: () => asked.resolve(), answer: answer.promise };
  return {
    asked: asked.promise,
    answer: () => {
      feedHeld = null;
      answer.resolve();
    },
  };
}

/** Told when a request asks for the feed to be brought in first (`Credits.fresh`), as it takes its turn. */
let onFresh = () => {};
/** Once the next request has taken its turn to bring the feed in: it waits for any run under way. */
function nextInLine(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  onFresh = resolve;
  return promise;
}

function get(path: string, headers: Record<string, string> = { Authorization: "Bearer alice-token" }) {
  return app.request(path, { headers });
}

beforeEach(() => {
  sessions = { "alice-token": () => Response.json(member) };
  credits = { raids: [], wars: [] };
  backendCalls = [];
  feedHeld = null;
  clock.now = T0;
  logged = [];
  onFresh = () => {};
  services = testLeaf(
    clock,
    backend,
    {},
    {
      logged,
      credits: (real) => ({ ...real, fresh: (then) => Effect.andThen(Effect.sync(onFresh), real.fresh(then)) }),
    },
  );
  app = services.app();
});

/** What Leaf logged where it could not ask the backend who a session is. */
const unasked = () =>
  logged
    .filter((line) => line.message === "The backend could not say whose a session is")
    .map((line) => line.annotations);

afterEach(async () => {
  await app.dispose();
});

describe("signing in", () => {
  it("turns away a request without a session", async () => {
    const response = await get("/v1/me", {});

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "unauthorized" });
    expect(backendCalls).toEqual([]);
  });

  it("turns away a session the backend does not accept", async () => {
    const response = await get("/v1/me", { Authorization: "Bearer stale-token" });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "unauthorized" });
  });

  it("turns away someone who is not in the guild", async () => {
    sessions["visitor-token"] = () => Response.json({ ...member, guild_rank: null });

    const response = await get("/v1/me", { Authorization: "Bearer visitor-token" });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "not_a_member" });
  });

  it.each([
    ["cannot be reached", () => Promise.reject(new Error("connection refused")), { reason: "unreachable" }],
    ["answers 502", () => new Response("down", { status: 502 }), { reason: "unexpected_status", status: 502 }],
    [
      "answers what is not a session",
      () => Response.json({ ...member, minecraft_uuid: 7 }),
      { reason: "schema_mismatch" },
    ],
  ])(
    "says so when the backend %s, rather than calling the session invalid; logs why; and asks again next time",
    async (_, answer, why) => {
      sessions["alice-token"] = answer;

      const response = await get("/v1/me");

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "identity_unavailable" });
      expect(unasked()).toEqual([{ route: "/auth/web/me", ...why }]);
      // Not remembered: the next request asks again, at once.
      sessions["alice-token"] = () => Response.json(member);
      expect((await get("/v1/me")).status).toBe(200);
    },
  );

  it("gives the backend three seconds to say, then says so and logs it as a timeout", async () => {
    const lines: unknown[] = [];
    const identities = Identities.layer.pipe(
      Layer.provide(Layer.succeed(AppConfig)(testConfig())),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(
        Layer.succeed(FetchHttpClient.Fetch)(Object.assign(unanswered, { preconnect: globalThis.fetch.preconnect })),
      ),
    );
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const asking = yield* Effect.forkChild(Identities.use((service) => service.identify("alice-token")));
        yield* TestClock.adjust("2999 millis");
        const before = asking.pollUnsafe();
        yield* TestClock.adjust("1 milli");
        return { before, after: yield* Fiber.join(asking) };
      }).pipe(
        Effect.provide(identities),
        Effect.provide(
          Logger.layer([Logger.map(Logger.formatStructured, (line) => void lines.push(line.annotations))]),
        ),
        Effect.provideService(References.MinimumLogLevel, "All"),
        Effect.provide(TestClock.layer()),
      ),
    );

    expect(outcome).toEqual({ before: undefined, after: { status: "unavailable" } });
    expect(lines).toEqual([{ route: "/auth/web/me", reason: "timeout" }]);
  });

  it("asks the backend once for several requests in the same minute", async () => {
    await get("/v1/me");
    await get("/v1/me");
    clock.now = T0 + 2 * MINUTE;
    await get("/v1/me");

    expect(backendCalls).toEqual(["/auth/web/me", "/auth/web/me"]);
  });
});

describe("GET /v1/me", () => {
  it("shows a new member at zero Leaf and level 1", async () => {
    const response = await get("/v1/me");

    expect(await response.json()).toEqual({
      player: { id: alice, username: "Alice" },
      leaf: 0,
      xp: 0,
      level: { number: 1, xp_into_level: 0, xp_for_next_level: 1000 },
    });
  });

  it("shows the balance, XP and level the ledger adds up to", async () => {
    await services.post(
      { kind: "earn", playerId: alice, amount: leaf(1300), source: "staff", idempotencyKey: "a" },
      T0,
    );
    await services.post({ kind: "spend", playerId: alice, amount: leaf(300), sink: "shop", idempotencyKey: "b" }, T0);

    const response = await get("/v1/me");

    expect(await response.json()).toMatchObject({
      leaf: 1000,
      xp: 1300,
      level: { number: 2, xp_into_level: 300, xp_for_next_level: 1250 },
    });
  });
});

describe("GET /v1/me/quests", () => {
  it("shows a new member a daily and a weekly without storing anything, and when timed quests begin", async () => {
    const response = await get("/v1/me/quests");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      daily: { charges: 1, charge_cap: 3, next_charge_at: "2026-11-05T00:00:00.000Z" },
      timed: { ends_at: null, next_at: "2026-11-19T04:00:00.000Z" },
      quests: [
        { id: "daily:1", progress: 0 },
        { id: "weekly:1", progress: 0 },
      ],
      recently_completed: [],
    });
    expect(await services.query((sql) => sql`SELECT COUNT(*) AS n FROM quests`)).toEqual([{ n: 0 }]);
  });

  it("shows the open timed quest, the same window for everyone", async () => {
    clock.now = Date.UTC(2026, 10, 25, 12, 30);

    const response = await get("/v1/me/quests");

    expect(await response.json()).toMatchObject({
      timed: { ends_at: "2026-11-25T14:00:00.000Z", next_at: "2026-11-25T16:00:00.000Z" },
      quests: [
        { slot: "daily" },
        { slot: "weekly" },
        {
          id: "timed:1",
          slot: "timed",
          progress: 0,
          reward: { leaf: 500, xp: 250 },
          started_at: "2026-11-25T12:00:00.000Z",
          expires_at: "2026-11-25T14:00:00.000Z",
          completed_at: null,
        },
      ],
    });
  });

  it("syncs on request, so a raid just finished shows in the same answer", async () => {
    await get("/v1/me/quests?sync=1");
    credits = {
      raids: [
        {
          completion_id: 4812,
          completed_at: "2026-11-04T12:01:00Z",
          raid_name: "The Nameless Anomaly",
          season_rating: 110,
          player_uuid: alice,
        },
      ],
      wars: [],
    };
    clock.now = T0 + 5 * MINUTE;

    const response = await get("/v1/me/quests?sync=1");

    expect(await response.json()).toMatchObject({ quests: [{ slot: "daily" }, { slot: "weekly" }] });
    expect(await (await get("/v1/me")).json()).toMatchObject({ leaf: 110, xp: 110 });
  });

  it("does not ask the backend for credits unless a sync is requested", async () => {
    await get("/v1/me/quests");

    expect(backendCalls).toEqual(["/auth/web/me"]);
  });

  it("does not retry a failed sync until the few seconds are up", async () => {
    await get("/v1/me/quests?sync=1");
    credits = { not: "a credit feed" };
    clock.now = T0 + MINUTE;
    const failed = await get("/v1/me/quests?sync=1");
    clock.now = T0 + MINUTE + 5_000;
    await get("/v1/me/quests?sync=1");
    clock.now = T0 + MINUTE + 15_000;
    await get("/v1/me/quests?sync=1");

    expect(failed.status).toBe(200);
    expect(backendCalls.filter((path) => path === "/internal/player-credits")).toHaveLength(2);
  });

  it("syncs at most once every few seconds however often it is asked", async () => {
    await get("/v1/me/quests?sync=1");
    clock.now = T0 + MINUTE;
    await get("/v1/me/quests?sync=1");
    clock.now = T0 + MINUTE + 5_000;
    await get("/v1/me/quests?sync=1");

    expect(backendCalls.filter((path) => path === "/internal/player-credits")).toHaveLength(1);
  });
});

/** Asks to reroll a quest, agreeing to pay `cost` Leaf for it. */
function reroll(id: string, cost = 0, token = "alice-token") {
  return app.request(`/v1/me/quests/${id}/reroll`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ leaf: cost }),
  });
}

async function quests(): Promise<unknown> {
  return (await get("/v1/me/quests")).json();
}

function earn(amount: number) {
  return services.post(
    { kind: "earn", playerId: alice, amount: leaf(amount), source: "staff", idempotencyKey: `staff:${amount}` },
    T0,
  );
}

/** The feed lists three of every raid a minute after T0, which finishes any daily the rules can hand out. */
function dailyFinished() {
  credits = {
    raids: Object.values(RAIDS).flatMap((raidName, kind) =>
      [0, 1, 2].map((run) => ({
        completion_id: 100 + kind * 3 + run,
        completed_at: new Date(T0 + MINUTE + (kind * 3 + run) * 1000).toISOString(),
        raid_name: raidName,
        season_rating: 110,
        player_uuid: alice,
      })),
    ),
    wars: [],
  };
}

describe("POST /v1/me/quests/:id/reroll", () => {
  it("swaps a quest for another, free the first time each day, and then offers the next for 100 Leaf", async () => {
    expect(await quests()).toMatchObject({
      quests: [
        { id: "daily:1", reroll_leaf: 0 },
        { id: "weekly:1", reroll_leaf: 0 },
      ],
    });
    clock.now = T0 + MINUTE;

    const response = await reroll("daily:1");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      leaf: 0,
      spent: 0,
      quest: { id: "daily:2", progress: 0, started_at: "2026-11-04T12:01:00.000Z", reroll_leaf: 100 },
    });
    expect(await quests()).toMatchObject({
      quests: [
        { id: "daily:2", reroll_leaf: 100 },
        { id: "weekly:1", reroll_leaf: 0 },
      ],
    });
    const stored = await services.query<{ sequence: number; template_id: string; expires_at: number | null }>(
      (sql) => sql`SELECT sequence, template_id, expires_at FROM quests WHERE slot = 'daily' ORDER BY sequence`,
    );
    expect(stored.map((row) => [row.sequence, row.expires_at])).toEqual([
      [1, T0 + MINUTE],
      [2, null],
    ]);
    expect(stored[0]?.template_id).not.toBe(stored[1]?.template_id);
    expect(await (await get("/v1/me/events")).json()).toMatchObject({
      events: [{ type: "quest_rerolled", data: { replaced: { id: "daily:1" }, quest: { id: "daily:2" }, leaf: 0 } }],
    });
  });

  it("charges 100 Leaf for each further reroll that day, and refuses one the balance can't cover", async () => {
    await earn(150);
    await reroll("daily:1");

    const paid = await reroll("daily:2", 100);
    expect(await paid.json()).toMatchObject({ leaf: 50, spent: 100, quest: { id: "daily:3" } });

    const refused = await reroll("daily:3", 100);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "insufficient_leaf" });
    expect(await quests()).toMatchObject({ quests: [{ id: "daily:3", reroll_leaf: 100 }, { id: "weekly:1" }] });
    expect(await (await get("/v1/me")).json()).toMatchObject({ leaf: 50, xp: 150 });
    const spends = await services.query(
      (sql) => sql`SELECT origin, balance_delta, idempotency_key FROM ledger_entries WHERE kind = 'spend'`,
    );
    expect(spends).toEqual([{ origin: "reroll", balance_delta: -100, idempotency_key: `reroll:${alice}:daily:2` }]);
  });

  it("says Leaf's word on the purse beside a reroll's answer, whose body stays as the mod reads it", async () => {
    await earn(150);
    await reroll("daily:1");
    const paid = await reroll("daily:2", 100);
    expect(Object.keys(Object(await paid.clone().json())).toSorted()).toEqual(["leaf", "quest", "spent"]);
    const said: unknown = JSON.parse(paid.headers.get("Leaf-Purse") ?? "null");
    const me = await app.request("/v1/game/me", { headers: { Authorization: "Bearer alice-token" } });
    const { coins, version } = Object(await me.json());
    expect(said).toEqual({ coins, leaf: 50, version });
  });

  it("counts each slot's free reroll on its own, and gives another the next UTC day", async () => {
    await reroll("daily:1");
    expect(await quests()).toMatchObject({ quests: [{ reroll_leaf: 100 }, { id: "weekly:1", reroll_leaf: 0 }] });

    const weekly = await reroll("weekly:1");
    expect(await weekly.json()).toMatchObject({
      spent: 0,
      quest: { id: "weekly:2", expires_at: "2026-11-09T00:00:00.000Z" },
    });

    clock.now = Date.UTC(2026, 10, 5, 0, 0, 1);
    expect(await quests()).toMatchObject({
      quests: [
        { id: "daily:2", reroll_leaf: 0 },
        { id: "weekly:2", reroll_leaf: 0 },
      ],
    });
  });

  it("lets a member a correction left in debt use the day's free reroll, but not a paid one", async () => {
    const paid = await services.post(
      { kind: "earn", playerId: alice, amount: leaf(100), source: "raid", idempotencyKey: "r" },
      T0,
    );
    await services.post({ kind: "spend", playerId: alice, amount: leaf(100), sink: "shop", idempotencyKey: "s" }, T0);
    if (paid.status !== "posted") throw new Error("not posted");
    await services.post({ kind: "reversal", playerId: alice, reverses: paid.entry, idempotencyKey: "undo:r" }, T0);

    expect(await (await reroll("daily:1")).json()).toMatchObject({ leaf: -100, spent: 0, quest: { id: "daily:2" } });
    expect(await (await reroll("daily:2", 100)).json()).toMatchObject({ code: "insufficient_leaf" });
  });

  it("counts each member's rerolls on their own", async () => {
    const bob = playerId("10000000-0000-0000-0000-000000000002");
    sessions["bob-token"] = () => Response.json({ ...member, minecraft_uuid: bob, minecraft_username: "Bob" });

    expect((await reroll("daily:1", 0, "bob-token")).status).toBe(200);

    expect(await quests()).toMatchObject({ quests: [{ id: "daily:1", reroll_leaf: 0 }, { id: "weekly:1" }] });
  });

  it("takes the id with its colon escaped, as clients that escape path segments send it", async () => {
    const response = await reroll("daily%3A1");

    expect(await response.json()).toMatchObject({ quest: { id: "daily:2" } });
  });

  it("charges only the cost the member agreed to, and refuses when it costs something else now", async () => {
    await earn(500);
    await reroll("daily:1");

    const shownFree = await reroll("daily:2", 0);
    expect(shownFree.status).toBe(409);
    expect(await shownFree.json()).toMatchObject({ code: "cost_changed" });
    expect(await (await reroll("daily:2", 250)).json()).toMatchObject({ code: "cost_changed" });
    expect(await (await get("/v1/me")).json()).toMatchObject({ leaf: 500 });
    expect(await (await reroll("daily:2", 100)).json()).toMatchObject({ leaf: 400, spent: 100 });
  });

  it("asks for the cost the member agreed to", async () => {
    const bodies = [undefined, "not json", "{}", '{"leaf":-1}', '{"leaf":1.5}', '{"leaf":"0"}', "[0]"];
    const answers = await Promise.all(
      bodies.map(async (body) => {
        const response = await app.request("/v1/me/quests/daily:1/reroll", {
          method: "POST",
          headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body }),
        });
        return [response.status, await response.json()];
      }),
    );

    expect(answers).toEqual(bodies.map(() => [400, expect.objectContaining({ code: "invalid_cost" })]));
  });

  it("swaps once when the same request is sent twice", async () => {
    await earn(500);
    const first = await reroll("daily:1");
    const second = await reroll("daily:1");

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "not_current" });
    expect(await (await get("/v1/me")).json()).toMatchObject({ leaf: 500 });
  });

  it("refuses the guild's timed quest and anything that is not a quest id", async () => {
    clock.now = Date.UTC(2026, 10, 25, 12, 30);
    expect(await quests()).toMatchObject({
      quests: [{ slot: "daily" }, { slot: "weekly" }, { id: "timed:1", reroll_leaf: null }],
    });

    const timed = await reroll("timed:1");
    expect(timed.status).toBe(409);
    expect(await timed.json()).toMatchObject({ code: "not_rerollable" });
    const malformed = await Promise.all(
      ["daily", "monthly:1", "daily:-1", "daily:1.5"].map(async (id) => {
        const response = await reroll(id);
        return [response.status, await response.json()];
      }),
    );
    expect(malformed).toEqual(
      Array.from({ length: 4 }, () => [400, { code: "invalid_quest", message: "That is not a quest id" }]),
    );
    expect(await services.query((sql) => sql`SELECT COUNT(*) AS n FROM quest_rerolls`)).toEqual([{ n: 0 }]);
  });

  it("counts what was just played first, so a quest just finished is paid rather than swapped", async () => {
    await get("/v1/me/quests?sync=1");
    dailyFinished();
    clock.now = T0 + 5 * MINUTE;

    const response = await reroll("daily:1");

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "not_current" });
    expect(await quests()).toMatchObject({ recently_completed: [{ id: "daily:1" }] });
  });

  it("waits for a sync another request started, so the raids it is fetching finish the quest first", async () => {
    await get("/v1/me/quests?sync=1");
    dailyFinished();
    clock.now = T0 + 5 * MINUTE;
    const feed = holdFeed();
    const refreshing = get("/v1/me/quests?sync=1");
    await feed.asked;

    const inLine = nextInLine();
    const rerolling = reroll("daily:1");
    await inLine;
    feed.answer();

    expect((await refreshing).status).toBe(200);
    const response = await rerolling;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "not_current" });
    expect(await quests()).toMatchObject({ recently_completed: [{ id: "daily:1" }] });
    expect(await services.query((sql) => sql`SELECT COUNT(*) AS n FROM quest_rerolls`)).toEqual([{ n: 0 }]);
  });

  it("waits for the scheduled sync too, when it is fetching as the reroll comes", async () => {
    await get("/v1/me/quests?sync=1");
    dailyFinished();
    clock.now = T0 + 5 * MINUTE;
    const feed = holdFeed();
    const scheduled = services.run(runCreditSync("recent"));
    await feed.asked;

    const inLine = nextInLine();
    const rerolling = reroll("daily:1");
    await inLine;
    feed.answer();

    expect(await scheduled).toMatchObject({ status: "synced" });
    expect(await (await rerolling).json()).toMatchObject({ code: "not_current" });
    expect(await quests()).toMatchObject({ recently_completed: [{ id: "daily:1" }] });
  });

  it("answers a refresh that comes while a sync is fetching with what that sync paid", async () => {
    await get("/v1/me/quests?sync=1");
    dailyFinished();
    clock.now = T0 + 5 * MINUTE;
    const feed = holdFeed();
    const first = get("/v1/me/quests?sync=1");
    await feed.asked;

    const inLine = nextInLine();
    const second = get("/v1/me/quests?sync=1");
    await inLine;
    feed.answer();

    expect(await (await first).json()).toMatchObject({ recently_completed: [{ id: "daily:1" }] });
    expect(await (await second).json()).toMatchObject({ recently_completed: [{ id: "daily:1" }] });
    expect(backendCalls.filter((path) => path === "/internal/player-credits")).toHaveLength(1);
  });

  it("pays a quest a raid finished though the raid is reported after the quest was rerolled away, and undoes the reroll", async () => {
    await get("/v1/me/quests?sync=1");
    // A minute after the raids, the backend still holds them back: the reroll's sync finds nothing.
    clock.now = T0 + 2 * MINUTE;
    expect((await reroll("daily:1")).status).toBe(200);
    // Then the backend lists them, dated before the reroll.
    dailyFinished();
    clock.now = T0 + 5 * MINUTE;
    const after = await (await get("/v1/me/quests?sync=1")).json();

    expect(after).toMatchObject({ recently_completed: [{ id: "daily:1" }] });
    // Its one banked daily used, the daily the reroll gave is withdrawn: only the weekly is left.
    expect(after).toMatchObject({ daily: { charges: 0 }, quests: [{ slot: "weekly" }] });
    const paid = await services.query(
      (sql) => sql`SELECT idempotency_key AS key FROM ledger_entries WHERE kind = 'earn' AND origin = 'quest'`,
    );
    expect(paid).toEqual([{ key: `quest:${alice}:daily:1` }]);
  });

  it("gives back what the rerolls after a quest finished late cost", async () => {
    await earn(500);
    await get("/v1/me/quests?sync=1");
    clock.now = T0 + 2 * MINUTE;
    await reroll("daily:1");
    clock.now = T0 + 3 * MINUTE;
    expect(await (await reroll("daily:2", 100)).json()).toMatchObject({ leaf: 400, spent: 100 });
    dailyFinished();
    clock.now = T0 + 6 * MINUTE;
    await get("/v1/me/quests?sync=1");

    const rerolls = await services.query(
      (sql) => sql`SELECT kind, balance_delta AS delta FROM ledger_entries WHERE origin = 'reroll' ORDER BY id`,
    );
    expect(rerolls).toEqual([
      { kind: "spend", delta: -100 },
      { kind: "reversal", delta: 100 },
    ]);
    expect(await quests()).toMatchObject({ recently_completed: [{ id: "daily:1" }] });
  });

  it("asks for a session like every /v1/me route", async () => {
    const response = await app.request("/v1/me/quests/daily:1/reroll", { method: "POST" });

    expect(response.status).toBe(401);
  });
});
