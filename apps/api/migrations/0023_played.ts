import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// How long each player has played each game, in milliseconds, and when Leaf last heard from them
// in it, by its own clock (`PlayStore.heard`).
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE played (
      player_id TEXT,
      game      TEXT,
      ms        INTEGER NOT NULL,
      seen_at   INTEGER NOT NULL,
      PRIMARY KEY (player_id, game)
    ) STRICT, WITHOUT ROWID
  `;
});
