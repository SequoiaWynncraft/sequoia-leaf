import { DEFAULT_RULES } from "@sequoia-leaf/core";
import { Hono } from "hono";

import { fetchCredits } from "./backend/credits.ts";
import { syncCredits } from "./earning/sync.ts";

export const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.json({ status: "ok" }));

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
  const token = env.BACKEND_INTERNAL_TOKEN;
  if (token === undefined || token === "") {
    console.warn("Skipping the credit sync: BACKEND_INTERNAL_TOKEN is not set");
    return;
  }
  const mode = controller.cron === DEEP_SYNC_CRON ? "deep" : "recent";
  const result = await syncCredits(
    env.DB,
    (from, to) => fetchCredits((url, init) => fetch(url, init), { baseUrl: env.BACKEND_URL, token }, from, to),
    DEFAULT_RULES.earning,
    Date.now(),
    { mode },
  );
  console.log(JSON.stringify({ event: "credit_sync", mode, ...result }));
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
