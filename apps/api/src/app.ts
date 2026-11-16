import { Hono } from "hono";

import { DEFAULT_STREAM_TUNING, meRoutes, type StreamTuning } from "./http/me.ts";
import type { Services } from "./services.ts";

/** The HTTP API. */
export function createApp(services: Services, streamTuning: StreamTuning = DEFAULT_STREAM_TUNING): Hono {
  const app = new Hono();

  // Healthy means the database answers, since nothing works without it.
  app.get("/healthz", (c) => {
    services.db.query("SELECT 1").get();
    return c.json({ status: "ok" });
  });

  app.route("/v1/me", meRoutes(services, streamTuning));

  // Every error response has the same shape: a stable machine-readable `code`
  // and a human-readable `message`. Clients branch on `code` only.
  app.notFound((c) => c.json({ code: "not_found", message: "No such route" }, 404));

  app.onError((error, c) => {
    console.error(error);
    return c.json({ code: "internal_error", message: "Something went wrong" }, 500);
  });

  return app;
}
