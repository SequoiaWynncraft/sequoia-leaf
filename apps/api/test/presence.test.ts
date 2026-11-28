import { describe, expect, it } from "bun:test";

import { Deferred, Effect, Exit, Layer, Logger, Queue, Random, Redacted, Scope } from "effect";
import { Socket } from "effect/socket";
import { TestClock } from "effect/testing";

import { AppConfig, type Settings } from "../src/config.ts";
import { BotPresence, GATEWAY } from "../src/discord/presence.ts";
import { testConfig } from "./support.ts";

const TOKEN = "the-bots-token";
/** The heartbeat interval the stand-in's Hello gives, in milliseconds. */
const INTERVAL = 1000;
const ACTIVITY = {
  clientId: "1576258873759760577",
  clientSecret: Redacted.make("secret"),
  botToken: Redacted.make(TOKEN),
  origin: "https://1576258873759760577.discordsays.com",
};
/** Dice that always fall at a half: the first beat half an interval in, every jitter 1x, a new session after 3 s. */
const HALF: Random.Random = { nextDoubleUnsafe: () => 0.5, nextIntUnsafe: () => 0 };

/** A frame on the gateway, either way. */
interface Payload {
  readonly op: number;
  readonly d?: unknown;
  readonly s?: number | null;
  readonly t?: string | null;
}

/** A connection Leaf made to the stand-in: the address it asked for, what it said, and how it closed. */
interface Connection {
  readonly path: string;
  readonly said: Queue.Queue<Payload>;
  readonly closed: Deferred.Deferred<number>;
  readonly send: (payload: Payload) => void;
  readonly close: (code: number, reason: string) => void;
}

