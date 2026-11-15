import { DEFAULT_RULES } from "@sequoia-leaf/core";

import { fetchCredits } from "../backend/credits.ts";
import { syncCredits, type SyncMode, type SyncResult } from "./sync.ts";

/** A player asking for fresh quests triggers a sync at most this often. */
const ON_DEMAND_INTERVAL_MS = 15_000;

/**
 * Reads the backend's credit feed and pays what it lists. Returns undefined,
 * and does nothing, when the backend token is not configured.
 */
export async function runCreditSync(env: Env, mode: SyncMode, now: number): Promise<SyncResult | undefined> {
  const token = env.BACKEND_INTERNAL_TOKEN;
  if (token === undefined || token === "") {
    return undefined;
  }
  return syncCredits(
    env.DB,
    (from, to) => fetchCredits((url, init) => fetch(url, init), { baseUrl: env.BACKEND_URL, token }, from, to),
    DEFAULT_RULES,
    now,
    { mode },
  );
}

/**
 * Syncs on a player's request, so a raid they just finished shows up without
 * waiting for the next scheduled run. Requests share one allowance: whoever
 * asks first in a 15 second span starts a sync, and everyone else is answered
 * from what is stored. A failure is logged rather than shown to the player,
 * and still uses up the allowance; the scheduled run will catch up.
 */
export async function syncOnDemand(env: Env, now: number): Promise<void> {
  try {
    const claim = await env.DB.prepare(
      "UPDATE sync_state SET on_demand_at = ? WHERE name = 'credits' AND on_demand_at <= ?",
    )
      .bind(now, now - ON_DEMAND_INTERVAL_MS)
      .run();
    if (claim.meta.changes === 0) {
      return;
    }
    await runCreditSync(env, "recent", now);
  } catch (error) {
    console.error("The on-demand credit sync failed", error);
  }
}
