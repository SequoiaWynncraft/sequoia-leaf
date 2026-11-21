import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Cause, Effect, Exit, Layer, Logger, References, Runtime } from "effect";
import { HttpRouter } from "effect/http";

import { routerConfig, Routes, Services } from "./app.ts";
import { AppConfig } from "./config.ts";
import { EveryMinute, Startup } from "./jobs.ts";
import { LIVE_SOCKETS, LiveFarewell } from "./live/live.ts";

const Server = Layer.unwrap(
  Effect.gen(function* () {
    const { port } = yield* AppConfig;
    return HttpRouter.serve(Routes, { routerConfig, disableLogger: true }).pipe(
      Layer.provide(
        BunHttpServer.layer({
          port,
          // No route reads more than a save's body; Leaf refuses anything near this itself.
          maxRequestBodySize: 1024 * 1024,
          // Seconds. An event stream writes a keep-alive every 20, well inside this.
          idleTimeout: 60,
          // A deploy stops the old container with SIGTERM and kills it ten seconds later. Requests in
          // flight finish first; an event stream is cut, and its client reconnects to the new one. A
          // live connection is told Leaf is restarting, and reconnects too.
          gracefulShutdownTimeout: "8 seconds",
          websocket: LIVE_SOCKETS,
        }),
      ),
    );
  }),
);

// The services are provided underneath the server and the jobs, so the database
// is closed, folding its write-ahead log back in, only after both have stopped.
// The live rooms say farewell before the server stops, so they sit on top of it.
Layer.mergeAll(Startup, LiveFarewell.pipe(Layer.provideMerge(Server)), EveryMinute).pipe(
  Layer.provide(Services),
  Layer.provide(Logger.layer([Logger.consoleJson])),
  // Nothing collects traces, so spans would only cost time on every request.
  Layer.provide(Layer.succeed(References.TracerEnabled)(false)),
  Layer.launch,
  BunRuntime.runMain({
    // A stop signal is a clean stop, not a failure.
    teardown: (exit, onExit) =>
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? onExit(0) : Runtime.defaultTeardown(exit, onExit),
  }),
);
