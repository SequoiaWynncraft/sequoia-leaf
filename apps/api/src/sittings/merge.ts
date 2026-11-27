/**
 * The raid's sittings when one player is taken into another (`players/merge.ts`). A merge waits
 * while either player is seated at a sitting that is not over: a running sitting's state is never
 * rewritten. Otherwise their places move to the player kept, as `standings` do, the better place
 * where both finished the same sitting; and the answers to their commands at sittings
 * (`play_commands`, under `ANSWERS`, keyed by player and command id, not by sitting or seat) move as
 * the play service's do, but for one whose id the kept player used too, which is let go.
 */
import type { PlayerId } from "@sequoia-leaf/core";
import { Effect, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/sql";

import { ANSWERS } from "./writes.ts";

/** Why a merge waits for a player at a sitting that is not over. */
export const LIVE_TABLE = "Finish or leave your live table first.";

/** Whether either player is seated at a sitting that is not over. */
export const seatedEither = (sql: SqlClient.SqlClient, from: PlayerId, into: PlayerId) =>
  SqlSchema.findAll({
    Request: Schema.Array(Schema.String),
    Result: Schema.Struct({ player: Schema.String }),
    execute: (players) => sql`SELECT player_id AS player FROM raid_sitting_seats WHERE ${sql.in("player_id", players)}`,
  })([from, into]).pipe(Effect.map((rows) => rows.length > 0));

/** Moves `from`'s places and answers at sittings to `into`. */
export const moveSittings = (sql: SqlClient.SqlClient, from: PlayerId, into: PlayerId) =>
  Effect.gen(function* () {
    yield* sql`
      INSERT INTO raid_sitting_places (sitting, player_id, place, seats, ended)
      SELECT sitting, ${into}, place, seats, ended FROM raid_sitting_places WHERE player_id = ${from}
      ON CONFLICT (sitting, player_id) DO UPDATE SET place = min(place, excluded.place)
    `;
    yield* sql`DELETE FROM raid_sitting_places WHERE player_id = ${from}`;
    yield* sql`UPDATE OR IGNORE play_commands SET player_id = ${into} WHERE player_id = ${from} AND game = ${ANSWERS}`;
    yield* sql`DELETE FROM play_commands WHERE player_id = ${from} AND game = ${ANSWERS}`;
  });
