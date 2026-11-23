import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Who is about comes from each player's newest visit, one record of where they are, instead of a
// `presence` row written beside it. Whether a player's character stays in town after they go moves
// to their row in `players_seen` (`stay`, yes until their page says), from their presence row where
// they have one; and visits get an index by when they were last heard of, for the newest of the
// last day. `presence` is left as it is, unread: a Leaf of the last version, beside this one in a
// deploy, still writes it. A later migration removes it.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE players_seen ADD COLUMN stay INTEGER NOT NULL DEFAULT 1 CHECK (stay IN (0, 1))`;
  yield* sql`
    UPDATE players_seen SET stay = (SELECT stay FROM presence WHERE presence.player_id = players_seen.player_id)
    WHERE player_id IN (SELECT player_id FROM presence)
  `;
  yield* sql`CREATE INDEX visits_by_heard ON visits (heard_at)`;
});
