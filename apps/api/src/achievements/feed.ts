import { type AchievementAward, parsePlayerId } from "@sequoia-leaf/core";

import type { Fetcher } from "../services.ts";

export interface SierraConfig {
  /** Origin of Sierra's internal API, such as `http://sequoia-sierra:8082`. */
  readonly baseUrl: string;
  /** The internal API token Sierra shares with sequoia-backend. */
  readonly token: string;
}

/** Sierra could not be read, or it returned something that is not an awards feed. */
export class AwardFeedError extends Error {
  override readonly name = "AwardFeedError";
}

const TIMEOUT_MS = 10_000;

/**
 * Reads the achievement milestones players reached during [from, to) from
 * Sierra's `/internal/v1/achievements/awards`. Times are milliseconds since the
 * Unix epoch. Anything unexpected fails the whole read, so a malformed feed is
 * never partly paid out.
 */
export async function fetchAwards(
  fetcher: Fetcher,
  config: SierraConfig,
  from: number,
  to: number,
): Promise<AchievementAward[]> {
  const url = new URL("/internal/v1/achievements/awards", config.baseUrl);
  url.searchParams.set("from", new Date(from).toISOString());
  url.searchParams.set("to", new Date(to).toISOString());
  const response = await fetcher(url.toString(), {
    headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new AwardFeedError(`Sierra answered the awards feed with HTTP ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body["awards"])) {
    throw new AwardFeedError("The awards feed has no awards list");
  }
  return body["awards"].map(award);
}

function award(row: unknown): AchievementAward {
  if (!isRecord(row)) {
    throw new AwardFeedError("An award is not an object");
  }
  const playerId = parsePlayerId(text(row, "player_uuid"));
  if (playerId === undefined) {
    throw new AwardFeedError("An award has player_uuid that is not a UUID");
  }
  const earnedAt = Date.parse(text(row, "earned_at"));
  if (Number.isNaN(earnedAt)) {
    throw new AwardFeedError("An award has earned_at that is not a timestamp");
  }
  return {
    awardId: text(row, "award_id"),
    playerId,
    ladder: text(row, "achievement_key"),
    milestoneId: optionalText(row, "milestone_id"),
    tier: optionalText(row, "tier"),
    count: optionalCount(row, "count"),
    earnedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value === "") {
    throw new AwardFeedError(`An award has no ${field}`);
  }
  return value;
}

function optionalText(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value === "") {
    throw new AwardFeedError(`An award has ${field} that is neither text nor null`);
  }
  return value;
}

function optionalCount(row: Record<string, unknown>, field: string): number | null {
  const value = row[field];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new AwardFeedError(`An award has ${field} that is neither a whole number nor null`);
  }
  return value;
}
