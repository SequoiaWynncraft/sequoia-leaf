import type { Database } from "bun:sqlite";

import { Clock, ConfigProvider, Effect, Layer, Redacted, References } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http";

import { routerConfig, Routes } from "../src/app.ts";
import { AppConfig, type Settings, settings } from "../src/config.ts";
import { Db, openDatabase } from "../src/db.ts";

/** An empty, fully migrated database that lives in memory. */
export function testDatabase(): Database {
  return openDatabase(":memory:");
}

/** A clock that tests set by hand. */
export interface TestClock {
  now: number;
}

/** A stand-in for the network: answers each request Leaf makes. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

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
 * Leaf around a fresh database, a hand-set clock and a stand-in network, as the
 * layer Leaf's code runs with, and `run` to run an effect against it.
 */
export function testLeaf(clock: TestClock, fetcher: Fetcher, config: Partial<Settings> = {}) {
  const db = testDatabase();
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
  const layer = Layer.mergeAll(
    Layer.succeed(AppConfig)(testConfig(config)),
    Layer.succeed(Db)(db),
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
  return {
    db,
    layer,
    /** Runs an effect against this Leaf. */
    run: <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof layer>>): Promise<A> =>
      Effect.runPromise(Effect.provide(effect, layer)),
    /** The HTTP API, answering a standard Request with a standard Response, without opening a port. */
    app: (extra: Layer.Layer<never> = Layer.empty) => {
      const { handler, dispose } = HttpRouter.toWebHandler(
        Routes.pipe(Layer.provideMerge(layer), Layer.provide(extra), Layer.provide(HttpServer.layerServices)),
        { disableLogger: true, routerConfig },
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
