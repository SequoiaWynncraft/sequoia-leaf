import { BunRuntime, BunSocket } from "@effect/platform-bun";
import { Cause, Effect, Exit, Layer, Logger, Metric, References, Runtime } from "effect";

import { serveLeaf, Services } from "./app.ts";
import { AppConfig } from "./config.ts";
import { BotPresence } from "./discord/presence.ts";
import { EveryMinute, Startup } from "./jobs.ts";
import { MetricsListener, RuntimeMetrics } from "./metrics.ts";
import { Stop } from "./stop.ts";

const Server = Layer.unwrap(
  Effect.gen(function* () {
    const { port } = yield* AppConfig;
    return serveLeaf({ port });
  }),
);

// A deploy stops the old container with SIGTERM once the new one is healthy, and the proxy in front
// sends the old one requests until it has exited, so Leaf stops at once, from the top down, each part
// once everything above it has: the server (live players are told Leaf is restarting, event streams
// end, requests in flight have a moment to finish and are then cut), the scheduled work (a sync cut
// short rolls back), and the services underneath them all, the database last, folding its write-ahead
// log back in. Should that take over two seconds, the process exits anyway. The bot's session on
// Discord's gateway closes with the rest, with 1000, which ends it.
Layer.mergeAll(
  Startup,
  MetricsListener,
  RuntimeMetrics,
  BotPresence.pipe(Layer.provide(BunSocket.layerWebSocketConstructor)),
  Stop.begins("server").pipe(
    Layer.provideMerge(Server),
    Layer.provideMerge(Stop.begins("scheduled_work")),
    Layer.provideMerge(EveryMinute),
  ),
).pipe(
  Layer.provide(Stop.begins("services").pipe(Layer.provideMerge(Services))),
  Layer.provide(Stop.layer({ deadline: "2 seconds", overdue: Effect.sync(() => process.exit(1)) })),
  Layer.provide(Logger.layer([Logger.consoleJson])),
  // Leaf's own metrics, which `/metrics` on the metrics listener serves.
  Layer.provide(Layer.succeed(Metric.MetricRegistry)(new Map())),
  // Nothing collects traces, so spans would only cost time on every request.
  Layer.provide(Layer.succeed(References.TracerEnabled)(false)),
  Layer.launch,
  BunRuntime.runMain({
    // A stop signal is a clean stop, not a failure.
    teardown: (exit, onExit) =>
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? onExit(0) : Runtime.defaultTeardown(exit, onExit),
  }),
);
