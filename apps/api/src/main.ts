import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Cause, Effect, Exit, Layer, Logger, Runtime } from "effect";
import { HttpRouter } from "effect/http";

import { routerConfig, Routes, Services } from "./app.ts";
import { AppConfig } from "./config.ts";
import { EveryMinute, Startup } from "./jobs.ts";

const Server = Layer.unwrap(
  Effect.gen(function* () {
    const { port } = yield* AppConfig;
    return HttpRouter.serve(Routes, { routerConfig, disableLogger: true }).pipe(
      Layer.provide(
        BunHttpServer.layer({
          port,
          // Seconds. An event stream writes a keep-alive every 20, well inside this.
          idleTimeout: 60,
          // A deploy stops the old container with SIGTERM and kills it ten seconds later. Requests in
          // flight finish first; an event stream is cut, and its client reconnects to the new one.
          gracefulShutdownTimeout: "8 seconds",
        }),
      ),
    );
  }),
);

// The services are provided underneath the server and the jobs, so the database
// is closed, folding its write-ahead log back in, only after both have stopped.
Layer.mergeAll(Startup, Server, EveryMinute).pipe(
  Layer.provide(Services),
  Layer.provide(Logger.layer([Logger.consoleJson])),
  Layer.launch,
  BunRuntime.runMain({
    // A stop signal is a clean stop, not a failure.
    teardown: (exit, onExit) =>
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? onExit(0) : Runtime.defaultTeardown(exit, onExit),
  }),
);
