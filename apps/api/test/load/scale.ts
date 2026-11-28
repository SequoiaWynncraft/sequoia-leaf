/**
 * What Leaf's work that could grow with the number of players comes to, in memory, with synthetic
 * players who each have a day of visits behind them:
 *
 *   bun apps/api/test/load/scale.ts [presence] [refresh] [streams] [startup]
 *
 * - presence: the CPU and time of one `PUT /v1/game/presence`, with 1,000, 2,000 and 10,000
 *   players about, every one of them on a page that says where it is every 30 seconds: Leaf's clock
 *   moves on 30 seconds over the number of players between calls.
 * - refresh: Live's word every 30 seconds that everybody in the town's room is still there
 *   (`Visits.inRoom`), at the same sizes: how long it takes, and the longest a one-statement write
 *   waits for the database meanwhile.
 * - streams: how many times a second the events table is read with 1,000 and 10,000 members each
 *   with their own event stream open and nothing happening.
 * - startup: how long Leaf's start-up work (`Startup`) takes with 10,000 and 100,000 accounts, one
 *   in ten of them with XP and owed Leaf for levels: at the first start, which pays them, at the
 *   next, and at the one after, as at later deploys.
 *
 * With nothing named it measures them all. Numbers vary with the machine; compare runs on one.
 */
import { type PlayerId, playerId } from "@sequoia-leaf/core";
import { Array as Arr, Effect, Fiber, Layer, References } from "effect";
import { SqlClient } from "effect/sql";

import { type Visitor, Visits } from "../../src/activity/visits.ts";
import type { Events } from "../../src/events/store.ts";
import { Startup } from "../../src/jobs.ts";
import { DAY, fakeBackend, MINUTE, sessionOf, testLeaf } from "../support.ts";
import { spread } from "./shared.ts";

/** Wednesday 25 November 2026, 12:00 UTC. */
const NOW = Date.UTC(2026, 10, 25, 12);
const TOWN = { place: "town", camp: null };
const SIZES = [1000, 2000, 10_000];
/** Closed visits each player has had in the last day, before the one they are in. */
const HISTORY = 8;
/** Players who stay are in rows this many at a time. */
const BATCH = 200;

