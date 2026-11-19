import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { type Activity, DEFAULT_RULES, type PlayerId, playerId, type Rules } from "@sequoia-leaf/core";
import { Effect, Layer } from "effect";

import { syncCredits } from "../src/earning/sync.ts";
import { insertEvent, listEventsAfter } from "../src/events/store.ts";
import { StreamTuning } from "../src/http/handlers.ts";
import { testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
const MINUTE = 60_000;
/** Wednesday 4 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 4, 12);

/** One quest per slot, and a first level short enough for two raids and a quest to pass it. */
const rules: Rules = {
  ...DEFAULT_RULES,
  quests: {
    dailyChargeCap: 3,
    templates: [
      { id: "daily", slot: "daily", objectives: [{ type: "raids", count: 2 }], reward: { leaf: 200, xp: 100 } },
      { id: "weekly", slot: "weekly", objectives: [{ type: "raids", count: 30 }], reward: { leaf: 800, xp: 400 } },
      {
        id: "repeatable",
        slot: "repeatable",
        objectives: [{ type: "raids", count: 30 }],
        reward: { leaf: 50, xp: 25 },
      },
    ],
  },
  levels: { firstLevelXp: 300, xpGrowthPerLevel: 250, firstLevelLeaf: 30, leafGrowthPerLevel: 25 },
};

function raid(id: number, player: PlayerId, occurredAt: number): Activity {
  return {
    kind: "raid",
    sourceKey: `raid:${id}:${player}`,
    playerId: player,
    occurredAt,
    seasonRating: 110,
    raid: "tna",
    raidName: "The Nameless Anomaly",
  };
}

/** A backend whose only session is Alice's. */
function backend(url: string, init: RequestInit): Promise<Response> {
  const token = new Request(url, init).headers.get("Authorization");
  if (token !== "Bearer alice-token") {
    return Promise.resolve(Response.json({ error: "unauthorized" }, { status: 401 }));
  }
  return Promise.resolve(
    Response.json({ minecraft_uuid: alice, minecraft_username: "Alice", guild_rank: "CAPTAIN", website_admin: false }),
  );
}

const clock = { now: T0 };
let services: ReturnType<typeof testLeaf>;
let app: ReturnType<(typeof services)["app"]>;

beforeEach(() => {
  clock.now = T0;
  services = testLeaf(clock, backend);
  // A stream that looks for events every 5 ms, keeps quiet connections alive every 20 ms and closes after 300 ms.
  app = services.app(Layer.succeed(StreamTuning)({ pollMs: 5, heartbeatMs: 20, maxMs: 300 }));
});

afterEach(async () => {
  await app.dispose();
});

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(app.request(path, { headers: { Authorization: "Bearer alice-token", ...headers } }));
}

