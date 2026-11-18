import { type Activity, parsePlayerId, raidKeyForName } from "@sequoia-leaf/core";

import type { Fetcher } from "../services.ts";

export interface BackendConfig {
  /** Origin of sequoia-backend, such as `https://api.seqwawa.com`. */
  readonly baseUrl: string;
  /** The backend's internal API token. */
  readonly token: string;
}

/** The backend could not be read, or it returned something that is not a credit feed. */
export class CreditFeedError extends Error {
  override readonly name = "CreditFeedError";
}

const TIMEOUT_MS = 10_000;

/**
 * Reads what each identified player took part in during [from, to) from
 * sequoia-backend's `/internal/player-credits`. Times are milliseconds since
 * the Unix epoch.
 *
 * A war whose points are not calculated yet is left out; it is returned by a
 * later read once the backend has scored it. Anything else unexpected fails
 * the whole read, so a malformed feed is never partly paid out.
 */
export async function fetchCredits(
  fetcher: Fetcher,
  config: BackendConfig,
  from: number,
  to: number,
): Promise<Activity[]> {
  const url = new URL("/internal/player-credits", config.baseUrl);
  url.searchParams.set("from", new Date(from).toISOString());
  url.searchParams.set("to", new Date(to).toISOString());
  const response = await fetcher(url.toString(), {
    headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new CreditFeedError(`The backend answered the credit feed with HTTP ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body["raids"]) || !Array.isArray(body["wars"])) {
    throw new CreditFeedError("The credit feed has no raids or wars list");
  }
  const activities: Activity[] = [];
  for (const row of body["raids"]) {
    activities.push(raidActivity(row));
  }
  for (const row of body["wars"]) {
    const activity = warActivity(row);
    if (activity !== undefined) {
      activities.push(activity);
    }
  }
  return activities;
}

function raidActivity(row: unknown): Activity {
  if (!isRecord(row)) {
    throw new CreditFeedError("A raid credit is not an object");
  }
  const completionId = integer(row, "completion_id");
  const playerId = player(row);
  const raidName = text(row, "raid_name");
  return {
    kind: "raid",
    sourceKey: `raid:${completionId}:${playerId}`,
    playerId,
    occurredAt: instant(row, "completed_at"),
    seasonRating: integer(row, "season_rating"),
    raid: raidKeyForName(raidName),
    raidName,
  };
}

function warActivity(row: unknown): Activity | undefined {
  if (!isRecord(row)) {
    throw new CreditFeedError("A war credit is not an object");
  }
  const playerId = player(row);
  const activity = {
    kind: "war",
    sourceKey: `war:${integer(row, "war_submission_id")}:${playerId}`,
    playerId,
    occurredAt: instant(row, "completed_at"),
    seasonRating: integer(row, "season_rating"),
    territory: text(row, "territory"),
  } as const;
  const warPoints = row["war_points"];
  if (warPoints === null) {
    return undefined;
  }
  if (typeof warPoints !== "number" || !Number.isFinite(warPoints)) {
    throw new CreditFeedError("A war credit has war_points that is neither a number nor null");
  }
  // Left out, or null, when the backend does not know whether the territory was in Sequoia's claim.
  const inClaim = row["in_claim"];
  if (inClaim === undefined || inClaim === null) {
    return { ...activity, warPoints };
  }
  if (typeof inClaim !== "boolean") {
    throw new CreditFeedError("A war credit has in_claim that is neither true, false nor null");
  }
  return { ...activity, warPoints, inClaim };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value === "") {
    throw new CreditFeedError(`A credit has no ${field}`);
  }
  return value;
}

function integer(row: Record<string, unknown>, field: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new CreditFeedError(`A credit has ${field} that is not a whole number`);
  }
  return value;
}

function instant(row: Record<string, unknown>, field: string): number {
  const value = Date.parse(text(row, field));
  if (Number.isNaN(value)) {
    throw new CreditFeedError(`A credit has ${field} that is not a timestamp`);
  }
  return value;
}

function player(row: Record<string, unknown>): Activity["playerId"] {
  const playerId = parsePlayerId(text(row, "player_uuid"));
  if (playerId === undefined) {
    throw new CreditFeedError("A credit has player_uuid that is not a UUID");
  }
  return playerId;
}