const player = (i: number): PlayerId => playerId(`50000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const name = (i: number) => `P${i}`;
const guest = (i: number) => i % 4 === 3;
const ms = (n: number) => Number(n.toFixed(2));
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => from + k);
/** Writes rows into a table in one statement. */
const insert = (sql: SqlClient.SqlClient, table: string, rows: readonly Record<string, unknown>[]) =>
  Arr.isReadonlyArrayNonEmpty(rows)
    ? sql`INSERT INTO ${sql(table)} ${sql.insert(rows)}`.pipe(Effect.asVoid)
    : Effect.void;

/**
 * `open` players in town now, last heard of in the last 25 seconds, and half as many again gone in
 * the last day; each with `HISTORY` closed visits over the day and one session. Every fifth would
 * rather not stay.
 */
const stageVisits = (open: number) =>
  SqlClient.SqlClient.use((sql) =>
    Effect.gen(function* () {
      const everyone = open + open / 2;
      for (let from = 0; from < everyone; from += BATCH) {
        const batch = range(from, Math.min(from + BATCH, everyone));
        const sessions = batch.map((i) => ({
          id: i + 1,
          playerId: player(i),
          guest: guest(i) ? 1 : 0,
          startedAt: NOW - DAY + MINUTE,
          endedAt: i < open ? null : NOW - 2 * 60 * MINUTE,
          seconds: HISTORY * 600,
          places: "{}",
        }));
        const closed = batch.flatMap((i) =>
          range(0, HISTORY).map((k) => {
            const entered = NOW - DAY + (k * 170 + (i % 60) + 2) * MINUTE;
            return {
              sessionId: i + 1,
              playerId: player(i),
              guest: guest(i) ? 1 : 0,
              place: ["town", "works", "camp", "table"][k % 4] ?? "town",
              source: "call",
              enteredAt: entered,
              heardAt: entered + 10 * MINUTE,
              instance: "earlier",
              leftAt: entered + 10 * MINUTE,
              seconds: 600,
            };
          }),
        );
        const here = batch
          .filter((i) => i < open)
          .map((i) => ({
            sessionId: i + 1,
            playerId: player(i),
            guest: guest(i) ? 1 : 0,
            place: "town",
            source: "room",
            enteredAt: NOW - 15 * MINUTE,
            heardAt: NOW - (i % 25) * 1000,
            instance: "earlier",
            leftAt: null,
            seconds: 0,
          }));
        const seen = batch.map((i) => ({
          playerId: player(i),
          name: name(i),
          guest: guest(i) ? 1 : 0,
          firstSeenAt: NOW - 30 * DAY,
          lastSeenAt: NOW - MINUTE,
          secondsTotal: HISTORY * 600,
          sessions: 1,
          stay: i % 5 === 4 ? 0 : 1,
        }));
        yield* insert(sql, "sessions", sessions);
        yield* insert(sql, "visits", closed);
        yield* insert(sql, "visits", here);
        yield* insert(sql, "players_seen", seen);
      }
    }).pipe(sql.withTransaction),
  );

/** Leaf with nothing tracing it, as production runs. */
const untraced = Layer.succeed(References.TracerEnabled)(false);

/** A page's `PUT /v1/game/presence` for each of the first 400 players, 30 s / `open` apart. */
async function presence(open: number) {
  const calls = 400;
  const tokens = Object.fromEntries(
    range(0, calls).map((i) => [
      `p${i}`,
      () => Response.json(sessionOf(player(i), name(i), guest(i) ? null : "RECRUIT")),
    ]),
  );
  const clock = { now: NOW };
  const leaf = testLeaf(clock, fakeBackend(tokens).fetcher);
  const app = leaf.app(untraced);
  try {
    await leaf.run(stageVisits(open));
    const put = (i: number) =>
      app.request("/v1/game/presence", {
        method: "PUT",
        headers: { Authorization: `Bearer p${i}`, "Content-Type": "application/json" },
        body: JSON.stringify({ place: "town" }),
      });
    // Each session is asked of the backend once, and kept.
    for (const i of range(0, calls)) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      await (await app.request("/v1/game/presence", { headers: { Authorization: `Bearer p${i}` } })).arrayBuffer();
    }
    const took: number[] = [];
    const cpu = process.cpuUsage();
    for (const i of range(0, calls)) {
      clock.now = NOW + Math.round((i * 30_000) / open);
      const began = performance.now();
      // oxlint-disable-next-line no-await-in-loop -- one after another, as the pages' calls come
      const response = await put(i);
      // oxlint-disable-next-line no-await-in-loop -- read whole, as a page does
      await response.arrayBuffer();
      took.push(performance.now() - began);
      if (response.status !== 200) throw new Error(`PUT /v1/game/presence answered ${response.status}`);
    }
    const used = process.cpuUsage(cpu);
    return { open, cpu_ms_per_call: ms((used.user + used.system) / 1000 / calls), wall_ms: spread(took) };
  } finally {
    await app.dispose();
    await leaf.dispose();
  }
}

/** Live's word that every player about is still in the town's room, and a small write waiting meanwhile. */
async function refresh(open: number) {
  const clock = { now: NOW };
  const leaf = testLeaf(clock, fakeBackend().fetcher);
  try {
    await leaf.run(stageVisits(open));
    const everybody: Visitor[] = range(0, open).map((i) => ({
      playerId: player(i),
      username: name(i),
      guest: guest(i),
      device: null,
    }));
    clock.now = NOW + 1000;
    return await leaf.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const visits = yield* Visits;
        const waits: number[] = [];
        const write = Effect.gen(function* () {
          const began = performance.now();
          yield* sql`UPDATE players_seen SET stay = stay WHERE player_id = 'nobody'`.pipe(sql.withTransaction);
          waits.push(performance.now() - began);
          yield* Effect.sleep("1 millis");
        });
        const writer = yield* Effect.forkChild(Effect.forever(write));
        // The writer is under way before the refresh, and has its last wait counted after it.
        yield* Effect.sleep("20 millis");
        const began = performance.now();
        yield* visits.inRoom(everybody, TOWN, NOW + 1000);
        const took = performance.now() - began;
        yield* Effect.sleep("20 millis");
        yield* Fiber.interrupt(writer);
        return { open, refresh_ms: ms(took), write_waited_ms: spread(waits) };
      }).pipe(Effect.provide(untraced)),
    );
  } finally {
    await leaf.dispose();
  }
}

/** `members` each with their own event stream open, and how often the events table is read in six quiet seconds. */
async function streams(members: number) {
  const tokens = Object.fromEntries(
    range(0, members).map((i) => [`s${i}`, () => Response.json(sessionOf(player(i), name(i)))]),
  );
  const reads = { n: 0 };
  const read = <A>(effect: Effect.Effect<A>) =>
    Effect.tap(
      effect,
      Effect.sync(() => {
        reads.n += 1;
      }),
    );
  const counted = (real: Events["Service"]): Events["Service"] => ({
    ...real,
    after: (...args) => read(real.after(...args)),
    allAfter: (...args) => read(real.allAfter(...args)),
    latest: (...args) => read(real.latest(...args)),
    latestId: read(real.latestId),
    latestIdOf: (...args) => read(real.latestIdOf(...args)),
    everyoneAfter: (...args) => read(real.everyoneAfter(...args)),
    everyoneLatest: (...args) => read(real.everyoneLatest(...args)),
  });
  const leaf = testLeaf({ now: NOW }, fakeBackend(tokens).fetcher, {}, { events: counted });
  const app = leaf.app(untraced);
  const readers: { cancel: () => Promise<void> }[] = [];
  const drained: Promise<void>[] = [];
  try {
    for (const i of range(0, members)) {
      // oxlint-disable-next-line no-await-in-loop -- opened one after another, as members come
      const response = await app.request("/v1/me/events/stream", { headers: { Authorization: `Bearer s${i}` } });
      const reader = response.body?.getReader();
      if (reader === undefined) throw new Error("A stream with no body");
      readers.push(reader);
      drained.push(
        (async () => {
          // oxlint-disable-next-line no-await-in-loop -- read as it comes, as a browser does
          while (!(await reader.read()).done);
        })().catch(() => undefined),
      );
    }
    await Bun.sleep(3000);
    const before = reads.n;
    const seconds = 6;
    await Bun.sleep(seconds * 1000);
    return { members, reads_per_second: ms((reads.n - before) / seconds) };
  } finally {
    await Promise.all(readers.map((reader) => reader.cancel()));
    await Promise.all(drained);
    await app.dispose();
    await leaf.dispose();
  }
}

/** `accounts` accounts, one in ten with 5,000 XP, and Leaf's start-up work three times. */
async function startup(accounts: number) {
  const leaf = testLeaf({ now: NOW }, fakeBackend().fetcher);
  try {
    await leaf.run(
      SqlClient.SqlClient.use((sql) =>
        Effect.gen(function* () {
          for (let from = 0; from < accounts; from += 500) {
            const entries = range(from, Math.min(from + 500, accounts)).map((i) => ({
              playerId: player(i),
              kind: "earn",
              balanceDelta: 10,
              xpDelta: i % 10 === 0 ? 5000 : 0,
              origin: "raid",
              idempotencyKey: `stage:${i}`,
              createdAt: NOW - DAY,
            }));
            yield* insert(sql, "ledger_entries", entries);
          }
        }).pipe(sql.withTransaction),
      ),
    );
    const start = async () => {
      const cpu = process.cpuUsage();
      const began = performance.now();
      await leaf.run(Effect.scoped(Layer.build(Startup)).pipe(Effect.provide(untraced)));
      const used = process.cpuUsage(cpu);
      return { ms: ms(performance.now() - began), cpu_ms: ms((used.user + used.system) / 1000) };
    };
    const first = await start();
    const next = await start();
    const later = await start();
    return { accounts, first, next, later };
  } finally {
    await leaf.dispose();
  }
}

const asked = new Set(process.argv.slice(2));
const wanted = (part: string) => asked.size === 0 || asked.has(part);
const results: Record<string, unknown[]> = {};
const measure = async <A>(part: string, sizes: readonly number[], run: (n: number) => Promise<A>) => {
  if (!wanted(part)) return;
  results[part] = [];
  for (const n of sizes) {
    // oxlint-disable-next-line no-await-in-loop -- one at a time, so that none measures another
    const result = await run(n);
    console.log(part, JSON.stringify(result));
    results[part].push(result);
  }
};
await measure("presence", SIZES, presence);
await measure("refresh", SIZES, refresh);
await measure("streams", (process.env.STREAMS ?? "1000,10000").split(",").map(Number), streams);
await measure("startup", [10_000, 100_000], startup);
