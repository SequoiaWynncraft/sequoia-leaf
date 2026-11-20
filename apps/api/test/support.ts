import type { Activity, PlayerId, Posting } from "@sequoia-leaf/core";
import { Clock, ConfigProvider, Effect, Layer, ManagedRuntime, Redacted, References } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http";
import { SqlClient } from "effect/sql";

import { routerConfig, Routes, Stores } from "../src/app.ts";
import { AppConfig, type Settings, settings } from "../src/config.ts";
import { databaseAt } from "../src/db.ts";
import type { CreditSource } from "../src/earning/sync.ts";
import { Ledger } from "../src/ledger/store.ts";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** A clock that tests set by hand. */
export interface TestClock {
  now: number;
}

/** A stand-in for the network: answers each request Leaf makes. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** A network that answers nothing, for tests that make no calls. */
export const noNetwork: Fetcher = () => Promise.reject(new Error("No network in this test"));

/** A raid `player` took part in, as the credit feed reports it. */
export function raid(id: number, player: PlayerId, occurredAt: number, seasonRating = 110): Activity {
  return {
    kind: "raid",
    sourceKey: `raid:${id}:${player}`,
    eventKey: `raid:${id}`,
    playerId: player,
    occurredAt,
    seasonRating,
    raid: "tna",
    raidName: "The Nameless Anomaly",
  };
}

/** A credit feed that answers each window with the activities inside it. */
export function feed(activities: readonly Activity[]): CreditSource {
  return (from, to) =>
    Effect.succeed(activities.filter((activity) => activity.occurredAt >= from && activity.occurredAt < to));
}

/** Leaf's settings as these environment variables give them, or fails with why they are invalid. */
export function readSettings(env: Record<string, string>): Settings {
  return Effect.runSync(settings.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))));
}

/** Leaf's settings in tests: a backend and Sierra at made-up addresses, with an internal token. */
export function testConfig(overrides: Partial<Settings> = {}): Settings {
  return {
    ...readSettings({}),
    databasePath: ":memory:",
    backendUrl: "https://backend.test",
    backendToken: Redacted.make("internal-token"),
    sierraUrl: "https://sierra.test",
    ...overrides,
  };
}

/**
 * Leaf around a fresh, fully migrated database in memory, a hand-set clock and
 * a stand-in network: the layer Leaf's code runs with, `run` to run an effect
 * against it, and `app` for its HTTP API. They all share the one database.
 */
export function testLeaf(clock: TestClock, fetcher: Fetcher, config: Partial<Settings> = {}) {
  const handClock = Layer.effect(
    Clock.Clock,
    Clock.clockWith((real) =>
      Effect.succeed({
        currentTimeMillisUnsafe: () => clock.now,
        currentTimeMillis: Effect.sync(() => clock.now),
        currentTimeNanosUnsafe: () => BigInt(clock.now) * 1_000_000n,
        currentTimeNanos: Effect.sync(() => BigInt(clock.now) * 1_000_000n),
        monotonicTimeNanosUnsafe: () => real.monotonicTimeNanosUnsafe(),
        monotonicTimeNanos: real.monotonicTimeNanos,
        // Waits really pass, so an event stream polls as it would.
        sleep: (duration) => real.sleep(duration),
      }),
    ),
  );
  const outside = Layer.mergeAll(
    Layer.succeed(AppConfig)(testConfig(config)),
    FetchHttpClient.layer,
    Layer.succeed(FetchHttpClient.Fetch)(
      // Bun's fetch type carries `preconnect` as well.
      Object.assign(
        (input: string | URL | Request, init?: RequestInit) =>
          fetcher(input instanceof Request ? input.url : input.toString(), init ?? {}),
        {
          preconnect: globalThis.fetch.preconnect,
        },
      ),
    ),
    handClock,
    Layer.succeed(References.MinimumLogLevel)("None"),
  );
  const layer = Stores.pipe(Layer.provideMerge(databaseAt(":memory:")), Layer.provideMerge(outside));
  // Layers built through the same memo map are built once, so `run` and `app` see the same database.
  const memoMap = Layer.makeMemoMapUnsafe();
  const runtime = ManagedRuntime.make(layer, { memoMap });
  return {
    /** Runs an effect against this Leaf. */
    run: <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof layer>>): Promise<A> => runtime.runPromise(effect),
    /** A player's account, as the ledger has it now. */
    account: (playerId: PlayerId) => runtime.runPromise(Ledger.use((ledger) => ledger.account(playerId))),
    /** Posts one entry to the ledger, as setup for a test. */
    post: (posting: Posting, now: number) => runtime.runPromise(Ledger.use((ledger) => ledger.post(posting, now))),
    /** Runs SQL against the database directly, as a script would. */
    query: <A>(statement: (sql: SqlClient.SqlClient) => Effect.Effect<ReadonlyArray<A>, unknown>) =>
      runtime.runPromise(SqlClient.SqlClient.use(statement)),
    /** Closes the database. */
    dispose: () => runtime.dispose(),
    /** The HTTP API, answering a standard Request with a standard Response, without opening a port. */
    app: (extra: Layer.Layer<never> = Layer.empty) => {
      const { handler, dispose } = HttpRouter.toWebHandler(
        Routes.pipe(Layer.provideMerge(layer), Layer.provide(extra), Layer.provide(HttpServer.layerServices)),
        { disableLogger: true, routerConfig, memoMap },
      );
      return {
        dispose,
        request: (path: string, init: RequestInit = {}) => handler(new Request(`http://leaf.test${path}`, init)),
      };
    },
  };
}

/** What a promise rejects with. Fails the test when the promise resolves instead. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject, but it resolved");
}
