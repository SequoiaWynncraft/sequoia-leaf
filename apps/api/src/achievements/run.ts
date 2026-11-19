import { DEFAULT_RULES } from "@sequoia-leaf/core";
import { Clock, Effect } from "effect";

import { AppConfig } from "../config.ts";
import { Db } from "../db.ts";
import type { SyncMode } from "../sync/windowed.ts";
import { readAwards } from "./feed.ts";
import { syncAchievements } from "./sync.ts";

/**
 * Reads Sierra's awards feed and pays what it lists. Answers undefined, and
 * does nothing, when Sierra's address or the internal token is not configured.
 */
export const runAchievementSync = Effect.fnUntraced(function* (mode: SyncMode) {
  const { sierraUrl, backendToken } = yield* AppConfig;
  if (sierraUrl === undefined || backendToken === undefined) {
    return undefined;
  }
  const feed = { baseUrl: sierraUrl, token: backendToken };
  return yield* syncAchievements(
    yield* Db,
    (from, to) => readAwards(feed, from, to),
    DEFAULT_RULES,
    yield* Clock.currentTimeMillis,
    mode,
  );
});
