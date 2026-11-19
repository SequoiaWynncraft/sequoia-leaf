import { type Activity, raidKeyForName } from "@sequoia-leaf/core";
import { Effect, Schema } from "effect";
import type { HttpClient } from "effect/http";

import { type FeedConfig, type FeedError, FeedInstant, FeedPlayerId, readFeedWindow } from "../feeds.ts";

/** One raid party member's credit, as sequoia-backend's `/internal/player-credits` lists it. */
const RaidCredit = Schema.Struct({
  completion_id: Schema.Int,
  completed_at: FeedInstant,
  raid_name: Schema.NonEmptyString,
  /** This member's share of the rating the raid earned the guild. */
  season_rating: Schema.Int,
  player_uuid: FeedPlayerId,
});

/** One war participant's credit. */
const WarCredit = Schema.Struct({
  war_submission_id: Schema.Int,
  completed_at: FeedInstant,
  territory: Schema.NonEmptyString,
  season_rating: Schema.Int,
  /** Null while the backend has not scored the war yet. */
  war_points: Schema.NullOr(Schema.Finite),
  /** Whether the territory was in Sequoia's claim; left out, or null, when the backend does not know. */
  in_claim: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  player_uuid: FeedPlayerId,
});

const CreditFeed = Schema.Struct({ raids: Schema.Array(RaidCredit), wars: Schema.Array(WarCredit) });

/**
 * What each identified player took part in during [from, to), as activities.
 * A war whose points are not calculated yet is left out; a later read returns
 * it once the backend has scored it. Anything else unexpected fails the read.
 */
export const readCredits = (
  config: FeedConfig,
  from: number,
  to: number,
): Effect.Effect<Activity[], FeedError, HttpClient.HttpClient> =>
  readFeedWindow("credits", config, "/internal/player-credits", CreditFeed, from, to).pipe(
    Effect.map(({ raids, wars }) => raids.map(raidActivity).concat(wars.flatMap(warActivity))),
  );

function raidActivity(row: typeof RaidCredit.Type): Activity {
  return {
    kind: "raid",
    sourceKey: `raid:${row.completion_id}:${row.player_uuid}`,
    playerId: row.player_uuid,
    occurredAt: row.completed_at,
    seasonRating: row.season_rating,
    raid: raidKeyForName(row.raid_name),
    raidName: row.raid_name,
  };
}

/** None while the backend has not scored the war. */
function warActivity(row: typeof WarCredit.Type): Activity[] {
  if (row.war_points === null) {
    return [];
  }
  const war = {
    kind: "war",
    sourceKey: `war:${row.war_submission_id}:${row.player_uuid}`,
    playerId: row.player_uuid,
    occurredAt: row.completed_at,
    seasonRating: row.season_rating,
    territory: row.territory,
    warPoints: row.war_points,
  } as const;
  return [row.in_claim === undefined || row.in_claim === null ? war : { ...war, inClaim: row.in_claim }];
}
