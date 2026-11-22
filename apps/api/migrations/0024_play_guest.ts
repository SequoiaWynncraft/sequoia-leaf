import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Whether the player was a guest when their state in a game was last written, so that whatever
// Leaf writes of it while they are away (a yard tended, where it stands) says the same. Each state
// stored before takes it from where it stands, or else from the player as last seen.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE play_state ADD COLUMN guest INTEGER NOT NULL DEFAULT 0 CHECK (guest IN (0, 1))`;
  yield* sql`
    UPDATE play_state SET guest = coalesce(
      (SELECT guest FROM standings AS s WHERE s.player_id = play_state.player_id AND s.game = play_state.game),
      (SELECT guest FROM players_seen AS p WHERE p.player_id = play_state.player_id),
      0
    )
  `;
});
