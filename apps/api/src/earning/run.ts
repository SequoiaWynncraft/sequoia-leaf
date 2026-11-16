import { DEFAULT_RULES } from "@sequoia-leaf/core";

import { fetchCredits } from "../backend/credits.ts";
import type { Services } from "../services.ts";
import { syncCredits, type SyncMode, type SyncResult } from "./sync.ts";

/** A player asking for fresh quests triggers a sync at most this often. */
const ON_DEMAND_INTERVAL_MS = 15_000;
/** The minute of each hour whose run re-reads the last week instead of the last few minutes. */
const DEEP_SYNC_MINUTE = 17;

/**
 * Reads the backend's credit feed and pays what it lists. Returns undefined,
 * and does nothing, when the backend token is not configured.
 */
export async function runCreditSync(services: Services, mode: SyncMode): Promise<SyncResult | undefined> {
  const { token, url } = services.backend;
  if (token === undefined) {
    return undefined;
  }
  return syncCredits(
    services.db,
    (from, to) => fetchCredits(services.fetcher, { baseUrl: url, token }, from, to),
    DEFAULT_RULES,
    services.now(),
    mode,
  );
}

/**
 * Syncs on a player's request, so a raid they just finished shows up without
 * waiting for the next scheduled run. Requests share one allowance: whoever
 * asks first in a 15 second span starts a sync, and everyone else is answered
 * from what is stored. A failure is logged rather than shown to the player,
 * and still uses up the allowance; the scheduled run will catch up.
 */
export async function syncOnDemand(services: Services): Promise<void> {
  try {
    const now = services.now();
    const claim = services.db
      .query("UPDATE sync_state SET on_demand_at = ? WHERE name = 'credits' AND on_demand_at <= ?")
      .run(now, now - ON_DEMAND_INTERVAL_MS);
    if (claim.changes === 0) {
      return;
    }
    await runCreditSync(services, "recent");
  } catch (error) {
    console.error("The on-demand credit sync failed", error);
  }
}

/** The scheduled run: a deep sync at minute 17 of each hour, a recent one every other minute. Never throws. */
export async function runScheduledSync(services: Services): Promise<void> {
  const mode = new Date(services.now()).getUTCMinutes() === DEEP_SYNC_MINUTE ? "deep" : "recent";
  try {
    const result = await runCreditSync(services, mode);
    if (result !== undefined) {
      console.log(JSON.stringify({ event: "credit_sync", mode, ...result }));
    }
  } catch (error) {
    console.error(`The scheduled ${mode} credit sync failed`, error);
  }
}
