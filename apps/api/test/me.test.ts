import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { leaf, playerId } from "@sequoia-leaf/core";
import type { Hono } from "hono";

import { createApp } from "../src/app.ts";
import { forgetSessions } from "../src/auth/session.ts";
import { postEntry } from "../src/ledger/store.ts";
import type { Services } from "../src/services.ts";
import { testServices } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const MINUTE = 60_000;
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
let sessions: Record<string, () => Response>;
let credits: unknown;
let backendCalls: string[];
const clock = { now: T0 };
let services: Services;
let app: Hono;

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
    return Promise.resolve(Response.json(credits));
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

function get(path: string, headers: Record<string, string> = { Authorization: "Bearer alice-token" }) {
  return app.request(path, { headers });
}

beforeEach(() => {
  sessions = { "alice-token": () => Response.json(member) };
  credits = { raids: [], wars: [] };
  backendCalls = [];
  clock.now = T0;
  services = testServices(clock, backend);
  app = createApp(services);
});

afterEach(() => {
  forgetSessions();
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

  it("accepts the website's session cookie", async () => {
    const response = await get("/v1/me", { Cookie: "seq_theme=gaz-purple; seq_session=alice-token" });

    expect(response.status).toBe(200);
  });

  it("turns away someone who is not in the guild", async () => {
    sessions["visitor-token"] = () => Response.json({ ...member, guild_rank: null });

    const response = await get("/v1/me", { Authorization: "Bearer visitor-token" });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "not_a_member" });
  });

  it("says so when the backend cannot be asked, instead of calling the session invalid", async () => {
    sessions["alice-token"] = () => new Response("down", { status: 502 });

    const response = await get("/v1/me");

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "identity_unavailable" });
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
    const { db } = services;
    postEntry(db, { kind: "earn", playerId: alice, amount: leaf(1300), source: "staff", idempotencyKey: "a" }, T0);
    postEntry(db, { kind: "spend", playerId: alice, amount: leaf(300), sink: "shop", idempotencyKey: "b" }, T0);

    const response = await get("/v1/me");

    expect(await response.json()).toMatchObject({
      leaf: 1000,
      xp: 1300,
      level: { number: 2, xp_into_level: 300, xp_for_next_level: 1250 },
    });
  });
});

describe("GET /v1/me/quests", () => {
  it("shows a new member a daily, a weekly and a repeatable without storing anything", async () => {
    const response = await get("/v1/me/quests");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      daily: { charges: 1, charge_cap: 3, next_charge_at: "2026-11-05T00:00:00.000Z" },
      quests: [
        { id: "daily:1", progress: 0 },
        { id: "weekly:1", progress: 0 },
        {
          id: "repeatable:1",
          progress: 0,
          title: "Complete 8 raids",
          target: 8,
          reward: { leaf: 200, xp: 100 },
          started_at: "2026-11-04T12:00:00.000Z",
          expires_at: null,
          completed_at: null,
        },
      ],
      recently_completed: [],
    });
    expect(services.db.query("SELECT COUNT(*) AS n FROM quests").get()).toEqual({ n: 0 });
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

    expect(await response.json()).toMatchObject({
      quests: expect.arrayContaining([expect.objectContaining({ slot: "repeatable", progress: 1, target: 8 })]),
    });
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
