import { Clock, Effect } from "effect";
import { SqlClient } from "effect/sql";

// What each player's state in a game tells the town (`Game.postcard`), as JSON: the line for the
// door to the game, and the Coins waiting there. Leaf writes it in the transaction that writes the
// state, whenever it is not what the state says, so the two never disagree; the town reads a
// player's few rows by their key. A state stored before this has none until Leaf next has it in
// hand, so each of the Works and the Little Raid not already due is made due now: Leaf's sweep
// reads it, writes its postcard, and finds it standing still again.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const now = yield* Clock.currentTimeMillis;
  yield* sql`
    CREATE TABLE play_postcards (
      player_id TEXT NOT NULL,
      game      TEXT NOT NULL,
      postcard  TEXT NOT NULL,
      PRIMARY KEY (player_id, game)
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`UPDATE play_state SET due_at = ${now} WHERE game IN ('works', 'raid') AND due_at IS NULL`;
});
