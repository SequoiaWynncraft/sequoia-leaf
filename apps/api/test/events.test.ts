import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { DEFAULT_RULES, leaf, type PlayerId, playerId, type Rules } from "@sequoia-leaf/core";
import { Effect, Layer, Stream } from "effect";

import { syncCredits } from "../src/earning/sync.ts";
import { Events } from "../src/events/store.ts";
import { OpenStreams, StreamTuning } from "../src/http/streams.ts";
import { MINUTE, raid, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-000000000002");
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

function earned(player: PlayerId, amount: number): Promise<void> {
  return services.run(
    Events.use((events) =>
      events.insert(
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
      ),
    ),
  );
}

function eventsOf(player: PlayerId) {
  return services.run(Events.use((events) => events.after(player, 0, 10)));
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
    await services.run(syncCredits(source, rules, T0, "recent"));

    await services.run(syncCredits(source, rules, T0 + 5 * MINUTE, "recent"));

    const events = (await eventsOf(alice)).map((event) => ({
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
    await services.run(syncCredits(source, rules, T0, "recent"));
    await services.run(syncCredits(source, rules, T0 + 5 * MINUTE, "recent"));

    await services.run(syncCredits(source, rules, T0 + 6 * MINUTE, "recent"));

    expect(await eventsOf(alice)).toHaveLength(1);
  });
});

describe("GET /v1/me/events", () => {
  it("lists the member's own events, oldest first", async () => {
    await earned(alice, 110);
    await earned(bob, 999);
    clock.now = T0 + MINUTE;
    await earned(alice, 440);

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
    await earned(alice, 110);
    await earned(alice, 220);
    await earned(alice, 330);

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
    await earned(alice, 110);
    const response = await get("/v1/me/events/stream");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    await earned(bob, 999);
    await earned(alice, 440);
    const text = await readUntil(response, '"leaf":440');

    expect(text.startsWith("id: 1\nretry: 3000\n\n")).toBe(true);
    expect(text).toContain("event: leaf_earned\n");
    expect(text).toContain("id: 3\n");
    expect(text).toContain('data: {"id":3,"type":"leaf_earned","created_at":"2026-11-04T12:00:00.000Z","data":{');
    expect(text).not.toContain('"leaf":110');
    expect(text).not.toContain('"leaf":999');
  });

  it("sends what a reconnecting client missed", async () => {
    await earned(alice, 110);
    await earned(alice, 220);
    await earned(alice, 330);

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
    await earned(alice, 110);
    const quiet = await (await get("/v1/me/events/stream")).text();
    const started = /^id: (\d+)\n/.exec(quiet)?.[1] ?? "";
    await earned(alice, 440);

    const response = await get("/v1/me/events/stream", { "Last-Event-ID": started });
    const text = await readUntil(response, '"leaf":440');

    expect(started).toBe("1");
    expect(text).not.toContain('"leaf":110');
  });

  it("refuses a Last-Event-ID that is not an event id", async () => {
    const response = await get("/v1/me/events/stream", { "Last-Event-ID": "abc" });

    expect(response.status).toBe(400);
  });

  it("sends a reconnecting client more than a page of what it missed, in order, each once", async () => {
    for (let n = 1; n <= 250; n++) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      await earned(n % 3 === 0 ? bob : alice, n);
    }

    const text = await readUntil(await get("/v1/me/events/stream", { "Last-Event-ID": "0" }), '"leaf":250,');

    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids).toEqual([0, ...Array.from({ length: 250 }, (_, k) => k + 1).filter((n) => n % 3 !== 0)]);
  });
});

/**
 * Leaf whose next read of Alice's events after the position it is armed with (`arm`) writes
 * another of hers: after the read (it was not there to be read), or before (it is read as it is
 * written).
 */
function writingWhileRead(when: "after" | "before") {
  const armed = { at: -1 };
  const own = testLeaf(
    clock,
    backend,
    {},
    {
      events: (real) => ({
        ...real,
        after: (player, afterId, limit) => {
          if (player !== alice || afterId !== armed.at) return real.after(player, afterId, limit);
          armed.at = -1;
          const write = real.insert(alice, { type: "level_up", data: { level: 9, leaf: 9 } }, clock.now);
          return when === "after"
            ? Effect.flatMap(real.after(player, afterId, limit), (found) => Effect.as(write, found))
            : Effect.andThen(write, real.after(player, afterId, limit));
        },
      }),
    },
  );
  const served = own.app(Layer.succeed(StreamTuning)({ pollMs: 5, heartbeatMs: 20, maxMs: 300 }));
  return { own, served, arm: (at: number) => void (armed.at = at) };
}
/** Writes a level up of Alice's, as setup. */
const written = (own: ReturnType<typeof testLeaf>, n: number) =>
  own.run(Events.use((events) => events.insert(alice, { type: "level_up", data: { level: n, leaf: n } }, clock.now)));
/** The ids a stream's text gives, in order. */
const ids = (text: string) => [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));

