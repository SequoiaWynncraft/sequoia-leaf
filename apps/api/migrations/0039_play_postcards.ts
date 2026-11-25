import { Clock, Effect } from "effect";
import { SqlClient } from "effect/sql";

// What each player's state in a game tells the town (`Game.postcard`), as JSON, and the `rev` of
// the state it was made from: the line for the door to the game, and the Coins waiting there; null
// for a state that does not read, which tells it nothing. Leaf writes it in the transaction that
// writes the state, and the town is shown one only while its `rev` is the state's; one that is not
// (a Leaf from before this wrote the state) is not shown, and the state is made due for Leaf to
// write it again. It goes with its state. A state stored before this has none until Leaf next has
// it in hand, so each of the Works and the Little Raid not already due is made due now: Leaf's sweep
// reads it, writes its postcard, and finds it standing still again.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const now = yield* Clock.currentTimeMillis;
  yield* sql`
    CREATE TABLE play_postcards (
      player_id TEXT    NOT NULL,
      game      TEXT    NOT NULL,
      rev       INTEGER NOT NULL,
      postcard  TEXT,
      PRIMARY KEY (player_id, game),
      FOREIGN KEY (player_id, game) REFERENCES play_state (player_id, game) ON DELETE CASCADE
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`UPDATE play_state SET due_at = ${now} WHERE game IN ('works', 'raid') AND due_at IS NULL`;
});
