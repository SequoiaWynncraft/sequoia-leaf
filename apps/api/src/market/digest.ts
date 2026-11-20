import { DAY_MS, type MarketRules } from "@sequoia-leaf/core";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

import { GuildEvents } from "../guild/store.ts";
import { Market } from "./store.ts";

/**
 * Tells the guild feed how many listings members made in each window of
 * `digestMs` that ended in the last day, once per window and only for windows
 * with any. The feed hears a count, never a listing's words, so nobody can post
 * to the Forest by listing. A window missed while Leaf was stopped is told at
 * the next run. Answers how many windows it told.
 */
export const digestListings = Effect.fn("digestListings")(function* (now: number, rules: MarketRules) {
  const sql = yield* SqlClient.SqlClient;
  const market = yield* Market;
  const feed = yield* GuildEvents;
  // Windows from the epoch, so every run cuts them the same way; the one under way hasn't ended.
  const end = Math.floor(now / rules.digestMs) * rules.digestMs;
  const windows = (yield* market.listedPerWindow(end - DAY_MS, end, rules.digestMs)).map(({ start, count }) => ({
    start,
    count,
    key: `market:listings:${new Date(start).toISOString()}`,
  }));
  const told = yield* feed.recorded(windows.map((window) => window.key));
  const untold = windows.filter((window) => !told.has(window.key));
  if (untold.length === 0) {
    return 0;
  }
  yield* sql
    .withTransaction(
      Effect.forEach(untold, (window) =>
        feed.insert(
          window.key,
          {
            type: "market.listings_added",
            data: {
              count: window.count,
              from: new Date(window.start).toISOString(),
              to: new Date(window.start + rules.digestMs).toISOString(),
            },
          },
          now,
        ),
      ),
    )
    .pipe(Effect.orDie);
  return untold.length;
});