/** A stand-in for Discord's gateway: a WebSocket server on this machine that says Hello to each connection. */
function standIn(interval: number) {
  const arrivals = Effect.runSync(Queue.unbounded<Connection>());
  const server = Bun.serve<Omit<Connection, "send" | "close">>({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, at) => {
      const url = new URL(request.url);
      const data = {
        path: `${url.pathname}${url.search}`,
        said: Effect.runSync(Queue.unbounded<Payload>()),
        closed: Deferred.makeUnsafe<number>(),
      };
      return at.upgrade(request, { data }) ? undefined : new Response(null, { status: 400 });
    },
    websocket: {
      open: (ws) => {
        const send = (payload: Payload) => void ws.send(JSON.stringify(payload));
        Queue.offerUnsafe(arrivals, { ...ws.data, send, close: (code, reason) => ws.close(code, reason) });
        send({ op: 10, d: { heartbeat_interval: interval }, s: null, t: null });
      },
      message: (ws, text) => void Queue.offerUnsafe(ws.data.said, JSON.parse(String(text))),
      close: (ws, code) => void Deferred.doneUnsafe(ws.data.closed, Exit.succeed(code)),
    },
  });
  return { arrivals, origin: `ws://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

/** What Leaf logged: each line's message and annotations. */
type Logged = { readonly message: unknown; readonly annotations: Readonly<Record<string, unknown>> };

/**
 * Leaf's bot presence against the stand-in, on a test clock, with every address of Discord's gateway
 * dialled to the stand-in. `run` builds the presence, runs `test`, and stops it.
 */
function harness(settings: Partial<Settings> = { activity: ACTIVITY }, interval = INTERVAL) {
  const gateway = standIn(interval);
  const dialed: string[] = [];
  const lines: Logged[] = [];
  const environment = Layer.mergeAll(
    Layer.succeed(AppConfig)(testConfig(settings)),
    Layer.succeed(Socket.WebSocketConstructor)((url) => {
      dialed.push(url);
      return new globalThis.WebSocket(url.replace(GATEWAY.origin, gateway.origin));
    }),
    Logger.layer([
      Logger.map(Logger.formatStructured, ({ message, annotations }) => void lines.push({ message, annotations })),
    ]),
    Layer.succeed(Random.Random)(HALF),
    TestClock.layer(),
  );
  const run = <A, E>(test: (stop: Effect.Effect<void>) => Effect.Effect<A, E, Layer.Success<typeof environment>>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        yield* Layer.buildWithScope(BotPresence, scope);
        const stop = Scope.close(scope, Exit.void);
        return yield* test(stop).pipe(Effect.ensuring(stop));
      }).pipe(Effect.provide(environment), Effect.ensuring(Effect.sync(() => void gateway.stop()))),
    );
  /** What Leaf logged of its gateway session. */
  const logged = () => lines.filter((line) => String(line.message).startsWith("discord_gateway"));
  return { run, gateway, dialed, logged };
}

/** What comes next, waited for in real time. */
const next = <A>(queue: Queue.Queue<A>) => TestClock.withLive(Effect.timeout(Queue.take(queue), "2 seconds"));
/** How a connection closed, waited for in real time. */
const closed = (connection: Connection) =>
  TestClock.withLive(Effect.timeout(Deferred.await(connection.closed), "2 seconds"));
/** A moment of real time, for Leaf to take in what the stand-in sent before the clock moves. */
const settle = TestClock.withLive(Effect.sleep("30 millis"));
/** How many things wait in a queue after a moment of real time: none, if nothing came. */
const waiting = <A>(queue: Queue.Queue<A>) => Effect.andThen(settle, Queue.size(queue));
/** Leaf's next connection, once it has opened and Leaf has said its first word on it. */
const connected = (gateway: ReturnType<typeof standIn>) =>
  Effect.gen(function* () {
    const connection = yield* next(gateway.arrivals);
    return { connection, first: yield* next(connection.said) };
  });

const ack = { op: 11 } satisfies Payload;
const ready = (gateway: ReturnType<typeof standIn>, s: number): Payload => ({
  op: 0,
  t: "READY",
  s,
  d: { v: 10, session_id: "session-one", resume_gateway_url: `${gateway.origin}/resume` },
});
/** A beat asked for, whose answer shows Leaf has taken in everything sent before it. */
const fence = (connection: Connection) =>
  Effect.suspend(() => {
    connection.send({ op: 1 });
    return next(connection.said);
  });

describe("the bot's presence on Discord's gateway", () => {
  it("identifies with the bot's token, no intents, and Playing Leaf", async () => {
    const { run, gateway } = harness();
    const { connection, first } = await run(() => connected(gateway));
    expect(connection.path).toBe("/?v=10&encoding=json");
    expect(first).toEqual({
      op: 2,
      d: {
        token: TOKEN,
        intents: 0,
        properties: { os: "linux", browser: "leaf", device: "leaf" },
        presence: { since: null, activities: [{ name: "Leaf", type: 0 }], status: "online", afk: false },
      },
    });
  });

  it("beats at Hello's interval, the first at a random point in the first, with the last sequence number", async () => {
    const { run, gateway } = harness();
    const beats = await run(() =>
      Effect.gen(function* () {
        const { connection } = yield* connected(gateway);
        const seen: unknown[] = [];
        yield* TestClock.adjust(INTERVAL / 2 - 1);
        seen.push(yield* waiting(connection.said));
        yield* TestClock.adjust(1);
        seen.push(yield* next(connection.said));
        connection.send(ack);
        connection.send(ready(gateway, 5));
        yield* fence(connection);
        yield* TestClock.adjust(INTERVAL - 1);
        seen.push(yield* waiting(connection.said));
        yield* TestClock.adjust(1);
        seen.push(yield* next(connection.said));
        return seen;
      }),
    );
    expect(beats).toEqual([0, { op: 1, d: null }, 0, { op: 1, d: 5 }]);
  });

  it("answers a beat asked for (op 1) at once", async () => {
    const { run, gateway } = harness();
    const answer = await run(() =>
      Effect.gen(function* () {
        const { connection } = yield* connected(gateway);
        connection.send({ op: 1 });
        return yield* next(connection.said);
      }),
    );
    expect(answer).toEqual({ op: 1, d: null });
  });

  it("closes a connection whose beat went unacked, keeping the session, and resumes it", async () => {
    const { run, gateway, logged } = harness();
    const resumed = await run(() =>
      Effect.gen(function* () {
        const { connection } = yield* connected(gateway);
        connection.send(ready(gateway, 3));
        yield* fence(connection);
        yield* TestClock.adjust(INTERVAL / 2);
        yield* next(connection.said);
        yield* TestClock.adjust(INTERVAL);
        const code = yield* closed(connection);
        yield* settle;
        yield* TestClock.adjust(1000);
        const again = yield* connected(gateway);
        return { code, path: again.connection.path, first: again.first };
      }),
    );
    expect(resumed).toEqual({
      code: 4000,
      path: "/resume?v=10&encoding=json",
      first: { op: 6, d: { token: TOKEN, session_id: "session-one", seq: 3 } },
    });
    expect(logged().map((line) => line.annotations)).toEqual([
      { session: "sessio" },
      { reason: "no heartbeat ack", resume: true },
    ]);
  });

  it("resumes with the session's id and last sequence number when Discord asks it to reconnect (op 7)", async () => {
    const { run, gateway } = harness();
    const resumed = await run(() =>
      Effect.gen(function* () {
        const { connection } = yield* connected(gateway);
        connection.send(ready(gateway, 1));
        connection.send({ op: 0, t: "GUILD_SOUNDBOARD_SOUNDS_UPDATE", s: 2, d: {} });
        connection.send({ op: 7, d: null });
        const code = yield* closed(connection);
        yield* settle;
        yield* TestClock.adjust(1000);
        const again = yield* connected(gateway);
        return { code, path: again.connection.path, first: again.first };
      }),
    );
    expect(resumed).toEqual({
      code: 4000,
      path: "/resume?v=10&encoding=json",
      first: { op: 6, d: { token: TOKEN, session_id: "session-one", seq: 2 } },
    });
  });

  it("identifies a new session at the gateway after an invalid session (op 9, false), 1 to 5 s later", async () => {
    const { run, gateway } = harness();
    const fresh = await run(() =>
      Effect.gen(function* () {
        const { connection } = yield* connected(gateway);
        connection.send(ready(gateway, 4));
        connection.send({ op: 9, d: false });
        yield* closed(connection);
        yield* settle;
        // The dice at a half: 3 s for the new session, then the first loss's 1 s.
        yield* TestClock.adjust(3999);
        const early = yield* waiting(gateway.arrivals);
        yield* TestClock.adjust(1);
        const again = yield* connected(gateway);
        return { early, path: again.connection.path, op: again.first.op, token: again.first.d };
      }),
    );
    expect(fresh).toMatchObject({ early: 0, path: "/?v=10&encoding=json", op: 2, token: { token: TOKEN } });
  });

  it("stops for good on a bad token (4004): one line, and never connects again", async () => {
    const { run, gateway, dialed, logged } = harness();
    const after = await run(() =>
      Effect.gen(function* () {
        const { connection } = yield* connected(gateway);
        connection.close(4004, "Authentication failed.");
        yield* settle;
        yield* TestClock.adjust("1 day");
        return yield* waiting(gateway.arrivals);
      }),
    );
    expect(after).toBe(0);
    expect(dialed).toHaveLength(1);
    expect(logged()).toEqual([
      { message: "discord_gateway_stopped", annotations: { code: 4004, reason: "Authentication failed." } },
    ]);
  });

  it("connects to nothing without the bot's token", async () => {
    const { run, gateway, dialed, logged } = harness({ activity: { ...ACTIVITY, botToken: undefined } });
    const arrived = await run(() => Effect.andThen(TestClock.adjust("1 hour"), waiting(gateway.arrivals)));
    expect(arrived).toBe(0);
    expect(dialed).toEqual([]);
    expect(logged()).toEqual([]);
  });

  it("closes its connection with 1000 when Leaf stops", async () => {
    const { run, gateway } = harness();
    const code = await run((stop) =>
      Effect.gen(function* () {
        const { connection } = yield* connected(gateway);
        connection.send(ready(gateway, 1));
        yield* fence(connection);
        yield* stop;
        return yield* closed(connection);
      }),
    );
    expect(code).toBe(1000);
  });

  it("waits 1 s, then 2 s, to connect again; after a session that ran two minutes, goes at once and from 1 s again", async () => {
    // A long interval, so the two minutes take one beat.
    const { run, gateway } = harness({ activity: ACTIVITY }, 100_000);
    const early = await run(() =>
      Effect.gen(function* () {
        const quiet: number[] = [];
        /** Drops the connection, and counts what arrived just before `wait`, before taking the next. */
        const dropAndWait = (connection: Connection, wait: number) =>
          Effect.gen(function* () {
            connection.close(4000, "drop");
            yield* closed(connection);
            yield* settle;
            yield* TestClock.adjust(wait - 1);
            quiet.push(yield* waiting(gateway.arrivals));
            yield* TestClock.adjust(1);
            return (yield* connected(gateway)).connection;
          });
        const first = (yield* connected(gateway)).connection;
        const second = yield* dropAndWait(first, 1000);
        const third = yield* dropAndWait(second, 2000);
        third.send(ready(gateway, 1));
        yield* fence(third);
        yield* TestClock.adjust(50_000);
        yield* next(third.said);
        third.send(ack);
        yield* fence(third);
        yield* TestClock.adjust(70_000);
        third.send({ op: 7, d: null });
        yield* closed(third);
        const fourth = yield* connected(gateway);
        expect(fourth.first.op).toBe(6);
        yield* dropAndWait(fourth.connection, 1000);
        return quiet;
      }),
    );
    expect(early).toEqual([0, 0, 0]);
  });
});
