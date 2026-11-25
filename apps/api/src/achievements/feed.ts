import type { ReportedAward } from "@sequoia-leaf/core";
import { Effect, Schema } from "effect";
import type { HttpClient } from "effect/http";

import { type FeedConfig, type FeedError, readFeedWindow } from "../feeds.ts";
import { IsoTime, MinecraftUuid } from "../wire.ts";

/** Text that is left out, null, or a non-empty string. */
const OptionalText = Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString));

/** One milestone a player reached, as Sierra's `/internal/v1/achievements/awards` lists it. */
const Award = Schema.Struct({
  award_id: Schema.NonEmptyString,
  player_uuid: MinecraftUuid,
  achievement_key: Schema.NonEmptyString,
  milestone_id: OptionalText,
  tier: OptionalText,
  threshold: Schema.optionalKey(Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))),
  label: OptionalText,
  earned_at: IsoTime,
});

const AwardFeed = Schema.Struct({ awards: Schema.Array(Award) });

/**
 * The achievement milestones players reached during [from, to). Anything
 * unexpected fails the whole read, so a malformed feed is never partly paid out.
 */
export const readAwards = (
  config: FeedConfig,
  from: number,
  to: number,
): Effect.Effect<ReportedAward[], FeedError, HttpClient.HttpClient> =>
  readFeedWindow("awards", config, "/internal/v1/achievements/awards", AwardFeed, from, to).pipe(
    Effect.map(({ awards }) =>
      awards.map((row) => ({
        awardId: row.award_id,
        account: row.player_uuid,
        ladder: row.achievement_key,
        milestoneId: row.milestone_id ?? null,
        tier: row.tier ?? null,
        threshold: row.threshold ?? null,
        label: row.label ?? null,
        earnedAt: row.earned_at,
      })),
    ),
  );
