import { deflateSync } from "node:zlib";

import type { Activity, PlayerId, Posting } from "@sequoia-leaf/core";
import { Clock, ConfigProvider, Effect, Layer, ManagedRuntime, Option, Redacted, References } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http";
import { SqlClient } from "effect/sql";

import { routerConfig, Routes, Stores } from "../src/app.ts";
import { AppConfig, type Settings, settings } from "../src/config.ts";
import { databaseAt } from "../src/db.ts";
import type { CreditSource } from "../src/earning/sync.ts";
import { Mojang, MojangError, type MojangProfile } from "../src/game/mojang.ts";
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

/** Stand-ins for services Leaf reaches outside the network stand-in. */
export interface Fakes {
  /** Mojang, for skins and names. Without it Leaf asks the network stand-in, as it would ask Mojang. */
  readonly mojang?: Mojang["Service"];
}

/**
 * Leaf around a fresh, fully migrated database in memory, a hand-set clock and
 * a stand-in network: the layer Leaf's code runs with, `run` to run an effect
 * against it, and `app` for its HTTP API. They all share the one database.
 */
export function testLeaf(clock: TestClock, fetcher: Fetcher, config: Partial<Settings> = {}, fakes: Fakes = {}) {
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
  const network = FetchHttpClient.layer.pipe(
    Layer.provideMerge(
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
    ),
  );
  const outside = Layer.mergeAll(
    Layer.succeed(AppConfig)(testConfig(config)),
    fakes.mojang === undefined ? Mojang.layer.pipe(Layer.provideMerge(network)) : Layer.succeed(Mojang)(fakes.mojang),
    network,
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
        /** Answers a request as the server would, such as one a browser sent. */
        handle: (request: Request) => handler(request),
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

/** A member's session as the backend's `/auth/web/me` describes it. `rank` null is someone not in the guild. */
export function sessionOf(player: PlayerId, username: string, rank: string | null = "CAPTAIN") {
  return {
    discord_id: "1",
    discord_username: username.toLowerCase(),
    minecraft_uuid: player,
    minecraft_username: username,
    expires_at: "2026-12-01T00:00:00Z",
    guild_rank: rank,
    website_admin: false,
  };
}

/** What a stand-in backend answers. Each is read when asked, so a test can change it as it goes. */
export interface Backend {
  /** The answer to `/auth/web/me`, by the session token Leaf sends; any other token is refused. */
  sessions: Record<string, () => Response>;
  /** The credit feed's answer for the window [from, to), in milliseconds. */
  credits: (from: number, to: number) => unknown;
  /** Sierra's awards feed's answer for the window [from, to). */
  awards: (from: number, to: number) => unknown;
  /** The path of every request it was sent, in order. */
  readonly calls: string[];
}

/** A stand-in sequoia-backend and Sierra, with no sessions and empty feeds until a test gives them some. */
export function fakeBackend(sessions: Record<string, () => Response> = {}): { backend: Backend; fetcher: Fetcher } {
  const backend: Backend = {
    sessions,
    credits: () => ({ raids: [], wars: [] }),
    awards: () => ({ awards: [] }),
    calls: [],
  };
  const fetcher: Fetcher = (url, init) => {
    const request = new Request(url, init);
    const path = new URL(request.url).pathname;
    backend.calls.push(path);
    if (path === "/auth/web/me") {
      const token = request.headers.get("Authorization")?.slice("Bearer ".length) ?? "";
      const answer = backend.sessions[token] ?? (() => Response.json({ error: "unauthorized" }, { status: 401 }));
      return Promise.resolve(answer());
    }
    const params = new URL(request.url).searchParams;
    const from = Date.parse(params.get("from") ?? "");
    const to = Date.parse(params.get("to") ?? "");
    if (path === "/internal/player-credits") {
      return Promise.resolve(Response.json(backend.credits(from, to)));
    }
    if (path === "/internal/v1/achievements/awards") {
      return Promise.resolve(Response.json(backend.awards(from, to)));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  return { backend, fetcher };
}

/** What a stand-in Mojang knows, and what it was asked. */
export interface FakeMojang {
  /** Each player's profile; a player missing is one Mojang knows nothing of. */
  readonly profiles: Map<string, MojangProfile>;
  /** The skin sheet at each address. */
  readonly textures: Map<string, Uint8Array>;
  /** While true, every request fails as if Mojang could not be reached. */
  down: boolean;
  /** Every request, as `profile <uuid>` or `texture <address>`. */
  readonly calls: string[];
  readonly service: Mojang["Service"];
}

/** A stand-in for Mojang that answers from what a test gives it, and never reaches the network. */
export function fakeMojang(): FakeMojang {
  const fake: FakeMojang = {
    profiles: new Map(),
    textures: new Map(),
    down: false,
    calls: [],
    service: {
      profile: (player) =>
        Effect.suspend(() => {
          fake.calls.push(`profile ${player}`);
          return fake.down
            ? Effect.fail(new MojangError({ message: "Mojang is down in this test" }))
            : Effect.succeed(Option.fromUndefinedOr(fake.profiles.get(player)));
        }),
      texture: (address) =>
        Effect.suspend(() => {
          fake.calls.push(`texture ${address.href}`);
          const png = fake.textures.get(address.href);
          return fake.down || png === undefined
            ? Effect.fail(new MojangError({ message: "No such texture in this test" }))
            : Effect.succeed(png);
        }),
    },
  };
  return fake;
}

/** One chunk of a PNG file: its length, type, data and checksum. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typed = new Uint8Array([...new TextEncoder().encode(type), ...data]);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typed, 4);
  view.setUint32(8 + data.length, Bun.hash.crc32(typed));
  return chunk;
}

/** A colour as red, green, blue and alpha. */
export type Rgba = readonly [number, number, number, number];

/**
 * A 64 by 64 skin sheet as a real PNG: the parts of a character, laid out as
 * Minecraft lays them out, in plain colours, with a face.
 */
export function skinPng(colours: {
  readonly skin: Rgba;
  readonly hair: Rgba;
  readonly shirt: Rgba;
  readonly legs: Rgba;
}) {
  const pixels = new Uint8Array(64 * 64 * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number, colour: Rgba) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        pixels.set(colour, (y * 64 + x) * 4);
      }
    }
  };
  fill(0, 0, 32, 16, colours.skin); // the head
  fill(8, 0, 16, 8, colours.hair); // its top
  for (const x of [0, 8, 16, 24]) {
    fill(x, 8, x + 8, 10, colours.hair); // a fringe all round
  }
  fill(24, 10, 32, 16, colours.hair); // the back of the head
  fill(9, 12, 11, 13, [255, 255, 255, 255]); // the eyes, on the face
  fill(13, 12, 15, 13, [255, 255, 255, 255]);
  fill(10, 12, 11, 13, [40, 40, 60, 255]);
  fill(13, 12, 14, 13, [40, 40, 60, 255]);
  fill(16, 16, 40, 32, colours.shirt); // the body
  fill(40, 16, 56, 32, colours.shirt); // the right arm
  fill(32, 48, 48, 64, colours.shirt); // the left arm
  fill(44, 28, 48, 32, colours.skin); // the hands
  fill(36, 60, 40, 64, colours.skin);
  fill(0, 16, 16, 32, colours.legs); // the right leg
  fill(16, 48, 32, 64, colours.legs); // the left leg
  const rows = new Uint8Array(64 * (1 + 64 * 4));
  for (let y = 0; y < 64; y++) {
    rows.set(pixels.subarray(y * 256, (y + 1) * 256), y * 257 + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 64);
  view.setUint32(4, 64);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits a channel, red, green, blue and alpha
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk("IHDR", header),
    ...pngChunk("IDAT", deflateSync(rows)),
    ...pngChunk("IEND", new Uint8Array(0)),
  ]);
}
