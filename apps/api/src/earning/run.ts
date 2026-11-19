import { DEFAULT_RULES } from "@sequoia-leaf/core";
import { Clock, Effect } from "effect";

import { readCredits } from "../backend/credits.ts";
import { AppConfig } from "../config.ts";
import { Db } from "../db.ts";
import { syncCredits, type SyncMode } from "./sync.ts";

/** A player asking for fresh quests triggers a sync at most this often. */
const ON_DEMAND_INTERVAL_MS = 15_000;

/**
 * Reads the backend's credit feed and pays what it lists. Answers undefined,
 * and does nothing, when the backend token is not configured.
 */
export const runCreditSync = Effect.fnUntraced(function* (mode: SyncMode) {
  const { backendUrl, backendToken } = yield* AppConfig;
  if (backendToken === undefined) {
    return undefined;
  }
  const feed = { baseUrl: backendUrl, token: backendToken };
  return yield* syncCredits(
    yield* Db,
    (from, to) => readCredits(feed, from, to),
    DEFAULT_RULES,
    yield* Clock.currentTimeMillis,
    mode,
  );
});

/**
 * Syncs on a player's request, so a raid they just finished shows up without
 * waiting for the next scheduled run. Requests share one allowance: whoever
 * asks first in a 15 second span starts a sync, and everyone else is answered
 * from what is stored. A failure is logged rather than shown to the player,
 * and still uses up the allowance; the scheduled run will catch up.
 */
export const syncOnDemand = Effect.gen(function* () {
  const db = yield* Db;
  const now = yield* Clock.currentTimeMillis;
  const claim = db
    .query("UPDATE sync_state SET on_demand_at = ? WHERE name = 'credits' AND on_demand_at <= ?")
    .run(now, now - ON_DEMAND_INTERVAL_MS);
  if (claim.changes > 0) {
    yield* runCreditSync("recent");
  }
}).pipe(Effect.catchCause((cause) => Effect.logError("The on-demand credit sync failed", cause)));