function earned(player: PlayerId, amount: number): void {
  insertEvent(
    services.db,
    player,
    {
      type: "leaf_earned",
      data: {
        source: "raid",
        leaf: amount,
        xp: amount,
        detail: "The Nameless Anomaly",
        occurred_at: "2026-11-04T12:00:00.000Z",
      },
    },
    clock.now,
  );
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

describe("events from the credit sync", () => {
  it("records what a client would show: Leaf earned, a quest finished, a level gained", async () => {
    const activities = [raid(1, alice, T0 + MINUTE), raid(2, alice, T0 + 2 * MINUTE)];
    const source = (from: number, to: number) =>
      Effect.succeed(activities.filter((activity) => activity.occurredAt >= from && activity.occurredAt < to));
    await Effect.runPromise(syncCredits(services.db, source, rules, T0, "recent"));

    await Effect.runPromise(syncCredits(services.db, source, rules, T0 + 5 * MINUTE, "recent"));

    const events = listEventsAfter(services.db, alice, 0, 10).map((event) => ({
      type: event.type,
      data: JSON.parse(event.data) as unknown,
      createdAt: event.createdAt,
    }));
    expect(events).toMatchObject([
      {
        type: "leaf_earned",
        data: {
          source: "raid",
          leaf: 110,
          xp: 110,
          detail: "The Nameless Anomaly",
          occurred_at: "2026-11-04T12:01:00.000Z",
        },
        createdAt: T0 + 5 * MINUTE,
      },
      { type: "leaf_earned", data: { leaf: 110 } },
      {
        type: "quest_completed",
        data: {
          quest: { id: "daily:1", title: "Complete 2 raids", progress: 2, target: 2, reward: { leaf: 200, xp: 100 } },
        },
      },
      // 110 + 110 + 100 XP passes the 300 the first level takes, and level 2 pays 30 Leaf.
      { type: "level_up", data: { level: 2, leaf: 30 } },
    ]);
  });

  it("records nothing when the same events are read again", async () => {
    const source = () => Effect.succeed([raid(1, alice, T0 + MINUTE)]);
    await Effect.runPromise(syncCredits(services.db, source, rules, T0, "recent"));
    await Effect.runPromise(syncCredits(services.db, source, rules, T0 + 5 * MINUTE, "recent"));

    await Effect.runPromise(syncCredits(services.db, source, rules, T0 + 6 * MINUTE, "recent"));

    expect(listEventsAfter(services.db, alice, 0, 10)).toHaveLength(1);
  });
});

describe("GET /v1/me/events", () => {
  it("lists the member's own events, oldest first", async () => {
    earned(alice, 110);
    earned(bob, 999);
    clock.now = T0 + MINUTE;
    earned(alice, 440);

    const response = await get("/v1/me/events");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({
      events: [
        {
          id: 1,
          type: "leaf_earned",
          created_at: "2026-11-04T12:00:00.000Z",
          data: {
            source: "raid",
            leaf: 110,
            xp: 110,
            detail: "The Nameless Anomaly",
            occurred_at: "2026-11-04T12:00:00.000Z",
          },
        },
        {
          id: 3,
          type: "leaf_earned",
          created_at: "2026-11-04T12:01:00.000Z",
          data: {
            source: "raid",
            leaf: 440,
            xp: 440,
            detail: "The Nameless Anomaly",
            occurred_at: "2026-11-04T12:00:00.000Z",
          },
        },
      ],
    });
  });

  it("lists only what came after the event the client saw last", async () => {
    earned(alice, 110);
    earned(alice, 220);
    earned(alice, 330);

    const response = await get("/v1/me/events?after=1");

    expect(await response.json()).toMatchObject({ events: [{ id: 2 }, { id: 3 }] });
  });

  it("refuses an after that is not an event id", async () => {
    const response = await get("/v1/me/events?after=yesterday");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_after" });
  });

  it("needs a session", async () => {
    const response = await app.request("/v1/me/events");

    expect(response.status).toBe(401);
  });
});

describe("GET /v1/me/events/stream", () => {
  it("sends an event as soon as it happens, and nothing from before the client connected", async () => {
    earned(alice, 110);
    const response = await get("/v1/me/events/stream");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    earned(bob, 999);
    earned(alice, 440);
    const text = await readUntil(response, '"leaf":440');

    expect(text.startsWith("id: 1\nretry: 3000\n\n")).toBe(true);
    expect(text).toContain("event: leaf_earned\n");
    expect(text).toContain("id: 3\n");
    expect(text).toContain('data: {"id":3,"type":"leaf_earned","created_at":"2026-11-04T12:00:00.000Z","data":{');
    expect(text).not.toContain('"leaf":110');
    expect(text).not.toContain('"leaf":999');
  });

  it("sends what a reconnecting client missed", async () => {
    earned(alice, 110);
    earned(alice, 220);
    earned(alice, 330);

    const response = await get("/v1/me/events/stream", { "Last-Event-ID": "1" });
    const text = await readUntil(response, '"leaf":220', '"leaf":330');

    expect(text).not.toContain('"leaf":110');
  });

  it("keeps a quiet connection alive, then closes it so the client reconnects", async () => {
    const response = await get("/v1/me/events/stream");

    const text = await response.text();

    expect(text.startsWith("id: 0\nretry: 3000\n\n")).toBe(true);
    expect(text).toContain(": keep-alive\n\n");
  });

  it("tells a client where it started, so one whose quiet stream ended misses nothing on reconnecting", async () => {
    earned(alice, 110);
    const quiet = await (await get("/v1/me/events/stream")).text();
    const started = /^id: (\d+)\n/.exec(quiet)?.[1] ?? "";
    earned(alice, 440);

    const response = await get("/v1/me/events/stream", { "Last-Event-ID": started });
    const text = await readUntil(response, '"leaf":440');

    expect(started).toBe("1");
    expect(text).not.toContain('"leaf":110');
  });

  it("refuses a Last-Event-ID that is not an event id", async () => {
    const response = await get("/v1/me/events/stream", { "Last-Event-ID": "abc" });

    expect(response.status).toBe(400);
  });
});
