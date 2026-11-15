import { Hono } from "hono";

import { runCreditSync } from "./earning/run.ts";
import { me } from "./http/me.ts";

export const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.route("/v1/me", me);

// Every error response has the same shape: a stable machine-readable `code`
// and a human-readable `message`. Clients branch on `code` only.
app.notFound((c) => c.json({ code: "not_found", message: "No such route" }, 404));

app.onError((error, c) => {
  console.error(error);
  return c.json({ code: "internal_error", message: "Something went wrong" }, 500);
});

/** The cron expression of the hourly re-read of the last week; the other trigger is the every-minute run. */
const DEEP_SYNC_CRON = "17 * * * *";

async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  const mode = controller.cron === DEEP_SYNC_CRON ? "deep" : "recent";
  const result = await runCreditSync(env, mode, Date.now());
  if (result === undefined) {
    console.warn("Skipping the credit sync: BACKEND_INTERNAL_TOKEN is not set");
    return;
  }
  console.log(JSON.stringify({ event: "credit_sync", mode, ...result }));
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
