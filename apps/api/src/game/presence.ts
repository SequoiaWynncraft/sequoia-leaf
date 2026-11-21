import { DAY_MS, type PlayerId } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/** A member counts as here this long after the game last said where they are. It says so every 30 seconds. */
export const PRESENT_FOR_MS = 90_000;
/** The most members listed as resting in one answer. */
export const RESTING_MOST = 24;

const Present = Schema.Struct({ playerId: Schema.String, username: Schema.String, place: Schema.String });
export type Present = typeof Present.Type;

const Resting = Schema.Struct({
  playerId: Schema.String,
  username: Schema.String,
  place: Schema.String,
  seenAt: Schema.Number,
});
export type Resting = typeof Resting.Type;

/** Who is about: those here now, and those gone in the last day whose characters stay in town. */
export interface Here {
  readonly present: readonly Present[];
  readonly resting: readonly Resting[];
}

/**
 * Who has the game open, and where they are in it. Each member has one row,
 * written whenever their game says where they are (and whether their
 * character may stay in town after they go); rows a day old are removed then.
 * It is in the database rather than in memory because during a deploy two
 * containers answer side by side. A database failure is a defect.
 */
export class Presence extends Context.Service<
  Presence,
  {
    /**
     * Records that a member is at `place` now, and whether they would stay; lists everyone seen in
     * the last 90 seconds, them included, and those seen between then and a day ago who stay.
     */
    readonly arrive: (
      playerId: PlayerId,
      username: string,
      place: string,
      stay: boolean,
      now: number,
    ) => Effect.Effect<Here>;
  }
>()("leaf/Presence") {
  static readonly layer = Layer.effect(
    Presence,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const present = SqlSchema.findAll({
        Request: Schema.Int,
        Result: Present,
        execute: (since) => sql`
          SELECT player_id AS playerId, username, place FROM presence WHERE seen_at > ${since} ORDER BY username, player_id
        `,
      });
      const resting = SqlSchema.findAll({
        Request: Schema.Struct({ before: Schema.Int, since: Schema.Int }),
        Result: Resting,
        execute: ({ before, since }) => sql`
          SELECT player_id AS playerId, username, place, seen_at AS seenAt FROM presence
          WHERE seen_at <= ${before} AND seen_at >= ${since} AND stay = 1
          ORDER BY seen_at DESC, player_id
          LIMIT ${RESTING_MOST}
        `,
      });
      return Presence.of({
        arrive: (playerId, username, place, stay, now) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                yield* sql`
                  INSERT INTO presence (player_id, username, place, seen_at, stay) VALUES (${playerId}, ${username}, ${place}, ${now}, ${stay ? 1 : 0})
                  ON CONFLICT (player_id) DO UPDATE SET username = excluded.username, place = excluded.place, seen_at = excluded.seen_at, stay = excluded.stay
                `;
                yield* sql`DELETE FROM presence WHERE seen_at < ${now - DAY_MS}`;
                return {
                  present: yield* present(now - PRESENT_FOR_MS),
                  resting: yield* resting({ before: now - PRESENT_FOR_MS, since: now - DAY_MS }),
                };
              }),
            )
            .pipe(Effect.orDie),
      });
    }),
  );
}
