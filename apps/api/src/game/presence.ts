import { DAY_MS, type PlayerId } from "@sequoia-leaf/core";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/** A member counts as here this long after the game last said where they are. It says so every 30 seconds. */
export const PRESENT_FOR_MS = 90_000;

const Present = Schema.Struct({ playerId: Schema.String, username: Schema.String, place: Schema.String });
export type Present = typeof Present.Type;

/**
 * Who has the game open, and where they are in it. Each member has one row,
 * written whenever their game says where they are; rows a day old are
 * removed then. It is in the database rather than in memory because during a
 * deploy two containers answer side by side. A database failure is a defect.
 */
export class Presence extends Context.Service<
  Presence,
  {
    /** Records that a member is at `place` now, and lists everyone seen in the last 90 seconds, them included. */
    readonly arrive: (
      playerId: PlayerId,
      username: string,
      place: string,
      now: number,
    ) => Effect.Effect<readonly Present[]>;
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
      return Presence.of({
        arrive: (playerId, username, place, now) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                yield* sql`
                  INSERT INTO presence (player_id, username, place, seen_at) VALUES (${playerId}, ${username}, ${place}, ${now})
                  ON CONFLICT (player_id) DO UPDATE SET username = excluded.username, place = excluded.place, seen_at = excluded.seen_at
                `;
                yield* sql`DELETE FROM presence WHERE seen_at < ${now - DAY_MS}`;
                return yield* present(now - PRESENT_FOR_MS);
              }),
            )
            .pipe(Effect.orDie),
      });
    }),
  );
}
