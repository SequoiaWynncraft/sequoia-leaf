import { DEFAULT_RULES } from "@sequoia-leaf/core";

import { scheduledMode } from "../earning/run.ts";
import type { Services } from "../services.ts";
import type { SyncMode, SyncResult } from "../sync/windowed.ts";
import { fetchAwards } from "./feed.ts";
import { syncAchievements } from "./sync.ts";

/**
 * Reads Sierra's awards feed and pays what it lists. Returns undefined, and
 * does nothing, when Sierra's address or the internal token is not configured.
 */
export async function runAchievementSync(services: Services, mode: SyncMode): Promise<SyncResult | undefined> {
  const { url, token } = services.sierra;
  if (url === undefined || token === undefined) {
    return undefined;
  }
  return syncAchievements(
    services.db,
    (from, to) => fetchAwards(services.fetcher, { baseUrl: url, token }, from, to),
    DEFAULT_RULES,
    services.now(),
    mode,
  );
}

/** The scheduled run, on the same deep and recent rhythm as the credit sync. Never throws. */
export async function runScheduledAchievementSync(services: Services): Promise<void> {
  const mode = scheduledMode(services.now());
  try {
    const result = await runAchievementSync(services, mode);
    if (result !== undefined) {
      console.log(JSON.stringify({ event: "achievement_sync", mode, ...result }));
    }
  } catch (error) {
    console.error(`The scheduled ${mode} achievement sync failed`, error);
  }
}