describe("a stream across reconnects", () => {
  for (const when of ["after", "before"] as const) {
    it(`sends each event once, one written just ${when} a reconnecting stream reads what it missed among them`, async () => {
      const { own, served: theirs, arm } = writingWhileRead(when);
      try {
        await written(own, 1);
        await written(own, 2);
        const first = await readUntil(
          await theirs.request("/v1/me/events/stream?after=0", { headers: { Authorization: "Bearer alice-token" } }),
          '"level":2,',
        );
        // The client saw up to 2; a third is written while it is away, and the fourth as it comes back.
        await written(own, 3);
        arm(2);
        const again = await theirs.request("/v1/me/events/stream", {
          headers: { Authorization: "Bearer alice-token", "Last-Event-ID": "2" },
        });
        const second = await readUntil(again, '"level":3,', '"level":9,');

        expect(ids(first)).toEqual([0, 1, 2]);
        expect(ids(second)).toEqual([2, 3, 4]);
      } finally {
        await theirs.dispose();
        await own.dispose();
      }
    });
  }
});

describe("event streams together", () => {
  it("read the events table once a look however many are open, and each one's missed events once as it opens", async () => {
    const reads = { missed: 0, looks: 0 };
    const own = testLeaf(
      clock,
      backend,
      {},
      {
        testClock: true,
        events: (real) => ({
          ...real,
          after: (...args) =>
            Effect.andThen(
              Effect.sync(() => (reads.missed += 1)),
              real.after(...args),
            ),
          allAfter: (...args) =>
            Effect.andThen(
              Effect.sync(() => (reads.looks += 1)),
              real.allAfter(...args),
            ),
        }),
      },
    );
    const theirs = own.app(Layer.succeed(StreamTuning)({ pollMs: 5, heartbeatMs: 60_000, maxMs: 60_000 }));
    const readers: { cancel: () => Promise<void> }[] = [];
    try {
      for (let n = 0; n < 4; n++) {
        // oxlint-disable-next-line no-await-in-loop -- opened one after another
        const response = await theirs.request("/v1/me/events/stream?after=0", {
          headers: { Authorization: "Bearer alice-token" },
        });
        const reader = response.body?.getReader();
        if (reader === undefined) throw new Error("The response has no body");
        // oxlint-disable-next-line no-await-in-loop -- its first frame, as it opens
        await reader.read();
        readers.push(reader);
      }
      await own.adjust("0 millis");
      const opening = { ...reads };
      await own.adjust("20 millis");

      expect(opening.missed).toBe(4);
      expect(reads).toEqual({ missed: 4, looks: opening.looks + 4 });
    } finally {
      await Promise.all(readers.map((reader) => reader.cancel()));
      await theirs.dispose();
      await own.dispose();
    }
  });
});

/** Alice's event as Leaf writes it, in `own`. */
const levelOf = (own: ReturnType<typeof testLeaf>, n: number) =>
  own.run(Events.use((events) => events.insert(alice, { type: "level_up", data: { level: n, leaf: n } }, clock.now)));

/** All a stream sends until it ends; fails if it sends nothing for half a second meanwhile. */
async function untilEnded(reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> }): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  /* oxlint-disable no-await-in-loop -- chunks arrive one after another */
  for (;;) {
    const read = await Promise.race([reader.read(), Bun.sleep(500).then(() => "quiet" as const)]);
    if (read === "quiet") throw new Error(`The stream went quiet without ending. It sent: ${text}`);
    if (read.done) return text;
    text += decoder.decode(read.value, { stream: true });
  }
  /* oxlint-enable no-await-in-loop */
}

