import { type Activity, leafForActivity, type PlayerId, type Rules } from "@sequoia-leaf/core";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { Events } from "../events/store.ts";
import { PlayerUuid } from "../wire.ts";
import { Grove } from "./store.ts";

/**
 * What the Grove takes from activities the credit sync just recorded, in the
 * sync's transaction:
 *
 * - Each credited raid, one that paid Leaf, adds Bloom to the member's tree,
 *   keyed by the raid's own ledger key, so a raid read again adds none. A full
 *   Bloom gives a cone, once per cycle.
 * - Each raid hangs a lantern in the Forest, and each war is a win for the guild:
 *   every member it credits is told, with the whole party as Leaf knows it. A
 *   member credited later, when the backend matches their name afterwards, is
 *   told then, and the others are not told twice.
 */
export const growGroveFrom = Effect.fn("growGroveFrom")(function* (
  activities: readonly Activity[],
  rules: Rules,
  now: number,
) {
  const grove = yield* Grove;
  const events = yield* Events;
  const sql = yield* SqlClient.SqlClient;
  const partyOf = SqlSchema.findAll({
    Request: Schema.String,
    Result: Schema.Struct({ playerId: PlayerUuid }),
    execute: (eventKey) =>
      sql`SELECT DISTINCT player_id AS playerId FROM activities WHERE event_key = ${eventKey} ORDER BY player_id`,
  });

  for (const activity of activities) {
    if (activity.kind !== "raid" || leafForActivity(activity, rules.earning) === 0) {
      continue;
    }
    const cycles = yield* grove.addBloom(
      activity.playerId,
      activity.sourceKey,
      "raid",
      rules.grove.raidBloom,
      now,
      rules.grove,
    );
    for (const cycle of cycles) {
      yield* events.insert(activity.playerId, { type: "grove.bloomed", data: { source: "raid", cycle } }, now);
    }
  }

  const byEvent = Map.groupBy(activities, (activity) => activity.eventKey);
  for (const [eventKey, credited] of byEvent) {
    const party: PlayerId[] = (yield* partyOf(eventKey).pipe(Effect.orDie)).map((row) => row.playerId);
    for (const activity of credited) {
      const occurredAt = new Date(activity.occurredAt).toISOString();
      yield* events.insert(
        activity.playerId,
        activity.kind === "raid"
          ? {
              type: "grove.raid_lantern",
              data: { raid: eventKey, raid_name: activity.raidName, party, occurred_at: occurredAt },
            }
          : {
              type: "guild.war_win",
              data: {
                war: eventKey,
                territory: activity.territory,
                players: party,
                occurred_at: occurredAt,
                ...(activity.inClaim === undefined ? {} : { in_claim: activity.inClaim }),
              },
            },
        now,
      );
    }
  }
});
