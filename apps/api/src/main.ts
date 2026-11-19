import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Cause, Exit, Layer, Logger, Runtime } from "effect";
import { HttpRouter } from "effect/http";

import { routerConfig, Routes, services } from "./app.ts";
import { readConfig } from "./config.ts";
import { EveryMinute, Startup } from "./jobs.ts";

const config = readConfig(Bun.env);

const Server = HttpRouter.serve(Routes, { routerConfig, disableLogger: true }).pipe(
  Layer.provide(
    BunHttpServer.layer({
      port: config.port,
      // Seconds. An event stream with nothing to send writes a keep-alive every 20, well inside this.
      idleTimeout: 60,
      // A deploy stops the old container with SIGTERM and kills it ten seconds later. Requests in
      // flight finish first; an event stream is cut, and its client reconnects to the new one.
      gracefulShutdownTimeout: "8 seconds",
    }),
  ),
);

// The services are provided underneath the server and the jobs, so the database
// is closed, folding its write-ahead log back in, only after both have stopped.
Layer.mergeAll(Startup, Server, EveryMinute).pipe(
  Layer.provide(services(config)),
  Layer.provide(Logger.layer([Logger.consoleJson])),
  Layer.launch,
  BunRuntime.runMain({
    // A stop signal is a clean stop, not a failure.
    teardown: (exit, onExit) =>
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? onExit(0) : Runtime.defaultTeardown(exit, onExit),
  }),
);