describe("a stream when something goes wrong", () => {
  it("still tells a stream what happens after a look at the events failed once", async () => {
    const failing = { once: true };
    const own = testLeaf(
      clock,
      backend,
      {},
      {
        events: (real) => ({
          ...real,
          allAfter: (afterId, limit) =>
            failing.once
              ? Effect.andThen(
                  Effect.sync(() => (failing.once = false)),
                  Effect.die(new Error("the database is busy")),
                )
              : real.allAfter(afterId, limit),
        }),
      },
    );
    const theirs = own.app(Layer.succeed(StreamTuning)({ pollMs: 5, heartbeatMs: 20, maxMs: 2000 }));
    try {
      const response = await theirs.request("/v1/me/events/stream", {
        headers: { Authorization: "Bearer alice-token" },
      });
      const reader = response.body?.getReader();
      if (reader === undefined) throw new Error("The response has no body");
      await reader.read();
      await Bun.sleep(30);
      await levelOf(own, 7);
      const decoder = new TextDecoder();
      let text = "";
      /* oxlint-disable no-await-in-loop -- chunks arrive one after another */
      while (!text.includes('"level":7')) {
        const read = await reader.read();
        if (read.done) throw new Error(`The stream ended before the event. It sent: ${text}`);
        text += decoder.decode(read.value, { stream: true });
      }
      /* oxlint-enable no-await-in-loop */
      await reader.cancel();

      expect(failing.once).toBe(false);
      expect(text).toContain("event: level_up\n");
    } finally {
      await theirs.dispose();
      await own.dispose();
    }
  });

  it("ends a stream as soon as its events end, so that its client reconnects at once", async () => {
    const text = await Effect.runPromise(
      Effect.gen(function* () {
        const streams = yield* OpenStreams;
        const sent = yield* Stream.runCollect(
          streams.open(alice, 0, Stream.make("event: x\n\n")).pipe(Stream.decodeText),
        );
        return sent.join("");
      }).pipe(
        Effect.provide(OpenStreams.layer),
        Effect.provideService(StreamTuning, { pollMs: 5, heartbeatMs: 20, maxMs: 300 }),
      ),
    );

    expect(text).toBe("id: 0\nretry: 3000\n\nevent: x\n\n");
  });

  it("ends a stream that falls more than 32 looks behind, and sends what it missed when it reconnects", async () => {
    const own = testLeaf(clock, backend, {}, { testClock: true });
    const theirs = own.app(Layer.succeed(StreamTuning)({ pollMs: 5, heartbeatMs: 60_000, maxMs: 600_000 }));
    try {
      const response = await theirs.request("/v1/me/events/stream", {
        headers: { Authorization: "Bearer alice-token" },
      });
      const reader = response.body?.getReader();
      if (reader === undefined) throw new Error("The response has no body");
      await reader.read();
      await own.adjust("0 millis");
      // Two hundred events, each found by a look of its own, while the client reads nothing.
      for (let n = 1; n <= 200; n++) {
        // oxlint-disable-next-line no-await-in-loop -- one look after another
        await levelOf(own, n);
        // oxlint-disable-next-line no-await-in-loop -- one look after another
        await own.adjust("5 millis");
      }
      const behind = ids(await untilEnded(reader));
      const last = behind.at(-1) ?? 0;
      const again = await theirs.request("/v1/me/events/stream", {
        headers: { Authorization: "Bearer alice-token", "Last-Event-ID": String(last) },
      });
      const reader2 = again.body?.getReader();
      if (reader2 === undefined) throw new Error("The response has no body");
      const caught = { text: "" };
      const decoder = new TextDecoder();
      /* oxlint-disable no-await-in-loop -- chunks arrive one after another */
      while (!caught.text.includes('"level":200,')) {
        await own.adjust("5 millis");
        const read = await reader2.read();
        if (read.done) throw new Error(`The stream ended. It sent: ${caught.text}`);
        caught.text += decoder.decode(read.value, { stream: true });
      }
      /* oxlint-enable no-await-in-loop */
      await reader2.cancel();

      expect(last).toBeLessThan(200);
      expect(behind).toEqual(Array.from({ length: last }, (_, k) => k + 1));
      expect(ids(caught.text)).toEqual([last, ...Array.from({ length: 200 - last }, (_, k) => last + k + 1)]);
    } finally {
      await theirs.dispose();
      await own.dispose();
    }
  });

  it("tells a member their own events while the guild's names cannot be had", async () => {
    const own = testLeaf(clock, backend, {}, { mojang: { profile: () => Effect.never, texture: () => Effect.never } });
    const theirs = own.app(Layer.succeed(StreamTuning)({ pollMs: 5, heartbeatMs: 20, maxMs: 2000 }));
    try {
      const headers = { Authorization: "Bearer alice-token" };
      const guild = await theirs.request("/v1/game/guild/events/stream", { headers });
      const mine = (await theirs.request("/v1/me/events/stream", { headers })).body?.getReader();
      if (mine === undefined) throw new Error("The response has no body");
      // Her stream has caught up, and hears only the look from here on.
      await mine.read();
      await Bun.sleep(30);
      // Bob's raid is the guild's to see, and nobody can name him, whom Leaf knows; Alice's level comes after it is looked at.
      await own.post(
        { kind: "earn", playerId: bob, amount: leaf(5), source: "raid", idempotencyKey: "bob" },
        clock.now,
      );
      await own.run(
        Events.use((events) =>
          events.insert(
            bob,
            {
              type: "leaf_earned",
              data: { source: "raid", leaf: 5, xp: 5, detail: "TNA", occurred_at: "2026-11-04T12:00:00.000Z" },
            },
            clock.now,
          ),
        ),
      );
      await Bun.sleep(30);
      await levelOf(own, 3);

      const decoder = new TextDecoder();
      let text = "";
      /* oxlint-disable no-await-in-loop -- chunks arrive one after another */
      while (!text.includes('"level":3,')) {
        const read = await mine.read();
        if (read.done) throw new Error(`The stream ended before her event. It sent: ${text}`);
        text += decoder.decode(read.value, { stream: true });
      }
      /* oxlint-enable no-await-in-loop */
      await mine.cancel();
      await guild.body?.cancel();

      expect(text).toContain("event: level_up\n");
    } finally {
      await theirs.dispose();
      await own.dispose();
    }
  });
});
